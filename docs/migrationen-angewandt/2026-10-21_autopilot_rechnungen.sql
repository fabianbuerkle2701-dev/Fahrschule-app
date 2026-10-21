-- Allindrive Autopilot · Rechnungen & Mahnungen (21.10.2026)
-- Für Fahrschul-Admin und Büro (_darf_schulweit), rein additiv – an bestehenden Funktionen ändert sich nichts.
--
-- 1) school_rechnungen(p_school_id): alle Schüler der Fahrschule, die Rechnungen haben, mit Rechnungen,
--    Zahlungen, bisherigen Zahlungserinnerungen und dem Kontakt für eine Erinnerung (Handy, Eltern-Telefon,
--    Firmenkunde). Keine Ausbildungsdaten, keine Notizen. Archivierte Schüler sind dabei: eine offene
--    Rechnung bleibt offen, auch wenn die Ausbildung beendet ist.
-- 2) school_erinnerung_vermerken(...): eine Zahlungserinnerung zu einer Rechnung im Erinnerungs-Protokoll
--    des Schülers vermerken (data.reminders – dasselbe Protokoll wie die Kasse der App, die Staffel zählt
--    dort mit). Geschrieben wird nur das Protokoll; verschickt wird von Hand (WhatsApp, E-Mail, Telefon).
--    Markiert über _schul_aenderung, damit ein veralteter Gerätestand des Fahrlehrers den Eintrag nicht
--    überschreibt. Höchstens eine Erinnerung je Rechnung und Tag (Doppelklick-Schutz).

create or replace function public.school_rechnungen(p_school_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_school_id is null or not _darf_schulweit(p_school_id) then
    raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'student_id', s.id,
             'vorname', coalesce(s.data->>'vorname', ''),
             'name', coalesce(s.data->>'name', ''),
             'tel', coalesce(s.data->>'tel', ''),
             'eltern_tel', coalesce(s.data->>'elternTel', ''),
             'firma', case when s.data->'istFirmenkunde' = 'true'::jsonb
                           then jsonb_build_object('name', coalesce(s.data->>'firmaName', ''), 'email', coalesce(s.data->>'firmaEmail', ''))
                           else null end,
             'archiviert', coalesce(s.data->'archived' = 'true'::jsonb, false),
             'lehrer', coalesce(nullif(p.display_name, ''), split_part(p.email, '@', 1)),
             'invoices', s.data->'invoices',
             'payments', case when jsonb_typeof(s.data->'payments') = 'array' then s.data->'payments' else '[]'::jsonb end,
             'reminders', case when jsonb_typeof(s.data->'reminders') = 'array' then s.data->'reminders' else '[]'::jsonb end
           ) order by lower(coalesce(s.data->>'name', '')), lower(coalesce(s.data->>'vorname', '')))
      from students s
      join profiles p on p.id = s.owner
     where p.school_id = p_school_id
       and jsonb_typeof(s.data->'invoices') = 'array'
       and jsonb_array_length(s.data->'invoices') > 0
  ), '[]'::jsonb);
end $$;
comment on function public.school_rechnungen(uuid) is 'Allindrive Autopilot: Rechnungen, Zahlungen und Zahlungserinnerungen aller Schüler der Fahrschule (Admin/Büro), ohne Ausbildungsdaten.';
revoke all on function public.school_rechnungen(uuid) from public, anon;
grant execute on function public.school_rechnungen(uuid) to authenticated;

create or replace function public.school_erinnerung_vermerken(p_student_id uuid, p_invoice_id text, p_stufe integer, p_kanal text, p_betrag numeric)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_school uuid; v_data jsonb; v_inv jsonb; v_gezahlt numeric; v_heute text; v_eintrag jsonb;
begin
  if _ist_demo() then raise exception 'Im Demo-Modus wird nichts gespeichert.'; end if;
  select p.school_id, s.data into v_school, v_data
    from students s join profiles p on p.id = s.owner
   where s.id = p_student_id
     for update of s;
  if v_school is null or not _darf_schulweit(v_school) then
    raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro';
  end if;
  if p_stufe is null or p_stufe < 1 or p_stufe > 3 then raise exception 'Ungültige Stufe'; end if;
  if p_kanal is null or p_kanal not in ('whatsapp', 'email', 'telefon', 'brief', 'kopiert') then raise exception 'Unbekannter Weg'; end if;
  if p_betrag is null or p_betrag <= 0 or p_betrag > 100000 then raise exception 'Ungültiger Betrag'; end if;

  select e into v_inv
    from jsonb_array_elements(case when jsonb_typeof(v_data->'invoices') = 'array' then v_data->'invoices' else '[]'::jsonb end) e
   where e->>'id' = p_invoice_id
   limit 1;
  if v_inv is null then raise exception 'Rechnung nicht gefunden'; end if;
  if v_inv ? 'cancelledBy' or v_inv ? 'stornoOf' then raise exception 'Die Rechnung ist storniert'; end if;

  v_heute := (now() at time zone 'Europe/Berlin')::date::text;
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_data->'reminders') = 'array' then v_data->'reminders' else '[]'::jsonb end) r
              where r->>'invoiceId' = p_invoice_id and r->>'date' = v_heute) then
    raise exception 'Zu dieser Rechnung ist heute schon eine Erinnerung vermerkt';
  end if;

  -- Bis dahin gezahlte Summe (wie sumPayments in der App): damit erkennt die Staffel später, ob seitdem Geld kam
  select coalesce(sum((e->>'amount')::numeric), 0) into v_gezahlt
    from jsonb_array_elements(case when jsonb_typeof(v_data->'payments') = 'array' then v_data->'payments' else '[]'::jsonb end) e
   where jsonb_typeof(e->'amount') = 'number';

  v_eintrag := jsonb_build_object('date', v_heute, 'stage', p_stufe, 'amount', round(p_betrag, 2), 'gezahltBis', round(v_gezahlt, 2),
                                  'invoiceId', p_invoice_id, 'kanal', p_kanal, 'erfasstVon', 'buero');
  update students
     set data = jsonb_set(_schul_aenderung(data, 'reminders'), '{reminders}',
                          coalesce(case when jsonb_typeof(data->'reminders') = 'array' then data->'reminders' end, '[]'::jsonb) || v_eintrag),
         updated_at = now()
   where id = p_student_id;
  return v_eintrag;
end $$;
comment on function public.school_erinnerung_vermerken(uuid, text, integer, text, numeric) is 'Allindrive Autopilot: Zahlungserinnerung zu einer Rechnung im Erinnerungs-Protokoll des Schülers vermerken (Admin/Büro). Verschickt nichts.';
revoke all on function public.school_erinnerung_vermerken(uuid, text, integer, text, numeric) from public, anon;
grant execute on function public.school_erinnerung_vermerken(uuid, text, integer, text, numeric) to authenticated;

-- Proben (21.10.2026, in einer verworfenen Transaktion, Ergebnis per raise exception, danach 0 Reste):
-- Admin liest die eigene Schule (Felder invoices/payments/reminders, keine lessons) · normaler Fahrschul-Admin:
-- fremde Schule und fremder Schüler gesperrt (der zentrale Allindrive-Admin sieht wie überall alle Schulen) ·
-- Vermerk Stufe 1 per WhatsApp → reminders 0→1 mit Markierung schulAenderungen.reminders · zweiter Vermerk am
-- selben Tag, Stufe 4, Weg „fax“, unbekannte Rechnung, Betrag 0 gesperrt · reiner Fahrlehrer liest/schreibt
-- nicht · Demo-Konto schreibt nicht · anon darf nicht ausführen.
