-- Fabian 21.10.2026: Vollautonom „An offene Rechnungen erinnern“ (Schalter erinnerungen). Der Zeitjob
-- vollautonom-erinnerungen (Netlify, Service-Schlüssel) schickt fällige Zahlungserinnerungen über das Postfach der
-- Fahrschule und vermerkt sie hier – als „email“, erfasst von „ki“. Paket, Schalter und KI prüft die Function.

-- 1) Vermerk durch den Zeitjob: wie school_erinnerung_vermerken, aber nur mit dem Service-Schlüssel und erfasstVon "ki"
create or replace function public.school_erinnerung_ki_vermerken(p_student_id uuid, p_invoice_id text, p_stufe integer, p_betrag numeric)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_data jsonb; v_inv jsonb; v_gezahlt numeric; v_heute text; v_eintrag jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Kein Zugriff'; end if;
  select s.data into v_data from students s where s.id = p_student_id for update of s;
  if v_data is null then raise exception 'Schüler nicht gefunden'; end if;
  if p_stufe is null or p_stufe < 1 or p_stufe > 3 then raise exception 'Ungültige Stufe'; end if;
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
  select coalesce(sum((e->>'amount')::numeric), 0) into v_gezahlt
    from jsonb_array_elements(case when jsonb_typeof(v_data->'payments') = 'array' then v_data->'payments' else '[]'::jsonb end) e
   where jsonb_typeof(e->'amount') = 'number';
  v_eintrag := jsonb_build_object('date', v_heute, 'stage', p_stufe, 'amount', round(p_betrag, 2), 'gezahltBis', round(v_gezahlt, 2),
                                  'invoiceId', p_invoice_id, 'kanal', 'email', 'erfasstVon', 'ki');
  update students
     set data = jsonb_set(_schul_aenderung(data, 'reminders'), '{reminders}',
                          coalesce(case when jsonb_typeof(data->'reminders') = 'array' then data->'reminders' end, '[]'::jsonb) || v_eintrag),
         updated_at = now()
   where id = p_student_id;
  return v_eintrag;
end $function$;
revoke all on function public.school_erinnerung_ki_vermerken(uuid, text, integer, numeric) from public, anon, authenticated;
grant execute on function public.school_erinnerung_ki_vermerken(uuid, text, integer, numeric) to service_role;

-- 2) Rechnungen einer Fahrschule: zusätzlich für den Service-Schlüssel (Zeitjob), sonst unverändert
create or replace function public.school_rechnungen(p_school_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if p_school_id is null or not (coalesce(auth.role(), '') = 'service_role' or _darf_schulweit(p_school_id)) then
    raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'student_id', s.id,
             'vorname', coalesce(s.data->>'vorname', ''),
             'name', coalesce(s.data->>'name', ''),
             'tel', coalesce(s.data->>'tel', ''),
             'eltern_tel', coalesce(s.data->>'elternTel', ''),
             'anschrift', coalesce(s.data->>'anschrift', ''),
             'email', coalesce(s.data->>'email', ''),
             'firma', case when s.data->'istFirmenkunde' = 'true'::jsonb
                           then jsonb_build_object('name', coalesce(s.data->>'firmaName', ''), 'email', coalesce(s.data->>'firmaEmail', ''),
                                                   'strasse', coalesce(s.data->>'firmaStrasse', ''), 'plz_ort', coalesce(s.data->>'firmaPlzOrt', ''),
                                                   'ust_id', coalesce(s.data->>'firmaUstId', ''))
                           else null end,
             'archiviert', coalesce(s.data->'archived' = 'true'::jsonb, false),
             'lehrer', coalesce(nullif(p.display_name, ''), split_part(p.email, '@', 1)),
             'abrechnungs_modell', s.data->>'abrechnungsModell',
             'invoices', case when jsonb_typeof(s.data->'invoices') = 'array' then s.data->'invoices' else '[]'::jsonb end,
             'payments', case when jsonb_typeof(s.data->'payments') = 'array' then s.data->'payments' else '[]'::jsonb end,
             'reminders', case when jsonb_typeof(s.data->'reminders') = 'array' then s.data->'reminders' else '[]'::jsonb end,
             'lessons', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                           'id', e->'id', 'date', e->'date', 'minutes', e->'minutes', 'price', e->'price', 'invoiced', e->'invoiced',
                           'invoicedCoveredUE', e->'invoicedCoveredUE', 'invoicedPrice', e->'invoicedPrice', 'nichtBerechnen', e->'nichtBerechnen')))
                         from jsonb_array_elements(case when jsonb_typeof(s.data->'drivenLessons') = 'array' then s.data->'drivenLessons' else '[]'::jsonb end) e), '[]'::jsonb),
             'cost_items', case when jsonb_typeof(s.data->'costItems') = 'array' then s.data->'costItems' else '[]'::jsonb end,
             'packages', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('includedUE', pk->'includedUE', 'date', pk->'date', 'label', pk->'label')))
                         from jsonb_array_elements(case when jsonb_typeof(s.data->'packages') = 'array' then s.data->'packages' else '[]'::jsonb end) pk), '[]'::jsonb)
           ) order by lower(coalesce(s.data->>'name', '')), lower(coalesce(s.data->>'vorname', '')))
      from students s
      join profiles p on p.id = s.owner
     where p.school_id = p_school_id
       and ((jsonb_typeof(s.data->'invoices') = 'array' and jsonb_array_length(s.data->'invoices') > 0)
            or (coalesce(s.data->'archived' = 'true'::jsonb, false) = false and coalesce(s.data->>'dataDeletedAt', '') = ''
                and coalesce(s.data->>'pending', 'false') <> 'true'))
  ), '[]'::jsonb);
end $function$;

-- 3) Zeitjob: stündlich (die Function sendet nur werktags 9–17 Uhr Berliner Zeit), nur wenn eine Fahrschule den Schalter hat
select cron.schedule('vollautonom-erinnerungen', '7 * * * *', $cron$
  select net.http_post(
    url := 'https://allindrive.netlify.app/.netlify/functions/vollautonom-erinnerungen',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')),
    body := '{}'::jsonb)
  where exists (select 1 from public.schools where autopilot_paket = 'vollautonom' and ki_autonomie->>'erinnerungen' = 'true');
$cron$);

notify pgrst, 'reload schema';
