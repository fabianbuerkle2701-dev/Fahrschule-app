-- Allindrive Autopilot · Prüfungen schulweit (Fabian 23.10.2026, Lückenliste „Prüfungen“). Admin und Büro sehen alle
-- Prüfungen der Fahrschule und tragen sie ein – gleiche Datenform wie die Fahrlehrer-App:
--   · Überblick je aktivem Schüler: Versuche (exams), Führerschein-Schritte, Prüfungsreife, Prüfungstermine im Kalender
--     (VT = Theorie, PF/T1/T2/T3 = Praxis, wie der Prüfungstag der App) und zugeteilte Prüfplätze (exam_slots)                       school_pruefungen
--   · Prüfung ansetzen (Versuch mit Datum, ohne Ergebnis) + „angemeldet“ abhaken          school_pruefung_eintragen
--   · Ergebnis eintragen wie pruefungErgebnis() der App (ergebnis: true, Theorie-Datum
--     bzw. praxis_bestanden mitziehen, nie ein vorhandenes Datum überschreiben)           school_pruefung_ergebnis
--   · falsch erfassten Versuch entfernen                                                  school_pruefung_entfernen
--   · „Theorie/Praxis angemeldet“ über school_unterlagen_setzen (Liste erweitert)
-- Das Zusammenführen in students_teacher_update gilt jetzt auch für exams: ein veraltetes Gerät behält seine Versuche,
-- bekommt die Büro-Versuche dazu, und ein im Büro eingetragenes Ergebnis bleibt stehen.

create or replace function public.school_pruefungen(p_school_id uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_school_id is null or not _darf_schulweit(p_school_id) then raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'student_id', s.id, 'vorname', coalesce(s.data->>'vorname', ''), 'name', coalesce(s.data->>'name', ''),
      'klasse', coalesce(nullif(s.data->>'klasse', ''), 'B'), 'lehrer_id', s.owner, 'lehrer', coalesce(_profil_name(s.owner), ''),
      'tel', coalesce(s.data->>'tel', ''), 'theorie', coalesce(s.data->>'theorie', ''),
      'schritte', (select coalesce(jsonb_object_agg(k, jsonb_build_object('done', coalesce((s.data->'licenseSteps'->k->>'done') = 'true', false), 'date', s.data->'licenseSteps'->k->>'date')), '{}'::jsonb)
                     from unnest(array['sehtest', 'erstehilfe', 'passfoto', 'antrag', 'theorie_angemeldet', 'praxis_angemeldet', 'praxis_bestanden']) k),
      'pruefungen', (select coalesce(jsonb_agg(jsonb_build_object('id', e->>'id', 'art', e->>'art', 'date', e->>'date', 'passed', coalesce(e->>'passed', 'false') = 'true',
                         'ergebnis', coalesce(e->>'ergebnis', 'false') = 'true') order by e->>'date'), '[]'::jsonb)
                       from jsonb_array_elements(_json_liste(s.data->'exams')) e where jsonb_typeof(e) = 'object'),
      'reife', case when jsonb_typeof(s.data->'examReadiness') = 'object'
                    then jsonb_build_object('datum', s.data->'examReadiness'->>'datum', 'am', s.data->'examReadiness'->>'festgestelltAm', 'ergebnis', s.data->'examReadiness'->>'ergebnis') end,
      -- Prüfungstermine wie der Prüfungstag der App: VT = Theorie, PF/T1/T2/T3 = Praxis, nur bestätigte (keine Anfragen)
      'termine', (select coalesce(jsonb_agg(jsonb_build_object('start', a.start_at, 'ende', a.end_at, 'art', case when a.art = 'VT' then 'theorie' else 'praxis' end) order by a.start_at), '[]'::jsonb)
                    from appointments a where a.student_id = s.id::text and a.art in ('VT', 'PF', 'T1', 'T2', 'T3')
                     and coalesce(a.status, 'confirmed') in ('confirmed', 'cancel_requested')
                     and a.start_at >= now() - interval '30 days' and a.start_at < now() + interval '180 days'),
      'plaetze', (select coalesce(jsonb_agg(jsonb_build_object('art', x.art, 'datum', x.datum, 'zeit', x.zeit, 'ort', x.ort) order by x.datum), '[]'::jsonb)
                    from exam_slots x where x.student_id = s.id and x.datum >= current_date - 30)))
    from students s join profiles p on p.id = s.owner
   where p.school_id = p_school_id and coalesce(s.data->>'archived', 'false') <> 'true'), '[]'::jsonb);
