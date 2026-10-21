-- Allindrive Autopilot · Nachrichten-Ausgang (21.10.2026): Protokoll der E-Mails, die Fahrschul-Admin oder
-- Büro im Autopilot von Hand über das verbundene Postfach der Fahrschule schicken
-- (netlify/functions/nachricht-senden.js): Zahlungserinnerungen und Nachfassen bei Interessenten.
-- Gespeichert werden nur Empfänger und Betreff, nie der Text der Mail.
--
-- Schutz vor Doppelversand: Vor dem Senden legt die Function eine Zeile „reserviert“ an – eindeutig je
-- Fahrschule und Schlüssel (die App erzeugt ihn einmal je Nachricht). Derselbe Schlüssel sendet nur einmal.
-- Nach dem Versand steht die Zeile auf „gesendet“, nach einem Sendefehler auf „fehler“ (dann darf derselbe
-- Schlüssel es noch einmal versuchen; created_at ist danach der Zeitpunkt dieses Versuchs). Die Function
-- zählt hier auch ihre Grenzen: 100 gesendete Mails je Fahrschule und Tag, 10 Sendeversuche je Person und Minute.
--
-- Sicherheit: Lesen dürfen Fahrschul-Admin und Büro der eigenen Fahrschule (_darf_schulweit). Schreiben nur
-- der Server (service_role) – authenticated hat kein insert/update/delete, anon gar keinen Zugriff.
-- Rein additiv.
--
-- Aufbewahrung: 12 Monate wie der Posteingang (Job nachrichten-ausgang-aufraeumen). Die Erinnerung selbst bleibt
-- im Erinnerungs-Protokoll des Schülers.
-- Dazu: school_rechnungen liefert die E-Mail des Schülers (data.email), damit der Autopilot „Per E-Mail senden“
-- auch ohne Firmenkunde anbietet (gezielte Ersetzung per DO-Block mit Anker).
-- Eingespielt am 21.10.2026 nach Prüfung.

create table if not exists public.nachrichten_ausgang (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  art text not null,
  schluessel uuid not null,
  bezug text,
  an text,
  betreff text,
  gesendet_von uuid references auth.users(id) on delete set null,
  status text not null default 'reserviert',
  fehler text,
  created_at timestamptz not null default now(),
  constraint nachrichten_ausgang_art check (art in ('erinnerung', 'nachfassen')),
  constraint nachrichten_ausgang_status check (status in ('reserviert', 'gesendet', 'fehler')),
  constraint nachrichten_ausgang_schluessel unique (school_id, schluessel)
);
comment on table public.nachrichten_ausgang is 'Allindrive Autopilot: von Hand gesendete E-Mails (Zahlungserinnerung, Nachfassen) mit Empfänger und Betreff, ohne Text. Schutz vor Doppelversand je Schlüssel. Schreibt nur der Server.';
comment on column public.nachrichten_ausgang.bezug is 'erinnerung: <student_id>:<invoice_id> · nachfassen: <interessent_id>';
create index if not exists nachrichten_ausgang_schule on public.nachrichten_ausgang (school_id, created_at);

alter table public.nachrichten_ausgang enable row level security;
revoke all on public.nachrichten_ausgang from anon, authenticated;
grant select on public.nachrichten_ausgang to authenticated;
drop policy if exists nachrichten_ausgang_lesen on public.nachrichten_ausgang;
create policy nachrichten_ausgang_lesen on public.nachrichten_ausgang for select to authenticated using (public._darf_schulweit(school_id));

select cron.schedule('nachrichten-ausgang-aufraeumen', '50 3 * * *', $job$
  delete from public.nachrichten_ausgang where created_at < now() - interval '12 months';
$job$);

do $mig$
declare alt text; neu text;
begin
  alt := pg_get_functiondef('public.school_rechnungen(uuid)'::regprocedure);
  if position('''email'', coalesce(s.data->>''email''' in alt) > 0 then return; end if;
  neu := replace(alt, '''anschrift'', coalesce(s.data->>''anschrift'', ''''),', '''anschrift'', coalesce(s.data->>''anschrift'', ''''),' || chr(10) || '             ''email'', coalesce(s.data->>''email'', ''''),');
  if neu = alt then raise exception 'Anker fehlt (school_rechnungen)'; end if;
  execute neu;
end $mig$;

-- Proben nach dem Einspielen (21.10.2026, verworfene Transaktion, 0 Reste): Admin sieht nur Zeilen der eigenen
-- Fahrschule und darf nicht schreiben · anon gesperrt · school_rechnungen liefert das Feld email · Aufräum-Job da.
