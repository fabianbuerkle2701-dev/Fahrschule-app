-- 2026-09-28 · Schulwechsel per Übergabecode (Fahrschulreform F10) · v2.46.0
--
-- Die bisherige Fahrschule erstellt für einen Schüler einen Code (8 Zeichen, 30 Tage gültig) und
-- gibt ihn dem Schüler mit - der Schüler entscheidet also selbst, wem er ihn gibt (Zustimmung).
-- Die neue Fahrschule löst ihn ein und bekommt einen neuen Schüler mit dem Ausbildungsstand.
--
-- Übergeben wird NUR eine feste Liste von Feldern, serverseitig zusammengestellt: Stammdaten,
-- Klasse, Theorie, Prüfungsversuche (ohne Notizen), Unterlagen, ADK/Strecken-Fortschritt, manuell
-- gezählte Stunden und die gefahrenen Stunden als reine Liste (Datum, Minuten, Art, Klasse).
-- NICHT übergeben: Rechnungen, Zahlungen, Preise, Notizen/Bemerkungen, Nachrichten, PIN,
-- Prüfungsreife (die stellt die neue Schule selbst fest), Dokumente.
-- Beim Einlösen werden die gefahrenen Stunden NICHT als drivenLessons angelegt (die würden bei der
-- neuen Schule abgerechnet und in Vergütung/Statistik gezählt), sondern unter data.uebernahme -
-- die Sonderfahrten-Bilanz zählt sie mit (sonderfahrtenBilanz im Client).
-- Die bisherige Fahrschule behält ihren Datensatz unverändert (Aufbewahrungspflichten).

create table if not exists public.schueler_wechsel (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  student_id uuid not null,
  von_school uuid,
  von_user uuid not null,
  snapshot jsonb not null,
  erstellt_am timestamptz not null default now(),
  gueltig_bis timestamptz not null,
  eingeloest_am timestamptz,
  eingeloest_von uuid,
  neuer_student uuid
);
alter table public.schueler_wechsel enable row level security;
-- Keine Policies: Zugriff ausschließlich über die Funktionen unten.

create or replace function public._wechsel_code_norm(p_code text)
returns text language sql immutable set search_path to 'public' as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- 1) Code erstellen (Besitzer, Freigegebene, Admin/Büro der Schule)
create or replace function public.wechsel_erstellen(p_student_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_owner uuid; v_shared uuid[]; d jsonb; v_school uuid; v_snap jsonb; v_code text := ''; v_bytes bytea; i int;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bis timestamptz := now() + interval '30 days';
begin
  if _ist_demo() then raise exception 'Im Demo-Modus werden keine Übergabecodes erstellt.'; end if;
  select owner, shared_with, data into v_owner, v_shared, d from students where id = p_student_id;
  if v_owner is null then raise exception 'Schüler nicht gefunden'; end if;
  select school_id into v_school from profiles where id = v_owner;
  if not (auth.uid() = v_owner or auth.uid() = any(coalesce(v_shared, '{}'::uuid[]))
          or (v_school is not null and _darf_schulweit(v_school))) then
    raise exception 'Kein Zugriff auf diesen Schüler';
  end if;
  v_snap := jsonb_strip_nulls(jsonb_build_object(
    'vorname', d->'vorname', 'name', d->'name', 'geb', d->'geb', 'tel', d->'tel', 'festnetz', d->'festnetz',
    'anschrift', d->'anschrift', 'klasse', d->'klasse', 'ersterwerb', d->'ersterwerb', 'sehhilfe', d->'sehhilfe',
    'theorie', d->'theorie', 'ausbildungsbeginn', d->'ausbildungsbeginn',
    'licenseSteps', d->'licenseSteps', 'items', d->'items', 'adkDates', d->'adkDates', 'strecken', d->'strecken',
    'manualHours', d->'manualHours',
    'exams', (select jsonb_agg(e - 'note' - 'notiz' - 'bemerkung' - 'bemerkungen')
                from jsonb_array_elements(case when jsonb_typeof(d->'exams') = 'array' then d->'exams' else '[]'::jsonb end) e),
    'fahrstunden', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('date', e->'date', 'minutes', e->'minutes', 'art', e->'art', 'klasse', e->'klasse')) order by e->>'date')
                      from jsonb_array_elements(case when jsonb_typeof(d->'drivenLessons') = 'array' then d->'drivenLessons' else '[]'::jsonb end) e)));
  -- Frühere, noch offene Codes dieses Schülers verfallen (es gilt immer nur der neueste).
  update schueler_wechsel set gueltig_bis = now() where student_id = p_student_id and eingeloest_am is null and gueltig_bis > now();
  for versuch in 1..5 loop
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_code := '';
    for i in 0..7 loop v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from schueler_wechsel where code = v_code);
  end loop;
  insert into schueler_wechsel(code, student_id, von_school, von_user, snapshot, gueltig_bis)
  values (v_code, p_student_id, v_school, auth.uid(), v_snap, v_bis);
  return jsonb_build_object('code', v_code, 'gueltig_bis', v_bis);