end $$;

-- Prüfung ansetzen: Versuch mit Datum, noch ohne Ergebnis (wie addExam der App), und „angemeldet“ abhaken
create or replace function public.school_pruefung_eintragen(p_student_id uuid, p_art text, p_datum date) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid; v_owner uuid; v_data jsonb; v_e jsonb; v_schritt text;
begin
  select o_school, o_owner, o_data into v_school, v_owner, v_data from _schul_schueler(p_student_id);
  if p_art not in ('theorie', 'praxis') then raise exception 'Unbekannte Prüfung'; end if;
  if p_datum is null or p_datum < current_date - 365 or p_datum > current_date + 365 then raise exception 'Bitte ein gültiges Datum angeben'; end if;
  if exists (select 1 from jsonb_array_elements(_json_liste(v_data->'exams')) e where e->>'art' = p_art and e->>'date' = p_datum::text) then
    raise exception 'An diesem Tag ist schon eine % eingetragen', case when p_art = 'theorie' then 'Theorieprüfung' else 'Praxisprüfung' end;
  end if;
  v_e := jsonb_build_object('id', 'ex_' || _zufall_text('abcdefghijklmnopqrstuvwxyz0123456789', 7), 'art', p_art, 'date', p_datum::text, 'passed', false,
    'erfasstVon', 'buero', 'erfasstAm', clock_timestamp()::text);
  v_schritt := p_art || '_angemeldet';
  update students set data = jsonb_set(jsonb_set(
           case when jsonb_typeof(data->'licenseSteps') = 'object' then _schul_aenderung(_schul_aenderung(data, 'exams'), 'licenseSteps.' || v_schritt)
                else _schul_aenderung(_schul_aenderung(data, 'exams'), 'licenseSteps.' || v_schritt) || '{"licenseSteps":{}}'::jsonb end,
           '{exams}', _json_liste(data->'exams') || v_e),
           array['licenseSteps', v_schritt],
           coalesce(case when jsonb_typeof(data->'licenseSteps'->v_schritt) = 'object' and (data->'licenseSteps'->v_schritt->>'done') = 'true' then data->'licenseSteps'->v_schritt end,
                    jsonb_build_object('done', true, 'date', to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM-DD')))),
         updated_at = now()
   where id = p_student_id;
  perform _akte_protokoll(v_school, p_student_id, v_owner, _schueler_name(v_data) || ' · ' || case when p_art = 'theorie' then 'Theorieprüfung' else 'Praxisprüfung' end
    || ' am ' || to_char(p_datum, 'DD.MM.YYYY') || ' eingetragen');
  return v_e;
end $$;

-- Ergebnis wie pruefungErgebnis() der App: vorhandenen Versuch (Id oder gleiche Art am selben Tag) setzen, sonst neu
create or replace function public.school_pruefung_ergebnis(p_student_id uuid, p_art text, p_datum date, p_bestanden boolean, p_exam_id text default null) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid; v_owner uuid; v_data jsonb; v_id text; v_exams jsonb; v_pb jsonb;
begin
  select o_school, o_owner, o_data into v_school, v_owner, v_data from _schul_schueler(p_student_id);
  if p_art not in ('theorie', 'praxis') then raise exception 'Unbekannte Prüfung'; end if;
  if p_datum is null or p_datum > (now() at time zone 'Europe/Berlin')::date then raise exception 'Ein Ergebnis gibt es erst am Prüfungstag'; end if;
  if p_bestanden is null then raise exception 'Bitte bestanden oder nicht bestanden wählen'; end if;
  select e->>'id' into v_id from jsonb_array_elements(_json_liste(v_data->'exams')) e
   where (p_exam_id is not null and e->>'id' = p_exam_id) or (p_exam_id is null and e->>'art' = p_art and e->>'date' = p_datum::text)
   order by (e->>'id' = coalesce(p_exam_id, '')) desc limit 1;
  if p_exam_id is not null and v_id is null then raise exception 'Diesen Versuch gibt es nicht mehr'; end if;
  if v_id is not null then
    v_exams := (select jsonb_agg(case when e->>'id' = v_id
                                      then e || jsonb_build_object('passed', p_bestanden, 'date', p_datum::text, 'ergebnis', true, 'ergebnisVon', 'buero', 'erfasstAm', clock_timestamp()::text)
                                      else e end)
                  from jsonb_array_elements(_json_liste(v_data->'exams')) e);
  else
    v_exams := _json_liste(v_data->'exams') || jsonb_build_object('id', 'ex_' || _zufall_text('abcdefghijklmnopqrstuvwxyz0123456789', 7), 'art', p_art,
      'date', p_datum::text, 'passed', p_bestanden, 'ergebnis', true, 'erfasstVon', 'buero', 'erfasstAm', clock_timestamp()::text);
  end if;
  v_data := jsonb_set(_schul_aenderung(v_data, 'exams'), '{exams}', v_exams);
  -- Führerschein-Stand mitziehen, nie ein vorhandenes Datum überschreiben (wie die App)
  if p_bestanden and p_art = 'theorie' and coalesce(v_data->>'theorie', '') = '' then
    v_data := jsonb_set(_schul_aenderung(v_data, 'theorie'), '{theorie}', to_jsonb(p_datum::text));
  end if;
  v_pb := v_data->'licenseSteps'->'praxis_bestanden';
  if p_bestanden and p_art = 'praxis' and not coalesce((v_pb->>'done') = 'true', false) then
    v_data := jsonb_set(case when jsonb_typeof(v_data->'licenseSteps') = 'object' then _schul_aenderung(v_data, 'licenseSteps.praxis_bestanden')
                             else _schul_aenderung(v_data, 'licenseSteps.praxis_bestanden') || '{"licenseSteps":{}}'::jsonb end,
                        '{licenseSteps,praxis_bestanden}', case when jsonb_typeof(v_pb) = 'object' then v_pb else '{}'::jsonb end || jsonb_build_object('done', true, 'date', p_datum::text));
  end if;
  update students set data = v_data, updated_at = now() where id = p_student_id;
  perform _akte_protokoll(v_school, p_student_id, v_owner, _schueler_name(v_data) || ' · ' || case when p_art = 'theorie' then 'Theorieprüfung' else 'Praxisprüfung' end
    || ' am ' || to_char(p_datum, 'DD.MM.YYYY') || case when p_bestanden then ' bestanden' else ' nicht bestanden' end);
end $$;

-- Falsch erfassten Versuch entfernen (wie removeExam der App); der Führerschein-Stand bleibt, wie er ist
create or replace function public.school_pruefung_entfernen(p_student_id uuid, p_exam_id text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid; v_owner uuid; v_data jsonb; v_e jsonb;
begin
  select o_school, o_owner, o_data into v_school, v_owner, v_data from _schul_schueler(p_student_id);
  select e into v_e from jsonb_array_elements(_json_liste(v_data->'exams')) e where e->>'id' = p_exam_id limit 1;
  if v_e is null then raise exception 'Diesen Versuch gibt es nicht mehr'; end if;
  update students set data = jsonb_set(_buero_entfernt(_schul_aenderung(data, 'exams'), 'exams', p_exam_id), '{exams}',
           coalesce((select jsonb_agg(e) from jsonb_array_elements(_json_liste(data->'exams')) e where e->>'id' is distinct from p_exam_id), '[]'::jsonb)),
         updated_at = now()
   where id = p_student_id;
  perform _akte_protokoll(v_school, p_student_id, v_owner, _schueler_name(v_data) || ' · ' || case when v_e->>'art' = 'theorie' then 'Theorieprüfung' else 'Praxisprüfung' end
    || coalesce(' vom ' || to_char((v_e->>'date')::date, 'DD.MM.YYYY'), '') || ' entfernt');
end $$;

-- „Theorie/Praxis angemeldet“ abhaken wie die Unterlagen
create or replace function public.school_unterlagen_setzen(p_student_id uuid, p_key text, p_done boolean) returns void
language plpgsql security definer set search_path to 'public' as $function$
declare v_school uuid;
begin
  if _ist_demo() then raise exception 'Im Demo-Modus nicht gespeichert.'; end if;
  if p_key not in ('sehtest', 'erstehilfe', 'passfoto', 'antrag', 'theorie_angemeldet', 'praxis_angemeldet') then raise exception 'Unbekannte Unterlage'; end if;
  select p.school_id into v_school from students s join profiles p on p.id = s.owner where s.id = p_student_id;
  if v_school is null or not _darf_schulweit(v_school) then raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro'; end if;
  update students set data = jsonb_set(
      case when jsonb_typeof(data->'licenseSteps') = 'object' then _schul_aenderung(data, 'licenseSteps.' || p_key) else _schul_aenderung(data, 'licenseSteps.' || p_key) || '{"licenseSteps":{}}'::jsonb end,
      array['licenseSteps', p_key],
      jsonb_build_object('done', coalesce(p_done, false), 'date', case when coalesce(p_done, false) then current_date::text else null end)),
    updated_at = now()
   where id = p_student_id;
end $function$;

revoke all on function public.school_pruefungen(uuid), public.school_pruefung_eintragen(uuid, text, date),
  public.school_pruefung_ergebnis(uuid, text, date, boolean, text), public.school_pruefung_entfernen(uuid, text) from public, anon;
grant execute on function public.school_pruefungen(uuid), public.school_pruefung_eintragen(uuid, text, date),
  public.school_pruefung_ergebnis(uuid, text, date, boolean, text), public.school_pruefung_entfernen(uuid, text) to authenticated;

-- Zusammenführen auch für exams; ein im Büro eingetragenes Ergebnis gewinnt gegen den Stand ohne Ergebnis
do $do$
declare
  v_def text := pg_get_functiondef('public.students_teacher_update(uuid,jsonb)'::regprocedure);
  v_alt1 constant text := $a$elsif v_k in ('costItems', 'packages', 'contracts') then$a$;
  v_neu1 constant text := $a$elsif v_k in ('costItems', 'packages', 'contracts', 'exams') then$a$;
  v_alt2 constant text := $a$case when v_k = 'contracts' and s.e ? 'fern' and not (c.e ? 'fern') then c.e || jsonb_build_object('fern', s.e->'fern') else c.e end as e$a$;
  v_neu2 constant text := $a$case when v_k = 'contracts' and s.e ? 'fern' and not (c.e ? 'fern') then c.e || jsonb_build_object('fern', s.e->'fern')
                        when v_k = 'exams' and coalesce(s.e->>'ergebnis', '') = 'true' and coalesce(c.e->>'ergebnis', '') <> 'true'
                          then c.e || jsonb_build_object('passed', s.e->'passed', 'date', s.e->'date', 'ergebnis', true)
                        else c.e end as e$a$;
begin
  if position($a$'contracts', 'exams'$a$ in v_def) > 0 then return; end if; -- schon eingespielt
  if (length(v_def) - length(replace(v_def, v_alt1, ''))) / length(v_alt1) <> 1
     or (length(v_def) - length(replace(v_def, v_alt2, ''))) / length(v_alt2) <> 1 then
    raise exception 'students_teacher_update hat sich verändert – Ersetzung abgebrochen';
  end if;
  execute replace(replace(v_def, v_alt1, v_neu1), v_alt2, v_neu2);
end $do$;
