-- 2026-09-29 · Anmeldung zu Theoriestunden („Ich komme“) · v2.68.0
-- Schüler melden sich in ihrer App zu einer Gruppen-Theoriestunde an; der Fahrlehrer der Stunde
-- (und Inhaber/Büro) sieht beim Check-in, wer kommt. Rein additiv.
create table if not exists public.theorie_anmeldungen (
  id uuid primary key default gen_random_uuid(),
  appt_id uuid not null references public.appointments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (appt_id, student_id)
);
alter table public.theorie_anmeldungen enable row level security;
-- Lesen: Fahrlehrer der Stunde oder Besitzer des Schülers. Schreiben nur über die Funktionen unten.
drop policy if exists theorie_anmeldungen_lesen on public.theorie_anmeldungen;
create policy theorie_anmeldungen_lesen on public.theorie_anmeldungen for select to authenticated
  using (exists (select 1 from appointments a where a.id = appt_id and a.owner = auth.uid())
      or exists (select 1 from students s where s.id = student_id and s.owner = auth.uid()));
revoke all on public.theorie_anmeldungen from anon;

-- Gruppenstunde, zu der sich ein Schüler dieses Fahrlehrers (v_owner) anmelden darf?
create or replace function public._theorie_gruppenstunde(p_appt uuid, v_owner uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from appointments a
    where a.id = p_appt and a.art = 'TH' and a.status = 'confirmed' and a.student_id is null
      and coalesce(a.note, '') not like '§SONST§%' and a.start_at > now()
      and (a.owner = v_owner or a.owner in (
            select p.id from profiles p
            where p.school_id is not null and p.school_id = (select q.school_id from profiles q where q.id = v_owner))));
$$;
revoke all on function public._theorie_gruppenstunde(uuid, uuid) from public, anon, authenticated;

-- Schüler: an- oder abmelden. Anmeldung wie public_student_overview (Code + Name + PIN, mit Sperre).
create or replace function public.public_student_theorie_anmelden(code text, p_name text, p_pin text, p_appt uuid, p_an boolean)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare v_owner uuid; v_row students%rowtype; v_eff text;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return 'login'; end if;
  select * into v_row from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  order by _student_pin_matches(coalesce(nullif(s.data->>'pinCustom',''), s.data->>'pin'), p_pin) desc, s.created_at
  limit 1;
  if not found then return 'login'; end if;
  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then return 'login'; end if;
  if p_an then
    if not _theorie_gruppenstunde(p_appt, v_owner) then return 'nicht_gefunden'; end if;
    insert into theorie_anmeldungen (appt_id, student_id) values (p_appt, v_row.id) on conflict do nothing;
  else
    delete from theorie_anmeldungen where appt_id = p_appt and student_id = v_row.id;
  end if;
  return 'ok';
end;
$function$;
revoke all on function public.public_student_theorie_anmelden(text, text, text, uuid, boolean) from public;
grant execute on function public.public_student_theorie_anmelden(text, text, text, uuid, boolean) to anon, authenticated;

-- Fahrlehrer: wer ist zu dieser Stunde angemeldet? Nur für den Fahrlehrer der Stunde oder Inhaber/Büro.
create or replace function public.theorie_anmeldungen_liste(p_appt uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_owner uuid; v_school uuid;
begin
  select a.owner into v_owner from appointments a where a.id = p_appt;
  if v_owner is null then return '[]'::jsonb; end if;
  select p.school_id into v_school from profiles p where p.id = v_owner;
  if not (v_owner = auth.uid() or (v_school is not null and _darf_schulweit(v_school))) then
    return '[]'::jsonb;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('student_id', s.id,
            'name', btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name','')),
            'klasse', coalesce(nullif(s.data->>'klasse',''), 'B')) order by t.created_at)
    from theorie_anmeldungen t join students s on s.id = t.student_id where t.appt_id = p_appt), '[]'::jsonb);
end;
$function$;
revoke all on function public.theorie_anmeldungen_liste(uuid) from public, anon;
grant execute on function public.theorie_anmeldungen_liste(uuid) to authenticated;

-- Theorieplan der Schüler-App: zusätzlich id, eigene Anmeldung und Zahl der Anmeldungen.
create or replace function public.public_student_theorie(code text, p_name text, p_pin text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_owner uuid; v_row students%rowtype; v_eff text; v_school uuid; v_termine jsonb; v_besucht jsonb;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return null; end if;
  select * into v_row from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  order by _student_pin_matches(coalesce(nullif(s.data->>'pinCustom',''), s.data->>'pin'), p_pin) desc, s.created_at
  limit 1;
  if not found then return null; end if;
  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then return null; end if;
  select p.school_id into v_school from profiles p where p.id = v_owner;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'start_at', x.start_at, 'end_at', x.end_at,
           'thema', nullif(btrim(coalesce(x.ziel, '')), ''), 'ort', nullif(btrim(coalesce(x.abholort, '')), ''),
           'angemeldet', exists (select 1 from theorie_anmeldungen t where t.appt_id = x.id and t.student_id = v_row.id),
           'anzahl', (select count(*) from theorie_anmeldungen t where t.appt_id = x.id)) order by x.start_at), '[]'::jsonb)
    into v_termine
    from (select a.id, a.start_at, a.end_at, a.ziel, a.abholort from appointments a
           where a.art = 'TH' and a.status = 'confirmed' and a.student_id is null and coalesce(a.note, '') not like '§SONST§%'
             and a.start_at > now() and a.start_at < now() + interval '60 days'
             and (a.owner = v_owner or (v_school is not null and a.owner in (select p.id from profiles p where p.school_id = v_school)))
           order by a.start_at limit 20) x;
  select coalesce(jsonb_agg(distinct btrim(t.thema)), '[]'::jsonb) into v_besucht
    from theory_attendance t where t.student_id = v_row.id and coalesce(btrim(t.thema), '') <> '';
  return jsonb_build_object('termine', v_termine, 'besucht', v_besucht);
end;
$function$;
