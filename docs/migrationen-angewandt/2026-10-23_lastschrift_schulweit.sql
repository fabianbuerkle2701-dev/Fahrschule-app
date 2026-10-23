-- Allindrive Autopilot · Lastschrift schulweit (Fabian 23.10.2026, Lückenliste „Lastschrift schulweit“). Admin und Büro
-- verwalten die SEPA-Mandate aller Schüler und verbuchen den Einzug – gleiche Datenform wie die App (v2.99.0):
--   · school_rechnungen liefert Mandat (ohne Unterschriftsbild) und offene Anfrage mit
--   · Papier-Mandat erfassen (Referenz wie sepaMandatsreferenz: AD-<12 Zeichen der Schüler-Id>-<Datum>)   school_sepa_mandat_setzen
--   · Mandat widerrufen (wie sepaMandatWiderrufen)                                                       school_sepa_mandat_widerrufen
--   · Mandat per Schüler-App anfordern (sepaAnfrage) samt App-Zugang (Start-PIN, falls noch keiner)      school_sepa_anfordern
--   · Einzug verbuchen: je Rechnung eine Zahlung „Lastschrift“ zum Fälligkeitstag, letzterEinzug am Mandat
--     (wie sepaEinzugGebucht); dieselbe Datei nie doppelt, Betrag nie über dem Offenen                      school_lastschrift_buchen
-- Der App-Zugang (Start-PIN + Buchungscode) steckt jetzt in einer gemeinsamen Hilfe _schueler_app_zugang, die auch
-- school_vertrag_senden nutzt (gleiches Verhalten wie bisher).

-- ── Gemeinsamer App-Zugang: Start-PIN wie teacher_reset_student_pin, Buchungscode wie fetchBookingCode ──
create or replace function public._schueler_app_zugang(p_student_id uuid, p_neu boolean, out o_code text, out o_pin text)
language plpgsql security definer set search_path to 'public' as $$
declare v_owner uuid; v_data jsonb; i int := 0;
begin
  select owner, data into v_owner, v_data from students where id = p_student_id for update;
  if coalesce(p_neu, false) or (coalesce(v_data->>'pin', '') = '' and coalesce(v_data->>'pinCustom', '') = '') then
    o_pin := _zufall_text('0123456789', 6);
    update students set data = (_schul_aenderung(_schul_aenderung(data, 'pin'), 'pinChanged') - 'pinCustom') || jsonb_build_object('pin', o_pin, 'pinChanged', false),
           updated_at = now()
     where id = p_student_id;
    delete from student_login_throttle
     where throttle_key = v_owner::text || '|' || regexp_replace(lower(btrim(coalesce(v_data->>'vorname', '') || ' ' || coalesce(v_data->>'name', ''))), '\s+', ' ', 'g');
  end if;
  select booking_code into o_code from profiles where id = v_owner;
  while coalesce(o_code, '') = '' and i < 5 loop
    i := i + 1;
    begin
      o_code := _zufall_text('abcdefghijklmnopqrstuvwxyz0123456789', 9);
      update profiles set booking_code = o_code where id = v_owner and coalesce(booking_code, '') = '';
      select booking_code into o_code from profiles where id = v_owner;
    exception when unique_violation then o_code := null;
    end;
  end loop;
  if coalesce(o_code, '') = '' then raise exception 'Der Anmelde-Link konnte nicht erzeugt werden. Bitte gleich noch einmal versuchen.'; end if;
end $$;
revoke all on function public._schueler_app_zugang(uuid, boolean) from public, anon, authenticated;

