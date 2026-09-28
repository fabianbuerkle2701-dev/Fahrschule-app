-- 2026-09-27 · Team-Kalender / Ressourcenkalender (Produktplan Teil E/Q) · v2.36.0
-- Admin und Büro sehen die Termine aller Fahrlehrer der Schule und hängen Fahrstunden um.
-- Private Termine und Urlaub: nur als belegte Zeit, ohne Namen und Notiz.

-- 1) Termine der Schule für einen Zeitraum (max. 14 Tage)
create or replace function public.school_termine(p_school_id uuid, p_von timestamptz, p_bis timestamptz)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not _darf_schulweit(p_school_id) then raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro'; end if;
  if p_von is null or p_bis is null or p_bis <= p_von or p_bis - p_von > interval '14 days' then
    raise exception 'Zeitraum ungültig (höchstens 14 Tage)';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'lehrer_id', a.owner, 'start_at', a.start_at, 'end_at', a.end_at, 'status', a.status, 'art', a.art,
      'typ', case when coalesce(a.note, '') like '§URLAUB§%' then 'urlaub'
                  when a.art = 'PRIVAT' then 'privat'
                  when coalesce(a.note, '') like '§SONST§%' then 'sonstige'
                  else 'fahrstunde' end,
      'name', case when coalesce(a.note, '') like '§URLAUB§%' or a.art = 'PRIVAT' then null
                   else coalesce(nullif(btrim(coalesce(s.data->>'vorname', '') || ' ' || coalesce(s.data->>'name', '')), ''), a.title) end,
      'klasse', case when a.art = 'PRIVAT' then null else s.data->>'klasse' end,
      'student_id', case when a.art = 'PRIVAT' then null else a.student_id end) order by a.start_at)
    from appointments a
    join profiles p on p.id = a.owner
    left join students s on s.id::text = a.student_id
    where p.school_id = p_school_id and a.start_at >= p_von and a.start_at < p_bis
      and coalesce(a.status, '') <> 'offered'), '[]'::jsonb);
end $$;
revoke all on function public.school_termine(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.school_termine(uuid, timestamptz, timestamptz) to authenticated;

-- 2) Protokoll kennt das Umhängen eines Termins
do $mig$
declare v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.student_assignment_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%umgehaengt%';
  if v_name is not null then execute format('alter table public.student_assignment_log drop constraint %I', v_name); end if;
  alter table public.student_assignment_log add constraint student_assignment_log_aktion_check
    check (aktion = any (array['umgehaengt', 'freigegeben', 'freigabe_entzogen', 'termin_umgehaengt']));
end $mig$;

-- 3) Termin einem anderen Fahrlehrer der Schule geben
create or replace function public.school_termin_umhaengen(p_appt_id uuid, p_lehrer_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  a appointments%rowtype;
  v_school uuid; v_ziel_school uuid; v_ziel_buero boolean;
  v_von_name text; v_nach_name text; v_durch text; v_sname text; v_owner uuid; v_shared uuid[];
begin
  if _ist_demo() then raise exception 'Im Demo-Modus werden Termine nicht umgehängt.'; end if;
  select * into a from appointments where id = p_appt_id for update;
  if a.id is null then raise exception 'Termin nicht gefunden'; end if;
  select school_id into v_school from profiles where id = a.owner;
  if v_school is null or not _darf_schulweit(v_school) then raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro'; end if;
  if coalesce(a.note, '') like '§URLAUB§%' or a.art = 'PRIVAT' then raise exception 'Urlaub und private Termine lassen sich nicht umhängen'; end if;
  if a.owner = p_lehrer_id then return; end if;
  select school_id, coalesce(school_office, false) into v_ziel_school, v_ziel_buero from profiles where id = p_lehrer_id;
  if v_ziel_school is distinct from v_school then raise exception 'Ziel-Fahrlehrer gehört nicht zu dieser Fahrschule'; end if;
  if v_ziel_buero then raise exception 'Termine gehören zu Fahrlehrern, nicht zum Büro'; end if;
  perform pg_advisory_xact_lock(hashtext('book_appt:' || p_lehrer_id::text));
  if exists (select 1 from appointments b
              where b.owner = p_lehrer_id and b.id <> a.id and coalesce(b.status, '') in ('confirmed', 'cancel_requested')
                and b.start_at < coalesce(a.end_at, a.start_at + interval '45 minutes')
                and coalesce(b.end_at, b.start_at + interval '45 minutes') > a.start_at) then
    raise exception 'OVERLAP';
  end if;
  update appointments set owner = p_lehrer_id where id = a.id;
  -- Der neue Fahrlehrer muss den Schüler sehen können: Freigabe ergänzen, falls er nicht Besitzer ist.
  if a.student_id is not null and a.student_id ~ '^[0-9a-f-]{36}$' then
    select owner, coalesce(shared_with, '{}'::uuid[]), btrim(coalesce(data->>'vorname', '') || ' ' || coalesce(data->>'name', ''))
      into v_owner, v_shared, v_sname from students where id = a.student_id::uuid;
    if v_owner is not null and v_owner <> p_lehrer_id and not (p_lehrer_id = any(v_shared)) then
      update students set shared_with = array_append(v_shared, p_lehrer_id) where id = a.student_id::uuid;
    end if;
  end if;
  select coalesce(nullif(display_name, ''), split_part(email, '@', 1)) into v_von_name from profiles where id = a.owner;
  select coalesce(nullif(display_name, ''), split_part(email, '@', 1)) into v_nach_name from profiles where id = p_lehrer_id;
  select coalesce(nullif(display_name, ''), split_part(email, '@', 1)) into v_durch from profiles where id = auth.uid();
  insert into student_assignment_log(school_id, student_id, student_name, aktion, von_teacher, von_name, nach_teacher, nach_name, durch_user, durch_name)
  values (v_school, case when a.student_id ~ '^[0-9a-f-]{36}$' then a.student_id::uuid end,
          coalesce(nullif(v_sname, ''), a.title, 'Termin') || ' · ' || to_char(a.start_at at time zone 'Europe/Berlin', 'DD.MM. HH24:MI'),
          'termin_umgehaengt', a.owner, coalesce(v_von_name, ''), p_lehrer_id, coalesce(v_nach_name, ''), auth.uid(), coalesce(v_durch, ''));
end $$;
revoke all on function public.school_termin_umhaengen(uuid, uuid) from public, anon;
grant execute on function public.school_termin_umhaengen(uuid, uuid) to authenticated;
