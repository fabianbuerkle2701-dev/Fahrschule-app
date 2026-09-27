-- 2026-09-27 · Büro-Rolle (Produktplan Teil Q) · v2.35.0
-- Bürokraft einer Fahrschule: sieht und bearbeitet schulweit Schüler-Zuordnung, Unterlagen,
-- Zahlungen, offene Posten, Prüfungen, Anfragen - aber KEINE Ausbildungsnotizen und keine
-- Umsatz-/Vergütungszahlen. Bestehende RLS bleibt unangetastet; alles Schulweite läuft wie bisher
-- über SECURITY-DEFINER-Funktionen, deren Prüfung jetzt "Admin ODER Büro" zulässt.
-- Jede Funktionsänderung per DO-Block: gezielter Ersatz im aktuellen Funktionstext, Abbruch wenn
-- der Anker fehlt (nie einen veralteten Volltext überschreiben).

-- 1) Recht am Profil
alter table public.profiles add column if not exists school_office boolean not null default false;

-- 2) Helfer: Büro der Schule / Admin oder Büro
create or replace function public._ist_schul_buero(p_school_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from profiles where id = auth.uid() and school_id = p_school_id and school_office = true);
$$;
create or replace function public._darf_schulweit(p_school_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select _ist_schul_admin(p_school_id) or _ist_schul_buero(p_school_id);
$$;
revoke all on function public._ist_schul_buero(uuid) from public, anon;
revoke all on function public._darf_schulweit(uuid) from public, anon;
grant execute on function public._ist_schul_buero(uuid) to authenticated;
grant execute on function public._darf_schulweit(uuid) to authenticated;

-- 3) Schutz-Trigger: Büro-Recht wie Admin-Recht nur per trusted write (keine Selbst-Beförderung)
do $mig$
declare alt text; neu text;
begin
  alt := pg_get_functiondef('public._guard_profile_privilege_flags()'::regprocedure);
  if position('old_school_office' in alt) > 0 then raise notice 'Trigger schon erweitert'; return; end if;
  neu := replace(alt, 'old_school_admin boolean := false;', 'old_school_admin boolean := false;' || chr(10) || '  old_school_office boolean := false;');
  neu := replace(neu, 'old_school_admin := coalesce(old.school_admin, false);', 'old_school_admin := coalesce(old.school_admin, false);' || chr(10) || '    old_school_office := coalesce(old.school_office, false);');
  neu := replace(neu, '  if new.subscription_active is distinct from old_subscription_active then',
    '  -- Büro-Recht (2026-09-27): wie school_admin nur per trusted write (admin_set_school_office).' || chr(10) ||
    '  if coalesce(new.school_office, false) and not old_school_office and not is_trusted_write then' || chr(10) ||
    '    new.school_office := old_school_office;' || chr(10) || '  end if;' || chr(10) || chr(10) ||
    '  if new.subscription_active is distinct from old_subscription_active then');
  if (length(neu) - length(alt)) < 200 then raise exception 'Trigger-Anker nicht gefunden'; end if;
  execute neu;
end $mig$;