create or replace function public.school_vertrag_senden(p_student_id uuid, p_vertrag_id text, p_fern jsonb, p_neuer_pin boolean default false) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid; v_owner uuid; v_data jsonb; v_c jsonb; v_z record;
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
  update students set data = jsonb_set(_schul_aenderung(data, 'contracts'), '{contracts}',
           (select jsonb_agg(case when e->>'id' = p_vertrag_id
                                  then e || jsonb_build_object('fern', (p_fern - 'am') || jsonb_build_object('am', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
                                  else e end)
              from jsonb_array_elements(_json_liste(data->'contracts')) e)),
         updated_at = now()
   where id = p_student_id;
  select * into v_z from _schueler_app_zugang(p_student_id, p_neuer_pin);
  perform _akte_protokoll(v_school, p_student_id, v_owner, _schueler_name(v_data) || ' · Ausbildungsvertrag ' || coalesce(v_c->>'number', '') || ' zur Unterschrift'
    || case when v_z.o_pin is not null then ', Zugang zur Schüler-App' else '' end);
  return jsonb_build_object('code', v_z.o_code, 'pin', v_z.o_pin, 'tel', coalesce(v_data->>'tel', ''), 'email', coalesce(v_data->>'email', ''),
    'vorname', coalesce(v_data->>'vorname', ''), 'name', coalesce(v_data->>'name', ''));
end $$;

-- ── Rechnungen der Fahrschule: jetzt mit Mandat und Anfrage ──
do $do$
declare
  v_def text := pg_get_functiondef('public.school_rechnungen(uuid)'::regprocedure);
  v_anker constant text := $a$'reminders', case when jsonb_typeof(s.data->'reminders') = 'array' then s.data->'reminders' else '[]'::jsonb end,$a$;
begin
  if position('sepa_mandat' in v_def) > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, v_anker, ''))) / length(v_anker) <> 1 then raise exception 'school_rechnungen hat sich verändert – Ersetzung abgebrochen'; end if;
  execute replace(v_def, v_anker, v_anker || $a$
             'sepa_mandat', case when jsonb_typeof(s.data->'sepaMandat') = 'object' then (s.data->'sepaMandat') - 'sig' end,
             'sepa_anfrage', case when jsonb_typeof(s.data->'sepaAnfrage') = 'object' then s.data->'sepaAnfrage' end,$a$);
end $do$;