end $$;
revoke all on function public.wechsel_erstellen(uuid) from public, anon;
grant execute on function public.wechsel_erstellen(uuid) to authenticated;

-- 2) Vorschau für die neue Fahrschule
create or replace function public.wechsel_vorschau(p_code text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare w schueler_wechsel%rowtype; v_meine uuid; v_name text;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select * into w from schueler_wechsel where code = _wechsel_code_norm(p_code);
  if w.id is null or w.gueltig_bis <= now() then raise exception 'Code ungültig oder abgelaufen'; end if;
  if w.eingeloest_am is not null then raise exception 'Dieser Code wurde schon eingelöst'; end if;
  select school_id into v_meine from profiles where id = auth.uid();
  if w.von_school is not null and v_meine = w.von_school then
    raise exception 'Der Schüler ist schon in deiner Fahrschule - dort bitte über das Fahrschul-Dashboard zuteilen';
  end if;
  select name into v_name from schools where id = w.von_school;
  return jsonb_build_object('von_schule', coalesce(v_name, 'andere Fahrschule'), 'erstellt_am', w.erstellt_am,
    'gueltig_bis', w.gueltig_bis, 'schueler', w.snapshot);
end $$;
revoke all on function public.wechsel_vorschau(text) from public, anon;
grant execute on function public.wechsel_vorschau(text) to authenticated;

-- 3) Einlösen: neuer Schüler im eigenen Bestand, in einer Transaktion
create or replace function public.wechsel_einloesen(p_code text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare w schueler_wechsel%rowtype; v_meine uuid; v_buero boolean; v_name text; v_neu uuid;
begin
  if _ist_demo() then raise exception 'Im Demo-Modus werden keine Schüler übernommen.'; end if;
  select school_id, coalesce(school_office, false) into v_meine, v_buero from profiles where id = auth.uid();
  if not found then raise exception 'Nicht angemeldet'; end if;
  if v_buero then raise exception 'Schüler übernimmt ein Fahrlehrer - das Büro kann ihn danach zuteilen'; end if;
  select * into w from schueler_wechsel where code = _wechsel_code_norm(p_code) for update;
  if w.id is null or w.gueltig_bis <= now() then raise exception 'Code ungültig oder abgelaufen'; end if;
  if w.eingeloest_am is not null then raise exception 'Dieser Code wurde schon eingelöst'; end if;
  if w.von_school is not null and v_meine = w.von_school then
    raise exception 'Der Schüler ist schon in deiner Fahrschule - dort bitte über das Fahrschul-Dashboard zuteilen';
  end if;
  select name into v_name from schools where id = w.von_school;
  insert into students(owner, data, shared_with)
  values (auth.uid(),
          (w.snapshot - 'fahrstunden') || jsonb_build_object('archived', false,
            'uebernahme', jsonb_build_object('vonSchule', coalesce(v_name, 'andere Fahrschule'),
              'am', to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD'),
              'fahrstunden', coalesce(w.snapshot->'fahrstunden', '[]'::jsonb))),
          '{}')
  returning id into v_neu;
  update schueler_wechsel set eingeloest_am = now(), eingeloest_von = auth.uid(), neuer_student = v_neu where id = w.id;
  return v_neu;
end $$;
revoke all on function public.wechsel_einloesen(text) from public, anon;
grant execute on function public.wechsel_einloesen(text) to authenticated;