-- 4) Vergabe durch den Admin der eigenen Schule
create or replace function public.admin_set_school_office(p_teacher_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_target_school uuid;
begin
  if _ist_demo() then raise exception 'Im Demo-Modus werden Rollen nicht gespeichert.'; end if;
  select school_id into v_target_school from profiles where id = p_teacher_id;
  if v_target_school is null then raise exception 'Person nicht gefunden oder keiner Fahrschule zugeordnet'; end if;
  if auth.uid() is distinct from '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid
     and not exists (select 1 from profiles where id = auth.uid() and school_id = v_target_school and school_admin = true) then
    raise exception 'Kein Zugriff: nur Fahrschul-Admin der eigenen Fahrschule';
  end if;
  perform set_config('app.trusted_profile_write', 'on', true);
  update profiles set school_office = coalesce(p_on, false) where id = p_teacher_id;
end $$;
revoke all on function public.admin_set_school_office(uuid, boolean) from public, anon;
grant execute on function public.admin_set_school_office(uuid, boolean) to authenticated;

-- Wer in der Schule Büro ist (für Team-Liste und um Büro-Konten aus der Fahrlehrer-Kapazität zu nehmen)
create or replace function public.school_buero_ids(p_school_id uuid)
returns uuid[] language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not _darf_schulweit(p_school_id) then raise exception 'Kein Zugriff'; end if;
  return coalesce((select array_agg(id) from profiles where school_id = p_school_id and school_office), '{}'::uuid[]);
end $$;
revoke all on function public.school_buero_ids(uuid) from public, anon;
grant execute on function public.school_buero_ids(uuid) to authenticated;

-- 5) Bestehende schulweite Funktionen: "nur Admin" -> "Admin oder Büro" (nur die laut Konzept nötigen)
do $mig$
declare f text; alt text; neu text;
begin
  foreach f in array array['public.school_students_overview(uuid)', 'public.school_assignment_log(uuid,integer)', 'public.school_cockpit(uuid)'] loop
    alt := pg_get_functiondef(f::regprocedure);
    neu := replace(alt, 'if not _ist_schul_admin(p_school_id) then', 'if not _darf_schulweit(p_school_id) then');
    if neu = alt then raise exception 'Anker fehlt in %', f; end if;
    execute neu;
  end loop;
  foreach f in array array['public.school_assign_student(uuid,uuid)', 'public.school_share_student(uuid,uuid,boolean)'] loop
    alt := pg_get_functiondef(f::regprocedure);
    neu := replace(alt, 'not _ist_schul_admin(v_school)', 'not _darf_schulweit(v_school)');
    if neu = alt then raise exception 'Anker fehlt in %', f; end if;
    execute neu;
  end loop;
  foreach f in array array['public.school_offene_posten(uuid)', 'public.school_exam_stats(uuid)'] loop
    alt := pg_get_functiondef(f::regprocedure);
    neu := replace(alt, 'where id = auth.uid() and school_id = p_school_id and school_admin = true',
                        'where id = auth.uid() and school_id = p_school_id and (school_admin = true or school_office = true)');
    if neu = alt then raise exception 'Anker fehlt in %', f; end if;
    execute neu;
  end loop;
  alt := pg_get_functiondef('public.admin_school_teachers(uuid)'::regprocedure);
  neu := replace(alt, 'pr.school_id = p_school_id and pr.school_admin = true', 'pr.school_id = p_school_id and (pr.school_admin = true or pr.school_office = true)');
  if neu = alt then raise exception 'Anker fehlt in admin_school_teachers'; end if;
  execute neu;
  -- Cockpit: Büro-Konten sind keine Fahrlehrer - nicht in Kapazität/Auslastung zählen
  alt := pg_get_functiondef('public.school_cockpit(uuid)'::regprocedure);
  neu := replace(alt, 'from profiles p where p.school_id = p_school_id), ''[]''::jsonb),',
                      'from profiles p where p.school_id = p_school_id and not coalesce(p.school_office, false)), ''[]''::jsonb),');
  if neu = alt then raise exception 'Anker fehlt in school_cockpit (lehrer)'; end if;
  execute neu;
end $mig$;

-- 6) Akte: Büro sieht Fortschritt und Abrechnung, aber keine Ausbildungsnotizen
do $mig$
declare alt text; neu text;
begin
  alt := pg_get_functiondef('public.school_student_akte(uuid)'::regprocedure);
  neu := replace(alt, 'if v_school is null or not _ist_schul_admin(v_school) then', 'if v_school is null or not _darf_schulweit(v_school) then');
  neu := replace(neu, 'select s.id, s.owner, s.data, coalesce(s.shared_with,''{}''::uuid[]), s.created_at',
    'select s.id, s.owner,' || chr(10) ||
    '         case when _ist_schul_admin(v_school) then s.data' || chr(10) ||
    '              else s.data - array[''lessons'',''bemerkungen'',''lastNote'',''lastNoteAt'',''adkNotes'',''streckenNotes'',''messages'',''examSims'',''schaltkompetenzTests'',''pins'',''pin'',''pinCustom'',''pins''] end,' || chr(10) ||
    '         coalesce(s.shared_with,''{}''::uuid[]), s.created_at');
  if (length(neu) - length(alt)) < 150 then raise exception 'Anker fehlt in school_student_akte'; end if;
  execute neu;
