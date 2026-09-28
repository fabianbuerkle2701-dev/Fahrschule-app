-- 2026-09-28 · Büro-Änderungen vor veralteten Fahrlehrer-Ständen schützen + Stammdaten schulweit (v2.41.0)
--
-- Befund: students_teacher_update schreibt den kompletten Datensatz aus dem Fahrlehrer-Gerät. Hat
-- das Büro seitdem eine Zahlung erfasst oder eine Unterlage abgehakt (school_zahlung_erfassen,
-- school_unterlagen_setzen), überschrieb der nächste Speichervorgang des Fahrlehrers das mit seinem
-- alten Stand - seit der Offline-Warteschlange (v2.39.0) auch noch Stunden später.
--
-- Lösung: Jede Schul-Änderung setzt data.schulAenderungen[<feld>] = Zeitstempel. Schickt ein Gerät
-- einen Stand, dessen schulAenderungen[<feld>] davon abweicht (Änderung noch nicht gesehen), behält
-- der Server für dieses Feld seinen Wert; Zahlungen werden zusammengeführt (vom Büro erfasste
-- Einträge bleiben, neue Einträge des Fahrlehrers auch). Hat das Gerät die Änderung schon geladen,
-- gewinnt wie bisher die Eingabe des Fahrlehrers.

-- 1) Markierung setzen
create or replace function public._schul_aenderung(p_data jsonb, p_feld text)
returns jsonb language sql volatile set search_path to 'public' as $$
  select jsonb_set(case when jsonb_typeof(p_data->'schulAenderungen') = 'object' then p_data
                        else p_data || '{"schulAenderungen":{}}'::jsonb end,
                   array['schulAenderungen', p_feld], to_jsonb(clock_timestamp()::text));
$$;
revoke all on function public._schul_aenderung(jsonb, text) from public, anon, authenticated;

-- 2) Fahrlehrer-Speichern berücksichtigt die Markierungen
create or replace function public.students_teacher_update(p_id uuid, p_data jsonb)
returns void language plpgsql set search_path to 'public' as $function$
declare
  v_current jsonb; v_neu jsonb; v_marken jsonb; v_k text; v_ts text; v_teile text[];
begin
  select data into v_current from students where id = p_id;
  if not found then
    raise exception 'Schüler nicht gefunden';
  end if;
  v_neu := p_data;
  v_marken := case when jsonb_typeof(v_current->'schulAenderungen') = 'object' then v_current->'schulAenderungen' else '{}'::jsonb end;
  for v_k, v_ts in select key, value #>> '{}' from jsonb_each(v_marken) loop
    if (p_data->'schulAenderungen'->>v_k) is distinct from v_ts then
      if v_k = 'payments' then
        v_neu := jsonb_set(v_neu, '{payments}', coalesce((
          select jsonb_agg(x.e order by x.quelle, x.nr) from (
            select 1 as quelle, c.nr, c.e from jsonb_array_elements(case when jsonb_typeof(p_data->'payments') = 'array' then p_data->'payments' else '[]'::jsonb end) with ordinality c(e, nr)
            union all
            select 2, s.nr, s.e from jsonb_array_elements(case when jsonb_typeof(v_current->'payments') = 'array' then v_current->'payments' else '[]'::jsonb end) with ordinality s(e, nr)
             where s.e->>'erfasstVon' = 'buero' and s.e ? 'id'
               and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_data->'payments') = 'array' then p_data->'payments' else '[]'::jsonb end) c2(e2)
                                where c2.e2->>'id' = s.e->>'id')) x), '[]'::jsonb));
      elsif position('.' in v_k) > 0 then
        v_teile := string_to_array(v_k, '.');
        if jsonb_typeof(v_neu->v_teile[1]) is distinct from 'object' then v_neu := jsonb_set(v_neu, array[v_teile[1]], '{}'::jsonb); end if;
        if v_current #> v_teile is null then v_neu := v_neu #- v_teile; else v_neu := jsonb_set(v_neu, v_teile, v_current #> v_teile); end if;
      else
        if v_current ? v_k then v_neu := jsonb_set(v_neu, array[v_k], v_current->v_k); else v_neu := v_neu - v_k; end if;
      end if;
    end if;
  end loop;
  -- Markierungen verwaltet nur der Server (ein Gerät kann sie weder setzen noch löschen).
  v_neu := case when v_marken = '{}'::jsonb then v_neu - 'schulAenderungen' else v_neu || jsonb_build_object('schulAenderungen', v_marken) end;

  update students
  set data = v_neu || jsonb_build_object(
        'pinCustom', v_current->'pinCustom',
        'theoryProgress', v_current->'theoryProgress',
        'theoryMockExams', v_current->'theoryMockExams',
        'begleitfahrten', v_current->'begleitfahrten',
        'begleitplan', v_current->'begleitplan',
        'avatarUrl', v_current->'avatarUrl',
        'messages', v_current->'messages',
        'wunschliste', v_current->'wunschliste'
      ),
      updated_at = now()
  where id = p_id;
end;
$function$;

