-- Allindrive Autopilot · Anmeldung im Büro (Fabian 23.10.2026: „Auf der Plattform soll es rein um die Verwaltung der
-- Fahrschule gehen – alle Funktionen drin“). Admin und Büro der Fahrschule (_darf_schulweit) können jetzt:
--   · Schüler anlegen und einem Fahrlehrer zuteilen            school_schueler_anlegen
--   · die E-Mail-Adresse in den Stammdaten pflegen              school_stammdaten_setzen (+ email)
--   · Kostenposten erfassen/entfernen, ein Paket übernehmen     school_kostenposten_anlegen / _entfernen, school_paket_zuweisen
--   · den Ausbildungsvertrag erstellen, zur Unterschrift in die
--     Schüler-App geben (samt Start-PIN, falls noch kein Zugang)
--     und einen unbenutzten wieder entfernen                    school_vertrag_anlegen / _senden / _entfernen
--   · die Dokumente der Schüler ansehen und eigene hochladen     school_schueler_dateien / _datei_eintragen / _datei_entfernen
--   · die Ausbildung beenden (archivieren) und zurückholen      school_schueler_archivieren
-- Gleiche Datenform wie die Fahrlehrer-App (newStudent, neuerKostenposten, packages, createContract, vertragPerHandy).
-- Jede Änderung setzt die Schul-Markierung (_schul_aenderung) und steht im Protokoll (student_assignment_log, neue
-- Aktionen „angelegt“ und „akte“). Damit ein Fahrlehrer-Gerät mit altem Stand nichts verliert und nichts zurückholt,
-- führt students_teacher_update die Listen costItems/packages/contracts jetzt zusammen (Büro-Einträge mit
-- erfasstVon/erfasstAm, vom Büro Entferntes in data.bueroEntfernt).

alter table public.student_assignment_log drop constraint if exists student_assignment_log_aktion_check;
alter table public.student_assignment_log add constraint student_assignment_log_aktion_check
  check (aktion = any (array['umgehaengt', 'freigegeben', 'freigabe_entzogen', 'termin_umgehaengt', 'stammdaten', 'angelegt', 'akte']));

-- ── Helfer (nur intern) ──────────────────────────────────────────────────
create or replace function public._schueler_name(p_data jsonb) returns text
language sql immutable set search_path to 'public' as $$
  select coalesce(nullif(btrim(concat_ws(' ', nullif(btrim(p_data->>'vorname'), ''), nullif(btrim(p_data->>'name'), ''))), ''), 'Schüler');
$$;

