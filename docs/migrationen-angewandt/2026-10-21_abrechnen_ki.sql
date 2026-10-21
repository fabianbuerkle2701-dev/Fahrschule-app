-- Fabian 21.10.2026: Vollautonom „Jeden Monat selbst abrechnen“ (Schalter abrechnen). Der Zeitjob
-- vollautonom-abrechnen (Netlify, Service-Schlüssel) schreibt Anfang des Monats die Rechnungen über die Leistungen
-- des Vormonats – über create_invoice wie der Autopilot (Schul-Weg) – und schickt sie als PDF per E-Mail.
-- Paket, Schalter und KI prüft die Function.

-- 1) create_invoice und next_document_number: zusätzlich der Service-Schlüssel (sonst unverändert).
--    Gezielt ersetzt statt neu geschrieben, damit an den langen Funktionen sonst nichts anders wird.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.create_invoice(uuid,uuid,jsonb,text[],integer[],text,text[],jsonb,date,boolean)'::regprocedure);
  if position('or not _darf_schulweit(p_school_id) then' in d) = 0 then raise exception 'create_invoice: Stelle nicht gefunden'; end if;
  d := replace(d, 'or not _darf_schulweit(p_school_id) then', 'or not (_darf_schulweit(p_school_id) or coalesce(auth.role(), '''') = ''service_role'') then');
  execute d;
  d := pg_get_functiondef('public.next_document_number(uuid,text)'::regprocedure);
  if position('if not exists (' in d) = 0 then raise exception 'next_document_number: Stelle nicht gefunden'; end if;
  d := replace(d, 'if not exists (', 'if coalesce(auth.role(), '''') <> ''service_role'' and not exists (');
  execute d;
end $$;

-- 2) Rechnungen per E-Mail landen im Ausgang wie Erinnerungen (Schutz vor Doppelversand, Protokoll)
alter table public.nachrichten_ausgang drop constraint if exists nachrichten_ausgang_art;
alter table public.nachrichten_ausgang add constraint nachrichten_ausgang_art check (art = any (array['erinnerung', 'nachfassen', 'rechnung']));

-- 3) Zeitjob: stündlich (die Function rechnet nur in der ersten Woche des Monats werktags 9–15 Uhr ab),
--    nur wenn eine Fahrschule den Schalter hat
select cron.schedule('vollautonom-abrechnen', '37 * * * *', $cron$
  select net.http_post(
    url := 'https://allindrive.netlify.app/.netlify/functions/vollautonom-abrechnen',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')),
    body := '{}'::jsonb)
  where exists (select 1 from public.schools where autopilot_paket = 'vollautonom' and ki_autonomie->>'abrechnen' = 'true');
$cron$);

notify pgrst, 'reload schema';