-- 3) Bestehende Büro-Schreibwege markieren (gezielte Ersetzung, bricht ab, wenn der Anker fehlt)
do $mig$
declare alt text; neu text;
begin
  alt := pg_get_functiondef('public.school_zahlung_erfassen(uuid, numeric, date, text, text)'::regprocedure);
  if position('_schul_aenderung' in alt) = 0 then
    neu := replace(alt, 'update students set data = jsonb_set(data, ''{payments}''', 'update students set data = jsonb_set(_schul_aenderung(data, ''payments''), ''{payments}''');
    if neu = alt then raise exception 'Anker fehlt (zahlung)'; end if;
    execute neu;
  end if;
  alt := pg_get_functiondef('public.school_unterlagen_setzen(uuid, text, boolean)'::regprocedure);
  if position('_schul_aenderung' in alt) = 0 then
    neu := replace(alt, 'case when jsonb_typeof(data->''licenseSteps'') = ''object'' then data else data || ''{"licenseSteps":{}}''::jsonb end,',
                        'case when jsonb_typeof(data->''licenseSteps'') = ''object'' then _schul_aenderung(data, ''licenseSteps.'' || p_key) else _schul_aenderung(data, ''licenseSteps.'' || p_key) || ''{"licenseSteps":{}}''::jsonb end,');
    if neu = alt then raise exception 'Anker fehlt (unterlagen)'; end if;
    execute neu;
  end if;
end $mig$;

-- 4) Protokoll kennt Stammdaten-Änderungen
do $mig$
declare v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.student_assignment_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%umgehaengt%';
  if v_name is not null then execute format('alter table public.student_assignment_log drop constraint %I', v_name); end if;
  alter table public.student_assignment_log add constraint student_assignment_log_aktion_check
    check (aktion = any (array['umgehaengt', 'freigegeben', 'freigabe_entzogen', 'termin_umgehaengt', 'stammdaten']));
end $mig$;

-- 5) Stammdaten durch Admin/Büro ändern
create or replace function public.school_stammdaten_setzen(p_student_id uuid, p_felder jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_school uuid; v_owner uuid; v_data jsonb; v_k text; v_v jsonb; v_wert text; v_geaendert text[] := '{}';
  v_label constant jsonb := '{"vorname":"Vorname","name":"Nachname","geb":"Geburtsdatum","ausbildungsbeginn":"Anmeldedatum","tel":"Handy","festnetz":"Festnetz","anschrift":"Anschrift"}';
  v_owner_name text; v_durch text;
begin
  if _ist_demo() then raise exception 'Im Demo-Modus nicht gespeichert.'; end if;
  if jsonb_typeof(p_felder) is distinct from 'object' then raise exception 'Ungültige Angaben'; end if;
  select p.school_id, s.owner, s.data into v_school, v_owner, v_data
    from students s join profiles p on p.id = s.owner where s.id = p_student_id for update of s;
  if v_school is null or not _darf_schulweit(v_school) then raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro'; end if;
  for v_k, v_v in select key, value from jsonb_each(p_felder) loop
    if not (v_label ? v_k) then raise exception 'Feld nicht änderbar: %', v_k; end if;
    if jsonb_typeof(v_v) is distinct from 'string' then raise exception 'Ungültiger Wert für %', v_label->>v_k; end if;
    v_wert := btrim(v_v #>> '{}');
    if length(v_wert) > 300 then raise exception '% ist zu lang', v_label->>v_k; end if;
    if v_k in ('geb', 'ausbildungsbeginn') and v_wert <> '' and v_wert !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception '% bitte als Datum angeben', v_label->>v_k;
    end if;
    if coalesce(v_data->>v_k, '') is distinct from v_wert then
      v_data := jsonb_set(_schul_aenderung(v_data, v_k), array[v_k], to_jsonb(v_wert));
      v_geaendert := v_geaendert || (v_label->>v_k);
    end if;
  end loop;
  if btrim(coalesce(v_data->>'vorname', '') || coalesce(v_data->>'name', '')) = '' then
    raise exception 'Vor- oder Nachname muss ausgefüllt sein';
  end if;
  if cardinality(v_geaendert) = 0 then return '[]'::jsonb; end if;
  update students set data = v_data, updated_at = now() where id = p_student_id;
  select coalesce(nullif(display_name, ''), split_part(email, '@', 1)) into v_owner_name from profiles where id = v_owner;
  select coalesce(nullif(display_name, ''), split_part(email, '@', 1)) into v_durch from profiles where id = auth.uid();
  insert into student_assignment_log(school_id, student_id, student_name, aktion, von_teacher, von_name, nach_teacher, nach_name, durch_user, durch_name)
  values (v_school, p_student_id,
          coalesce(nullif(btrim(coalesce(v_data->>'vorname', '') || ' ' || coalesce(v_data->>'name', '')), ''), 'Schüler') || ' · ' || array_to_string(v_geaendert, ', '),
          'stammdaten', v_owner, coalesce(v_owner_name, ''), v_owner, coalesce(v_owner_name, ''), auth.uid(), coalesce(v_durch, ''));
  return to_jsonb(v_geaendert); -- nur die Feldnamen: das Büro darf die übrige Akte nicht voll sehen
end $$;
revoke all on function public.school_stammdaten_setzen(uuid, jsonb) from public, anon;
grant execute on function public.school_stammdaten_setzen(uuid, jsonb) to authenticated;