-- ── Mandat auf Papier erfassen ──
create or replace function public.school_sepa_mandat_setzen(p_student_id uuid, p_inhaber text, p_iban text, p_bic text, p_datum date) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid; v_owner uuid; v_data jsonb; v_inh text; v_iban text; v_bic text; v_ref text; v_m jsonb;
begin
  select o_school, o_owner, o_data into v_school, v_owner, v_data from _schul_schueler(p_student_id);
  v_inh := btrim(coalesce(p_inhaber, ''));
  if length(v_inh) < 2 or length(v_inh) > 70 then raise exception 'Bitte den Kontoinhaber angeben'; end if;
  v_iban := upper(regexp_replace(coalesce(p_iban, ''), '[^A-Za-z0-9]', '', 'g'));
  if not _iban_gueltig(v_iban) then raise exception 'Diese IBAN stimmt nicht – bitte noch einmal prüfen'; end if;
  v_bic := nullif(upper(regexp_replace(coalesce(p_bic, ''), '[^A-Za-z0-9]', '', 'g')), '');
  if v_bic is not null and v_bic !~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$' then raise exception 'Die BIC hat 8 oder 11 Zeichen'; end if;
  if v_bic is null and left(v_iban, 2) in ('CH', 'GB', 'MC', 'SM', 'VA', 'AD', 'GI', 'JE', 'GG', 'IM', 'AL', 'MD', 'ME', 'MK', 'RS') then
    raise exception 'Für Konten außerhalb der EU wird die BIC benötigt';
  end if;
  if p_datum is null or p_datum > (now() at time zone 'Europe/Berlin')::date or p_datum < (now() at time zone 'Europe/Berlin')::date - 3650 then
    raise exception 'Bitte das Datum der Unterschrift angeben';
  end if;
  v_ref := 'AD-' || left(upper(regexp_replace(p_student_id::text, '[^A-Za-z0-9]', '', 'g')), 12) || '-' || to_char(p_datum, 'YYYYMMDD');
  v_m := jsonb_strip_nulls(jsonb_build_object('referenz', v_ref, 'datum', p_datum::text, 'inhaber', v_inh, 'iban', v_iban, 'bic', v_bic, 'via', 'papier', 'aktiv', true,
    'erfasstVon', 'buero',
    -- dieselbe Referenz (Korrektur am selben Tag): der letzte Einzug bleibt, damit die Bank „Folge-Lastschrift“ bekommt
    'letzterEinzug', case when v_data->'sepaMandat'->>'referenz' = v_ref then v_data->'sepaMandat'->>'letzterEinzug' end,
    'stand', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  update students set data = (data - 'sepaAnfrage') || jsonb_build_object('sepaMandat', v_m), updated_at = now() where id = p_student_id;
  perform _akte_protokoll(v_school, p_student_id, v_owner, _schueler_name(v_data) || ' · Lastschrift-Mandat erfasst (IBAN ' || left(v_iban, 4) || ' •••• ' || right(v_iban, 4) || ')');
  return v_m - 'iban' || jsonb_build_object('iban', left(v_iban, 4) || ' •••• ' || right(v_iban, 4));
end $$;

-- ── Mandat widerrufen (wie sepaMandatWiderrufen der App) ──
create or replace function public.school_sepa_mandat_widerrufen(p_student_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid; v_owner uuid; v_data jsonb;
begin
  select o_school, o_owner, o_data into v_school, v_owner, v_data from _schul_schueler(p_student_id);
  if jsonb_typeof(v_data->'sepaMandat') is distinct from 'object' then raise exception 'Es gibt kein Mandat zum Widerrufen'; end if;
  update students set data = jsonb_set(data, '{sepaAnfrage}', 'null'::jsonb)
           || jsonb_build_object('sepaMandat', (data->'sepaMandat') || jsonb_build_object('aktiv', false,
                'widerrufenAm', to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM-DD'),
                'stand', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
         updated_at = now()
   where id = p_student_id;
  perform _akte_protokoll(v_school, p_student_id, v_owner, _schueler_name(v_data) || ' · Lastschrift-Mandat widerrufen');
end $$;

-- ── Mandat per Schüler-App anfordern (wie sepaMandatAnfordern der App) ──
create or replace function public.school_sepa_anfordern(p_student_id uuid, p_neuer_pin boolean default false) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_school uuid; v_owner uuid; v_data jsonb; v_iv jsonb; v_ci text; v_name text; v_z record; v_heute date := (now() at time zone 'Europe/Berlin')::date;
begin
  select o_school, o_owner, o_data into v_school, v_owner, v_data from _schul_schueler(p_student_id);
  select coalesce(invoice_settings, '{}'::jsonb), name into v_iv, v_name from schools where id = v_school;
  v_ci := upper(regexp_replace(coalesce(v_iv->>'glaeubigerId', ''), '[^A-Za-z0-9]', '', 'g'));
  if v_ci = '' or not _iban_gueltig(upper(regexp_replace(coalesce(v_iv->>'iban', ''), '[^A-Za-z0-9]', '', 'g'))) then
    raise exception 'Bitte zuerst Gläubiger-ID und IBAN unter Einstellungen › Rechnungsdaten eintragen';
  end if;
  update students set data = data || jsonb_build_object('sepaAnfrage', jsonb_build_object(
           'am', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'referenz', 'AD-' || left(upper(regexp_replace(p_student_id::text, '[^A-Za-z0-9]', '', 'g')), 12) || '-' || to_char(v_heute, 'YYYYMMDD'),
           'glaeubiger', btrim(coalesce(nullif(v_iv->>'kontoinhaber', ''), nullif(v_iv->>'firma', ''), v_name, 'Fahrschule')), 'ci', v_ci)),
         updated_at = now()
   where id = p_student_id;
  select * into v_z from _schueler_app_zugang(p_student_id, p_neuer_pin);
  perform _akte_protokoll(v_school, p_student_id, v_owner, _schueler_name(v_data) || ' · Lastschrift-Mandat in der Schüler-App angefordert'
    || case when v_z.o_pin is not null then ', Zugang zur Schüler-App' else '' end);
  return jsonb_build_object('code', v_z.o_code, 'pin', v_z.o_pin, 'tel', coalesce(v_data->>'tel', ''), 'email', coalesce(v_data->>'email', ''),
    'vorname', coalesce(v_data->>'vorname', ''), 'name', coalesce(v_data->>'name', ''));
end $$;

-- ── Einzug verbuchen (wie sepaEinzugGebucht der App) ──
create or replace function public.school_lastschrift_buchen(p_posten jsonb, p_faellig date, p_msg_id text) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare v_p jsonb; v_sid uuid; v_inv text; v_betrag numeric; v_school uuid; v_owner uuid; v_data jsonb; v_r jsonb; v_m jsonb; v_bezahlt numeric; n int := 0;
  v_heute date := (now() at time zone 'Europe/Berlin')::date; v_stand text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if _ist_demo() then raise exception 'Im Demo-Modus wird nichts gespeichert.'; end if;
  if jsonb_typeof(p_posten) is distinct from 'array' or jsonb_array_length(p_posten) = 0 or jsonb_array_length(p_posten) > 500 then raise exception 'Keine Lastschriften ausgewählt'; end if;
  if coalesce(p_msg_id, '') !~ '^AD[0-9]{8,20}$' then raise exception 'Ungültige Datei-Kennung'; end if;
  if p_faellig is null or p_faellig < v_heute or p_faellig > v_heute + 60 then raise exception 'Ungültiger Fälligkeitstag'; end if;
  for v_p in select value from jsonb_array_elements(p_posten) loop
    begin v_sid := (v_p->>'student_id')::uuid; exception when others then raise exception 'Ungültiger Schüler'; end;
    v_inv := v_p->>'invoice_id';
    v_betrag := round(coalesce((v_p->>'betrag')::numeric, 0), 2);
    select o_school, o_owner, o_data into v_school, v_owner, v_data from _schul_schueler(v_sid);
    v_m := v_data->'sepaMandat';
    if jsonb_typeof(v_m) is distinct from 'object' or coalesce(v_m->>'aktiv', 'false') <> 'true' or coalesce(v_m->>'widerrufenAm', '') <> '' or coalesce(v_m->>'referenz', '') = '' then
      raise exception 'Für % gibt es kein gültiges Lastschrift-Mandat', _schueler_name(v_data);
    end if;
    select e into v_r from jsonb_array_elements(_json_liste(v_data->'invoices')) e where e->>'id' = v_inv limit 1;
    if v_r is null or coalesce(v_r->>'cancelledBy', '') <> '' or coalesce(v_r->>'stornoOf', '') <> '' then
      raise exception 'Eine Rechnung von % gibt es nicht mehr oder sie ist storniert', _schueler_name(v_data);
    end if;
    -- Dieselbe Datei zum zweiten Mal (doppelter Klick, neuer Versuch): nichts doppelt buchen
    if exists (select 1 from jsonb_array_elements(_json_liste(v_data->'payments')) z where z->>'invoiceId' = v_inv and z->>'lastschrift' = p_msg_id) then continue; end if;
    select coalesce(sum(case when (z->>'amount') ~ '^-?\d+(\.\d+)?$' then (z->>'amount')::numeric else 0 end), 0) into v_bezahlt
      from jsonb_array_elements(_json_liste(v_data->'payments')) z where z->>'invoiceId' = v_inv;
    if v_betrag <= 0 or v_betrag > round(coalesce((v_r->>'total')::numeric, 0) - v_bezahlt, 2) + 0.005 then
      raise exception 'Der Betrag für Rechnung % passt nicht mehr – bitte die Liste neu laden', coalesce(v_r->>'number', '');
    end if;
    update students set data = jsonb_set(jsonb_set(_schul_aenderung(data, 'payments'), '{payments}',
             _json_liste(data->'payments') || jsonb_build_object('id', 'pay_' || _zufall_text('abcdefghijklmnopqrstuvwxyz0123456789', 7), 'date', p_faellig::text,
               'amount', v_betrag, 'method', 'Lastschrift', 'invoiceId', v_inv, 'lastschrift', p_msg_id, 'erfasstVon', 'buero')),
             '{sepaMandat}', (data->'sepaMandat') || jsonb_build_object('letzterEinzug', p_faellig::text, 'stand', v_stand)),
           updated_at = now()
     where id = v_sid;
    perform _akte_protokoll(v_school, v_sid, v_owner, _schueler_name(v_data) || ' · Lastschrift ' || replace(to_char(v_betrag, 'FM999990.00'), '.', ',') || ' € für Rechnung '
      || coalesce(v_r->>'number', '') || ' zum ' || to_char(p_faellig, 'DD.MM.YYYY'));
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.school_sepa_mandat_setzen(uuid, text, text, text, date), public.school_sepa_mandat_widerrufen(uuid),
  public.school_sepa_anfordern(uuid, boolean), public.school_lastschrift_buchen(jsonb, date, text) from public, anon;
grant execute on function public.school_sepa_mandat_setzen(uuid, text, text, text, date), public.school_sepa_mandat_widerrufen(uuid),
  public.school_sepa_anfordern(uuid, boolean), public.school_lastschrift_buchen(jsonb, date, text) to authenticated;