end $mig$;

-- 7) Schreiben durch Büro/Admin: Zahlung erfassen, Unterlagen abhaken (eng begrenzt, atomar)
create or replace function public.school_zahlung_erfassen(p_student_id uuid, p_betrag numeric, p_datum date, p_methode text, p_invoice_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid; v_eintrag jsonb;
begin
  if _ist_demo() then raise exception 'Im Demo-Modus werden Zahlungen nicht gespeichert.'; end if;
  select p.school_id into v_school from students s join profiles p on p.id = s.owner where s.id = p_student_id;
  if v_school is null or not _darf_schulweit(v_school) then raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro'; end if;
  if p_betrag is null or p_betrag <= 0 or p_betrag > 100000 then raise exception 'Ungültiger Betrag'; end if;
  v_eintrag := jsonb_build_object('id', 'pay' || replace(gen_random_uuid()::text, '-', ''), 'date', coalesce(p_datum, current_date)::text,
    'amount', round(p_betrag, 2), 'method', left(coalesce(nullif(btrim(p_methode), ''), 'Überweisung'), 40),
    'erfasstVon', 'buero') || case when nullif(p_invoice_id, '') is not null then jsonb_build_object('invoiceId', p_invoice_id) else '{}'::jsonb end;
  update students set data = jsonb_set(data, '{payments}', coalesce(case when jsonb_typeof(data->'payments') = 'array' then data->'payments' end, '[]'::jsonb) || v_eintrag),
         updated_at = now()
   where id = p_student_id;
  return v_eintrag;
end $$;
revoke all on function public.school_zahlung_erfassen(uuid, numeric, date, text, text) from public, anon;
grant execute on function public.school_zahlung_erfassen(uuid, numeric, date, text, text) to authenticated;

create or replace function public.school_unterlagen_setzen(p_student_id uuid, p_key text, p_done boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid;
begin
  if _ist_demo() then raise exception 'Im Demo-Modus nicht gespeichert.'; end if;
  if p_key not in ('sehtest', 'erstehilfe', 'passfoto', 'antrag') then raise exception 'Unbekannte Unterlage'; end if;
  select p.school_id into v_school from students s join profiles p on p.id = s.owner where s.id = p_student_id;
  if v_school is null or not _darf_schulweit(v_school) then raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro'; end if;
  update students set data = jsonb_set(
      case when jsonb_typeof(data->'licenseSteps') = 'object' then data else data || '{"licenseSteps":{}}'::jsonb end,
      array['licenseSteps', p_key],
      jsonb_build_object('done', coalesce(p_done, false), 'date', case when coalesce(p_done, false) then current_date::text else null end)),
    updated_at = now()
   where id = p_student_id;
end $$;
revoke all on function public.school_unterlagen_setzen(uuid, text, boolean) from public, anon;
grant execute on function public.school_unterlagen_setzen(uuid, text, boolean) to authenticated;

-- 8) Nachtrag: Akte für das Büro auch ohne Fahrstunden-Notizen (drivenLessons[].note)
--    (eingespielt als buero_akte_ohne_fahrstunden_notizen; Test: Büro 22 Stunden/0 Notizen, Admin 22/1)
do $mig$
declare alt text; neu text;
begin
  alt := pg_get_functiondef('public.school_student_akte(uuid)'::regprocedure);
  if position('jsonb_agg(e - ''note'')' in alt) > 0 then raise notice 'schon angewandt'; return; end if;
  neu := replace(alt, 'else s.data - array[', 'else (s.data - array[');
  neu := replace(neu, '''pinCustom''] end,', '''pinCustom''])' || chr(10) ||
    '                   || jsonb_build_object(''drivenLessons'', (select coalesce(jsonb_agg(e - ''note''), ''[]''::jsonb)' || chr(10) ||
    '                        from jsonb_array_elements(case when jsonb_typeof(s.data->''drivenLessons'') = ''array'' then s.data->''drivenLessons'' else ''[]''::jsonb end) e)) end,');
  if (length(neu) - length(alt)) < 150 then raise exception 'Anker fehlt'; end if;
  execute neu;
end $mig$;