create or replace function public._profil_name(p_id uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select coalesce(nullif(display_name, ''), split_part(email, '@', 1), '') from profiles where id = p_id;
$$;

-- Ein Satz ins Protokoll („Max Muster · Kostenposten …“) – wie school_stammdaten_setzen
create or replace function public._akte_protokoll(p_school uuid, p_student uuid, p_owner uuid, p_text text) returns void
language sql security definer set search_path to 'public' as $$
  insert into student_assignment_log(school_id, student_id, student_name, aktion, von_teacher, von_name, nach_teacher, nach_name, durch_user, durch_name)
  values (p_school, p_student, left(p_text, 300), 'akte', p_owner, coalesce(_profil_name(p_owner), ''), p_owner, coalesce(_profil_name(p_owner), ''),
          auth.uid(), coalesce(_profil_name(auth.uid()), ''));
$$;

-- Schüler der eigenen Fahrschule zum Ändern sperren und laden – sonst Fehler
create or replace function public._schul_schueler(p_student_id uuid, out o_school uuid, out o_owner uuid, out o_data jsonb)
language plpgsql security definer set search_path to 'public' as $$
begin
  if _ist_demo() then raise exception 'Im Demo-Modus wird nichts gespeichert.'; end if;
  select p.school_id, s.owner, s.data into o_school, o_owner, o_data
    from students s join profiles p on p.id = s.owner where s.id = p_student_id for update of s;
  if o_school is null or not _darf_schulweit(o_school) then raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro'; end if;
end $$;

create or replace function public._json_liste(p jsonb) returns jsonb
language sql immutable set search_path to 'public' as $$
  select case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end;
$$;

-- Zufallszeichen aus dem sicheren Zufall von gen_random_uuid (Byte 0 einer v4-UUID ist frei)
create or replace function public._zufall_text(p_zeichen text, p_laenge int) returns text
language sql volatile set search_path to 'public' as $$
  select string_agg(substr(p_zeichen, 1 + (get_byte(uuid_send(gen_random_uuid()), 0) % length(p_zeichen)), 1), '')
    from generate_series(1, p_laenge);
$$;

-- Vom Büro entfernte Einträge merken (für das Zusammenführen in students_teacher_update)
create or replace function public._buero_entfernt(p_data jsonb, p_liste text, p_id text) returns jsonb
language sql immutable set search_path to 'public' as $$
  select jsonb_set(case when jsonb_typeof(p_data->'bueroEntfernt') = 'object' then p_data else p_data || '{"bueroEntfernt":{}}'::jsonb end,
                   array['bueroEntfernt', p_liste], _json_liste(p_data->'bueroEntfernt'->p_liste) || to_jsonb(p_id));
$$;

revoke all on function public._schueler_name(jsonb), public._profil_name(uuid), public._akte_protokoll(uuid, uuid, uuid, text),
  public._schul_schueler(uuid), public._json_liste(jsonb), public._zufall_text(text, int), public._buero_entfernt(jsonb, text, text)
  from public, anon, authenticated;

-- ── Schüler anlegen und zuteilen ─────────────────────────────────────────
create or replace function public.school_schueler_anlegen(p_school_id uuid, p_lehrer_id uuid, p_felder jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid := gen_random_uuid(); v_data jsonb; v_k text; v_v jsonb; v_wert text; v_name text;
  v_erlaubt constant text[] := array['vorname', 'name', 'geb', 'tel', 'festnetz', 'anschrift', 'email', 'klasse', 'ausbildungsbeginn', 'location_id', 'bemerkungen'];
begin
  if _ist_demo() then raise exception 'Im Demo-Modus wird nichts gespeichert.'; end if;
  if p_school_id is null or not _darf_schulweit(p_school_id) then raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro'; end if;
  if jsonb_typeof(p_felder) is distinct from 'object' then raise exception 'Ungültige Angaben'; end if;
  if not exists (select 1 from profiles where id = p_lehrer_id and school_id = p_school_id and not coalesce(school_office, false)) then
    raise exception 'Dieser Fahrlehrer gehört nicht zu deiner Fahrschule';
  end if;
  -- Vorlage wie newStudent() der App
  v_data := jsonb_build_object('name', '', 'vorname', '', 'geb', '', 'tel', '', 'festnetz', '', 'anschrift', '', 'ausbildungsbeginn', '',
    'sehhilfe', false, 'theorie', '', 'bemerkungen', '', 'lastNote', '', 'manualHours', 0, 'archived', false, 'klasse', '',
    'items', '{}'::jsonb, 'strecken', '{}'::jsonb, 'streckenNotes', '{}'::jsonb, 'customCounts', '{}'::jsonb, 'lessons', '[]'::jsonb);
  for v_k, v_v in select key, value from jsonb_each(p_felder) loop
    if not (v_k = any (v_erlaubt)) then raise exception 'Feld nicht erlaubt: %', v_k; end if;
    if jsonb_typeof(v_v) is distinct from 'string' then raise exception 'Ungültiger Wert für %', v_k; end if;
    v_wert := btrim(v_v #>> '{}');
    if length(v_wert) > (case when v_k = 'bemerkungen' then 2000 else 300 end) then raise exception '% ist zu lang', v_k; end if;
    if v_k in ('geb', 'ausbildungsbeginn') and v_wert <> '' and v_wert !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '% bitte als Datum angeben', v_k; end if;
    if v_k = 'klasse' then
      v_wert := upper(v_wert);
      if v_wert <> '' and v_wert !~ '^[A-Z0-9]{1,6}$' then raise exception 'Unbekannte Führerscheinklasse'; end if;
    end if;
    if v_k = 'email' then
      v_wert := lower(v_wert);
      if v_wert <> '' and v_wert !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Bitte eine gültige E-Mail-Adresse angeben'; end if;
    end if;
    v_data := jsonb_set(v_data, array[v_k], to_jsonb(v_wert));
  end loop;
  if btrim(coalesce(v_data->>'vorname', '') || coalesce(v_data->>'name', '')) = '' then raise exception 'Vor- oder Nachname muss ausgefüllt sein'; end if;
  if coalesce(v_data->>'klasse', '') = '' then v_data := jsonb_set(v_data, '{klasse}', '"B"'); end if;
  if coalesce(v_data->>'ausbildungsbeginn', '') = '' then
    v_data := jsonb_set(v_data, '{ausbildungsbeginn}', to_jsonb(to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM-DD')));
  end if;
  if coalesce(v_data->>'location_id', '') <> '' and not exists (
      select 1 from schools sc, jsonb_array_elements(_json_liste(sc.locations)) l where sc.id = p_school_id and l->>'id' = v_data->>'location_id') then
    raise exception 'Unbekannter Standort';
  end if;
  if coalesce(v_data->>'email', '') = '' then v_data := v_data - 'email'; end if;
  -- Dieselbe Person nicht zweimal (Name und Geburtstag)
  if coalesce(v_data->>'geb', '') <> '' and exists (
      select 1 from students s join profiles p on p.id = s.owner
       where p.school_id = p_school_id and lower(btrim(coalesce(s.data->>'vorname', ''))) = lower(btrim(v_data->>'vorname'))
         and lower(btrim(coalesce(s.data->>'name', ''))) = lower(btrim(v_data->>'name')) and s.data->>'geb' = v_data->>'geb') then
    raise exception 'Diesen Schüler gibt es schon (gleicher Name und Geburtstag)';
  end if;
  insert into students(id, owner, data, shared_with) values (v_id, p_lehrer_id, v_data || jsonb_build_object('angelegtVon', 'buero'), '{}');
  v_name := _schueler_name(v_data);
  insert into student_assignment_log(school_id, student_id, student_name, aktion, von_teacher, von_name, nach_teacher, nach_name, durch_user, durch_name)
  values (p_school_id, v_id, v_name, 'angelegt', p_lehrer_id, coalesce(_profil_name(p_lehrer_id), ''), p_lehrer_id, coalesce(_profil_name(p_lehrer_id), ''),
          auth.uid(), coalesce(_profil_name(auth.uid()), ''));
  return jsonb_build_object('id', v_id, 'name', v_name);
end $$;

-- ── Stammdaten: jetzt auch die E-Mail-Adresse ────────────────────────────
create or replace function public.school_stammdaten_setzen(p_student_id uuid, p_felder jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_school uuid; v_owner uuid; v_data jsonb; v_k text; v_v jsonb; v_wert text; v_geaendert text[] := '{}';
  v_label constant jsonb := '{"vorname":"Vorname","name":"Nachname","geb":"Geburtsdatum","ausbildungsbeginn":"Anmeldedatum","tel":"Handy","festnetz":"Festnetz","anschrift":"Anschrift","email":"E-Mail"}';
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
    if v_k = 'email' then
      v_wert := lower(v_wert);
      if v_wert <> '' and v_wert !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Bitte eine gültige E-Mail-Adresse angeben'; end if;
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
end $function$;

-- ── Kostenposten ─────────────────────────────────────────────────────────
-- Wie neuerKostenposten() der App: { id: "ci…", label, amount, preisposten? } plus Büro-Kennung für das Zusammenführen
create or replace function public.school_kostenposten_anlegen(p_student_id uuid, p_label text, p_betrag numeric, p_preisposten text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid; v_owner uuid; v_data jsonb; v_item jsonb; v_label text := btrim(coalesce(p_label, ''));
begin
  select o_school, o_owner, o_data into v_school, v_owner, v_data from _schul_schueler(p_student_id);
  if v_label = '' or length(v_label) > 120 then raise exception 'Bitte eine Bezeichnung angeben (höchstens 120 Zeichen)'; end if;
  if p_betrag is null or p_betrag = 0 or abs(p_betrag) > 100000 then raise exception 'Ungültiger Betrag'; end if;
  v_item := jsonb_build_object('id', 'ci' || _zufall_text('abcdefghijklmnopqrstuvwxyz0123456789', 14), 'label', v_label, 'amount', round(p_betrag, 2))
    || case when nullif(btrim(coalesce(p_preisposten, '')), '') is not null then jsonb_build_object('preisposten', left(btrim(p_preisposten), 40)) else '{}'::jsonb end
    || jsonb_build_object('erfasstVon', 'buero', 'erfasstAm', clock_timestamp()::text);
  update students set data = jsonb_set(_schul_aenderung(data, 'costItems'), '{costItems}', _json_liste(data->'costItems') || v_item), updated_at = now()
   where id = p_student_id;
  perform _akte_protokoll(v_school, p_student_id, v_owner, _schueler_name(v_data) || ' · Kostenposten „' || v_label || '“ ' || replace(to_char(round(p_betrag, 2), 'FM999990.00'), '.', ',') || ' €');
  return v_item;
end $$;

-- Wie removeItem() der App: ein berechneter Posten bleibt; mit dem Posten verschwindet sein Paket-Eintrag
create or replace function public.school_kostenposten_entfernen(p_student_id uuid, p_id text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid; v_owner uuid; v_data jsonb; v_item jsonb;
begin
  select o_school, o_owner, o_data into v_school, v_owner, v_data from _schul_schueler(p_student_id);
  select e into v_item from jsonb_array_elements(_json_liste(v_data->'costItems')) e where e->>'id' = p_id limit 1;
  if v_item is null then raise exception 'Diesen Kostenposten gibt es nicht mehr'; end if;
  if coalesce(v_item->>'invoiced', '') <> '' then raise exception 'Der Posten steht schon auf einer Rechnung – erst die Rechnung stornieren'; end if;
  update students set data = jsonb_set(jsonb_set(
           _buero_entfernt(_buero_entfernt(_schul_aenderung(_schul_aenderung(data, 'costItems'), 'packages'), 'costItems', p_id), 'packages', p_id),
           '{costItems}', coalesce((select jsonb_agg(e) from jsonb_array_elements(_json_liste(data->'costItems')) e where e->>'id' is distinct from p_id), '[]'::jsonb)),
           '{packages}', coalesce((select jsonb_agg(e) from jsonb_array_elements(_json_liste(data->'packages')) e where e->>'costItemId' is distinct from p_id), '[]'::jsonb)),
         updated_at = now()
   where id = p_student_id;
  perform _akte_protokoll(v_school, p_student_id, v_owner, _schueler_name(v_data) || ' · Kostenposten „' || coalesce(v_item->>'label', '') || '“ entfernt');
end $$;

-- Paket der Fahrschule übernehmen (wie „Oder ein Paket übernehmen“ in der App): Kostenposten + Paket mit Freistunden
create or replace function public.school_paket_zuweisen(p_student_id uuid, p_paket text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid; v_owner uuid; v_data jsonb; v_pk jsonb; v_item jsonb; v_am text := clock_timestamp()::text;
begin
  select o_school, o_owner, o_data into v_school, v_owner, v_data from _schul_schueler(p_student_id);
  select e into v_pk from schools sc, jsonb_array_elements(_json_liste(sc.packages)) e where sc.id = v_school and e->>'name' = p_paket limit 1;
  if v_pk is null then raise exception 'Dieses Paket gibt es in der Fahrschule nicht'; end if;
  if coalesce((v_pk->>'amount')::numeric, 0) <= 0 then raise exception 'Das Paket hat keinen Preis'; end if;
  v_item := jsonb_build_object('id', 'ci' || _zufall_text('abcdefghijklmnopqrstuvwxyz0123456789', 14), 'label', v_pk->>'name',
    'amount', (v_pk->>'amount')::numeric, 'erfasstVon', 'buero', 'erfasstAm', v_am);
  update students set data = jsonb_set(jsonb_set(_schul_aenderung(_schul_aenderung(data, 'costItems'), 'packages'),
           '{costItems}', _json_liste(data->'costItems') || v_item),
           '{packages}', _json_liste(data->'packages') || jsonb_build_object('name', v_pk->>'name', 'amount', (v_pk->>'amount')::numeric,
             'includedUE', coalesce((v_pk->>'includedUE')::numeric, 0), 'date', to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM-DD'),
             'costItemId', v_item->>'id', 'erfasstVon', 'buero', 'erfasstAm', v_am)),
         updated_at = now()
   where id = p_student_id;
  perform _akte_protokoll(v_school, p_student_id, v_owner, _schueler_name(v_data) || ' · Paket „' || (v_pk->>'name') || '“');
  return v_item;
end $$;

-- ── Ausbildungsvertrag ───────────────────────────────────────────────────
-- Wie createContract() der App: Nummer V-Jahr-Folge, Klasse, Preis je UE der Fahrschule und das zuletzt übernommene
-- Paket des Schülers. Der Wortlaut (§§ 1–5) entsteht beim Drucken bzw. beim Senden (fern.abschnitte).
create or replace function public.school_vertrag_anlegen(p_student_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid; v_owner uuid; v_data jsonb; v_pk jsonb; v_vertrag jsonb; v_preis numeric;
begin
  select o_school, o_owner, o_data into v_school, v_owner, v_data from _schul_schueler(p_student_id);
  select coalesce(price_hour, 0) into v_preis from schools where id = v_school;
  select e into v_pk from jsonb_array_elements(_json_liste(v_data->'packages')) with ordinality t(e, i) order by i desc limit 1;
  v_vertrag := jsonb_build_object('id', 'vtr_' || _zufall_text('abcdefghijklmnopqrstuvwxyz0123456789', 7), 'number', next_document_number(v_school, 'contract'),
    'date', to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM-DD'), 'klasse', coalesce(nullif(v_data->>'klasse', ''), 'B'), 'priceUE', v_preis,
    'packageName', coalesce(v_pk->>'name', ''), 'packageAmount', coalesce(v_pk->'amount', '0'::jsonb),
    'includedUE', coalesce(case when (v_pk->>'includedUE') ~ '^-?\d+(\.\d+)?$' then (v_pk->>'includedUE')::numeric end, 0),
    'erfasstVon', 'buero', 'erfasstAm', clock_timestamp()::text);
  update students set data = jsonb_set(_schul_aenderung(data, 'contracts'), '{contracts}', _json_liste(data->'contracts') || v_vertrag), updated_at = now()
   where id = p_student_id;
  perform _akte_protokoll(v_school, p_student_id, v_owner, _schueler_name(v_data) || ' · Ausbildungsvertrag ' || (v_vertrag->>'number') || ' erstellt');
  return v_vertrag;
end $$;

-- Zur Unterschrift in die Schüler-App geben: Schnappschuss des Wortlauts (fern) wie vertragPerHandy() der App.
-- Hat der Schüler noch keinen Zugang (kein PIN), bekommt er einen Start-PIN wie über „Zugang senden“ der App
-- (p_neuer_pin erzwingt einen neuen, etwa wenn er seinen vergessen hat). Liefert den Buchungscode des Fahrlehrers
-- (Anmeldung über APP_URL/?buchen=<code>), den Start-PIN nur, wenn er gerade vergeben wurde, und die Kontaktdaten.
create or replace function public.school_vertrag_senden(p_student_id uuid, p_vertrag_id text, p_fern jsonb, p_neuer_pin boolean default false) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid; v_owner uuid; v_data jsonb; v_c jsonb; v_code text; v_pin text; v_neu jsonb; i int;
begin
  select o_school, o_owner, o_data into v_school, v_owner, v_data from _schul_schueler(p_student_id);
  if jsonb_typeof(p_fern) is distinct from 'object' or jsonb_typeof(p_fern->'abschnitte') is distinct from 'array' or length(p_fern::text) > 60000 then
    raise exception 'Ungültiger Vertragstext';
  end if;
  select e into v_c from jsonb_array_elements(_json_liste(v_data->'contracts')) e where e->>'id' = p_vertrag_id limit 1;
  if v_c is null then raise exception 'Diesen Vertrag gibt es nicht mehr'; end if;
  if coalesce(v_c->>'studentSignature', '') <> '' or coalesce(v_data->'vertragUnterschriften', '{}'::jsonb) ? p_vertrag_id then
    raise exception 'Der Vertrag ist schon unterschrieben';
  end if;
  v_neu := jsonb_set(_schul_aenderung(v_data, 'contracts'), '{contracts}',
    (select jsonb_agg(case when e->>'id' = p_vertrag_id
                           then e || jsonb_build_object('fern', (p_fern - 'am') || jsonb_build_object('am', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
                           else e end)
       from jsonb_array_elements(_json_liste(v_data->'contracts')) e));
  -- Zugang zur Schüler-App: Start-PIN wie teacher_reset_student_pin (der Trigger hasht ihn beim Speichern)
  if coalesce(p_neuer_pin, false) or (coalesce(v_data->>'pin', '') = '' and coalesce(v_data->>'pinCustom', '') = '') then
    v_pin := _zufall_text('0123456789', 6);
    v_neu := (_schul_aenderung(_schul_aenderung(v_neu, 'pin'), 'pinChanged') - 'pinCustom') || jsonb_build_object('pin', v_pin, 'pinChanged', false);
    delete from student_login_throttle
     where throttle_key = v_owner::text || '|' || regexp_replace(lower(btrim(coalesce(v_data->>'vorname', '') || ' ' || coalesce(v_data->>'name', ''))), '\s+', ' ', 'g');
  end if;
  update students set data = v_neu, updated_at = now() where id = p_student_id;
  -- Buchungscode des Fahrlehrers (wie fetchBookingCode der App: 9 Zeichen a–z0–9), fehlt er, wird er angelegt
  select booking_code into v_code from profiles where id = v_owner;
  i := 0;
  while coalesce(v_code, '') = '' and i < 5 loop
    i := i + 1;
    begin
      v_code := _zufall_text('abcdefghijklmnopqrstuvwxyz0123456789', 9);
      update profiles set booking_code = v_code where id = v_owner and coalesce(booking_code, '') = '';
      select booking_code into v_code from profiles where id = v_owner;
    exception when unique_violation then v_code := null;
    end;
  end loop;
  if coalesce(v_code, '') = '' then raise exception 'Der Anmelde-Link konnte nicht erzeugt werden. Bitte gleich noch einmal versuchen.'; end if;
  perform _akte_protokoll(v_school, p_student_id, v_owner, _schueler_name(v_data) || ' · Ausbildungsvertrag ' || coalesce(v_c->>'number', '') || ' zur Unterschrift'
    || case when v_pin is not null then ', Zugang zur Schüler-App' else '' end);
  return jsonb_build_object('code', v_code, 'pin', v_pin, 'tel', coalesce(v_data->>'tel', ''), 'email', coalesce(v_data->>'email', ''),
    'vorname', coalesce(v_data->>'vorname', ''), 'name', coalesce(v_data->>'name', ''));
end $$;

-- Versehentlich erstellten Vertrag entfernen – nur, solange niemand unterschrieben hat (wie removeContract der App)
create or replace function public.school_vertrag_entfernen(p_student_id uuid, p_vertrag_id text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid; v_owner uuid; v_data jsonb; v_c jsonb;
begin
  select o_school, o_owner, o_data into v_school, v_owner, v_data from _schul_schueler(p_student_id);
  select e into v_c from jsonb_array_elements(_json_liste(v_data->'contracts')) e where e->>'id' = p_vertrag_id limit 1;
  if v_c is null then raise exception 'Diesen Vertrag gibt es nicht mehr'; end if;
  if coalesce(v_c->>'studentSignature', '') <> '' or coalesce(v_c->>'instrSignature', '') <> '' or coalesce(v_data->'vertragUnterschriften', '{}'::jsonb) ? p_vertrag_id then
    raise exception 'Unterschriebene Verträge bleiben erhalten';
  end if;
  update students set data = jsonb_set(_buero_entfernt(_schul_aenderung(data, 'contracts'), 'contracts', p_vertrag_id), '{contracts}',
           coalesce((select jsonb_agg(e) from jsonb_array_elements(_json_liste(data->'contracts')) e where e->>'id' is distinct from p_vertrag_id), '[]'::jsonb)),
         updated_at = now()
   where id = p_student_id;
  perform _akte_protokoll(v_school, p_student_id, v_owner, _schueler_name(v_data) || ' · Ausbildungsvertrag ' || coalesce(v_c->>'number', '') || ' entfernt');
end $$;

-- ── Dokumente der Schüler ────────────────────────────────────────────────
-- Speicherpfad wie uploadStudentFile() der App: <hochladende Person>/<Schüler-ID>/stf_…-<name>
create or replace function public._schule_darf_schuelerdatei(p_name text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from students s join profiles p on p.id = s.owner
                  where s.id::text = (storage.foldername(p_name))[2] and _darf_schulweit(p.school_id));
$$;
revoke all on function public._schule_darf_schuelerdatei(text) from public, anon;
grant execute on function public._schule_darf_schuelerdatei(text) to authenticated;

drop policy if exists schule_liest_schuelerdateien on storage.objects;
create policy schule_liest_schuelerdateien on storage.objects for select to authenticated
  using (bucket_id = 'student-files' and public._schule_darf_schuelerdatei(name));
drop policy if exists schule_laedt_schuelerdateien_hoch on storage.objects;
create policy schule_laedt_schuelerdateien_hoch on storage.objects for insert to authenticated
  with check (bucket_id = 'student-files' and (storage.foldername(name))[1] = (select auth.uid())::text
              and array_length(storage.foldername(name), 1) = 2 and public._schule_darf_schuelerdatei(name)
              and not public._ist_demo());
drop policy if exists schule_loescht_eigene_schuelerdateien on storage.objects;
create policy schule_loescht_eigene_schuelerdateien on storage.objects for delete to authenticated
  using (bucket_id = 'student-files' and (storage.foldername(name))[1] = (select auth.uid())::text and public._schule_darf_schuelerdatei(name));

create or replace function public.school_schueler_dateien(p_student_id uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_school uuid;
begin
  select p.school_id into v_school from students s join profiles p on p.id = s.owner where s.id = p_student_id;
  if v_school is null or not _darf_schulweit(v_school) then raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kategorie', f.category, 'name', f.filename, 'pfad', f.storage_path, 'groesse', f.size_bytes,
      'am', f.created_at, 'von_schueler', coalesce(f.von_schueler, false), 'geprueft_am', f.geprueft_at, 'eigene', f.owner = auth.uid()) order by f.created_at desc)
    from student_files f where f.student_id = p_student_id), '[]'::jsonb);
end $$;

create or replace function public.school_schueler_datei_eintragen(p_student_id uuid, p_kategorie text, p_name text, p_pfad text, p_groesse bigint) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid; v_owner uuid; v_data jsonb; v_id uuid; v_kat text := coalesce(nullif(btrim(p_kategorie), ''), 'sonstiges');
begin
  select o_school, o_owner, o_data into v_school, v_owner, v_data from _schul_schueler(p_student_id);
  if v_kat not in ('sehtest', 'erstehilfe', 'passfoto', 'antrag', 'sonstiges') then raise exception 'Unbekannte Art'; end if;
  if p_pfad is null or p_pfad !~ ('^' || auth.uid()::text || '/' || p_student_id::text || '/[A-Za-z0-9._-]+$') then raise exception 'Ungültiger Speicherort'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'student-files' and o.name = p_pfad) then raise exception 'Die Datei ist noch nicht hochgeladen'; end if;
  insert into student_files(student_id, owner, category, filename, storage_path, size_bytes)
  values (p_student_id, auth.uid(), v_kat, left(coalesce(nullif(btrim(p_name), ''), 'Dokument'), 200), p_pfad, p_groesse)
  returning id into v_id;
  perform _akte_protokoll(v_school, p_student_id, v_owner, _schueler_name(v_data) || ' · Dokument „' || left(coalesce(nullif(btrim(p_name), ''), 'Dokument'), 80) || '“ hochgeladen');
  return jsonb_build_object('id', v_id);
end $$;

-- Nur selbst hochgeladene Dokumente; die Datei im Speicher löscht vorher der Autopilot (eigene Lösch-Regel oben)
create or replace function public.school_schueler_datei_entfernen(p_datei_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_f student_files%rowtype; v_school uuid; v_owner uuid; v_data jsonb;
begin
  select * into v_f from student_files where id = p_datei_id;
  if v_f.id is null then raise exception 'Dieses Dokument gibt es nicht mehr'; end if;
  select o_school, o_owner, o_data into v_school, v_owner, v_data from _schul_schueler(v_f.student_id);
  if v_f.owner is distinct from auth.uid() then raise exception 'Entfernen kann nur, wer das Dokument hochgeladen hat'; end if;
  delete from student_files where id = p_datei_id;
  perform _akte_protokoll(v_school, v_f.student_id, v_owner, _schueler_name(v_data) || ' · Dokument „' || left(v_f.filename, 80) || '“ entfernt');
end $$;

-- ── Ausbildung beenden ───────────────────────────────────────────────────
-- Wie archivierenUmschalten() der App: archived + archivedAt (bleibt beim Zurückholen stehen)
create or replace function public.school_schueler_archivieren(p_student_id uuid, p_beendet boolean) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid; v_owner uuid; v_data jsonb;
begin
  select o_school, o_owner, o_data into v_school, v_owner, v_data from _schul_schueler(p_student_id);
  if coalesce(v_data->'archived' = 'true'::jsonb, false) = coalesce(p_beendet, false) then return; end if;
  update students set data = case when coalesce(p_beendet, false)
           then jsonb_set(jsonb_set(_schul_aenderung(_schul_aenderung(data, 'archived'), 'archivedAt'), '{archived}', 'true'::jsonb),
                '{archivedAt}', to_jsonb(coalesce(nullif(data->>'archivedAt', ''), to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM-DD'))))
           else jsonb_set(_schul_aenderung(data, 'archived'), '{archived}', 'false'::jsonb) end,
         updated_at = now()
   where id = p_student_id;
  perform _akte_protokoll(v_school, p_student_id, v_owner, _schueler_name(v_data) || case when coalesce(p_beendet, false) then ' · Ausbildung beendet' else ' · wieder aktiv' end);
end $$;

revoke all on function public.school_schueler_anlegen(uuid, uuid, jsonb), public.school_kostenposten_anlegen(uuid, text, numeric, text),
  public.school_kostenposten_entfernen(uuid, text), public.school_paket_zuweisen(uuid, text), public.school_vertrag_anlegen(uuid),
  public.school_vertrag_senden(uuid, text, jsonb, boolean), public.school_vertrag_entfernen(uuid, text), public.school_schueler_dateien(uuid),
  public.school_schueler_datei_eintragen(uuid, text, text, text, bigint), public.school_schueler_datei_entfernen(uuid),
  public.school_schueler_archivieren(uuid, boolean) from public, anon;
grant execute on function public.school_schueler_anlegen(uuid, uuid, jsonb), public.school_kostenposten_anlegen(uuid, text, numeric, text),
  public.school_kostenposten_entfernen(uuid, text), public.school_paket_zuweisen(uuid, text), public.school_vertrag_anlegen(uuid),
  public.school_vertrag_senden(uuid, text, jsonb, boolean), public.school_vertrag_entfernen(uuid, text), public.school_schueler_dateien(uuid),
  public.school_schueler_datei_eintragen(uuid, text, text, text, bigint), public.school_schueler_datei_entfernen(uuid),
  public.school_schueler_archivieren(uuid, boolean) to authenticated;

-- ── Speichern der Fahrlehrer-App: Listen mit Büro-Einträgen zusammenführen ──
-- Bisher gewann bei einer Schul-Markierung die ganze Liste des Servers. Für costItems/packages/contracts heißt das jetzt:
-- der Geräte-Stand bleibt, was das Büro seitdem entfernt hat (bueroEntfernt), fällt weg, Büro-Einträge, die das Gerät
-- noch nicht kennen kann (erfasstAm nach seiner Markierung), kommen dazu, und ein vom Büro gesendeter Vertrag behält
-- seinen Wortlaut (fern). Eingefügt per Ersetzung in die bestehende Funktion, mit Prüfung, dass jede Stelle genau einmal passt.
do $do$
declare
  v_def text := pg_get_functiondef('public.students_teacher_update(uuid,jsonb)'::regprocedure);
  v_anker1 constant text := E'      elsif position(''.'' in v_k) > 0 then';
  v_anker2 constant text := E'''vertragUnterschriften'', v_current->''vertragUnterschriften''';
  v_zweig constant text := $zweig$      elsif v_k in ('costItems', 'packages', 'contracts') then
        -- Listen mit Büro-Einträgen (Autopilot, 23.10.2026): Geräte-Stand ohne vom Büro Entferntes, dazu Büro-Einträge,
        -- die das Gerät noch nicht kennen kann; ein vom Büro gesendeter Vertrag behält seinen Wortlaut (fern).
        v_neu := jsonb_set(v_neu, array[v_k], coalesce((
          select jsonb_agg(x.e order by x.quelle, x.nr) from (
            select 1 as quelle, c.nr,
                   case when v_k = 'contracts' and s.e ? 'fern' and not (c.e ? 'fern') then c.e || jsonb_build_object('fern', s.e->'fern') else c.e end as e
              from jsonb_array_elements(case when jsonb_typeof(v_neu->v_k) = 'array' then v_neu->v_k else '[]'::jsonb end) with ordinality c(e, nr)
              left join lateral (select s1.e from jsonb_array_elements(case when jsonb_typeof(v_current->v_k) = 'array' then v_current->v_k else '[]'::jsonb end) s1(e)
                                  where c.e ? 'id' and s1.e->>'id' = c.e->>'id' limit 1) s on true
             where not exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(v_current->'bueroEntfernt'->v_k) = 'array' then v_current->'bueroEntfernt'->v_k else '[]'::jsonb end) w(x)
                                where w.x = coalesce(c.e->>'id', c.e->>'costItemId', ''))
            union all
            select 2, s.nr, s.e from jsonb_array_elements(case when jsonb_typeof(v_current->v_k) = 'array' then v_current->v_k else '[]'::jsonb end) with ordinality s(e, nr)
             where s.e->>'erfasstVon' = 'buero' and coalesce(s.e->>'erfasstAm', '') > coalesce(p_data->'schulAenderungen'->>v_k, '')
               and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_neu->v_k) = 'array' then v_neu->v_k else '[]'::jsonb end) c2(e2)
                                where coalesce(c2.e2->>'id', c2.e2->>'costItemId', '') = coalesce(s.e->>'id', s.e->>'costItemId', ''))) x), '[]'::jsonb));
$zweig$;
begin
  if position('bueroEntfernt' in v_def) > 0 then return; end if; -- schon eingespielt
  if (length(v_def) - length(replace(v_def, v_anker1, ''))) / length(v_anker1) <> 1
     or (length(v_def) - length(replace(v_def, v_anker2, ''))) / length(v_anker2) <> 1 then
    raise exception 'students_teacher_update hat sich verändert – Ersetzung abgebrochen';
  end if;
  v_def := replace(v_def, v_anker1, v_zweig || v_anker1);
  v_def := replace(v_def, v_anker2, v_anker2 || E',\n        ''bueroEntfernt'', v_current->''bueroEntfernt''');
  execute v_def;
end $do$;
