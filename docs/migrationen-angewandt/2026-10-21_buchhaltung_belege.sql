-- Allindrive Autopilot · KI-Buchhaltung (21.10.2026): Belege-Vorschläge.
-- Die KI erkennt im Posteingang Rechnungen an die Fahrschule (Lieferant, Werkstatt, Miete, Software …),
-- holt den Anhang aus dem Postfach, legt ihn im Speicher „belege“ ab und liest Betrag, Datum, Umsatzsteuer
-- und Kategorie aus. Hochgeladene Belege (Foto/PDF) laufen denselben Weg. Gebucht wird nie automatisch:
-- Der Fahrschul-Admin übernimmt einen Vorschlag als Ausgabe (beleg_vorschlag_uebernehmen) oder verwirft ihn.
-- Ausgaben und Belege sieht nur der Fahrschul-Admin (wie die Tabelle ausgaben), nicht das Büro.

-- Posteingang: IMAP-UID und Zahl der Anhänge merken, damit der Beleg später gezielt geholt werden kann
alter table public.posteingang add column if not exists imap_uid bigint;
alter table public.posteingang add column if not exists anhaenge integer not null default 0;
-- (nachgezogen) UIDVALIDITY zum Zeitpunkt des Abholens: nur damit passt imap_uid später noch zur Mail
alter table public.posteingang add column if not exists imap_validity bigint;

create table if not exists public.beleg_vorschlaege (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  posteingang_id uuid references public.posteingang(id) on delete set null,
  quelle text not null default 'email',
  status text not null default 'holen',
  versuche integer not null default 0,
  grund text not null default '',
  beleg_pfad text,
  beleg_typ text not null default '',
  beleg_name text not null default '',
  lieferant text not null default '',
  rechnungsnummer text not null default '',
  datum date,
  faellig_am date,
  betrag numeric(10, 2),
  ust_satz numeric,
  kategorie text not null default '',
  beschreibung text not null default '',
  zahlart text not null default '',
  hinweis text not null default '',
  ausgabe_id uuid references public.ausgaben(id) on delete set null,
  erstellt_von uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beleg_vorschlag_quelle check (quelle in ('email', 'upload')),
  constraint beleg_vorschlag_status check (status in ('holen', 'lesen', 'bereit', 'uebernommen', 'verworfen', 'fehler')),
  constraint beleg_vorschlag_pfad check (beleg_pfad is null or length(beleg_pfad) <= 200),
  constraint beleg_vorschlag_betrag check (betrag is null or (betrag > 0 and betrag < 1000000)),
  constraint beleg_vorschlag_ust check (ust_satz is null or ust_satz in (0, 7, 19))
);
comment on table public.beleg_vorschlaege is 'Allindrive Autopilot: von der KI ausgelesene Belege (aus E-Mail-Anhängen oder hochgeladen), bis der Fahrschul-Admin sie als Ausgabe übernimmt oder verwirft. 12 Monate nach der letzten Änderung gelöscht (außer übernommen).';
create unique index if not exists beleg_vorschlag_je_mail on public.beleg_vorschlaege (posteingang_id) where posteingang_id is not null;
create index if not exists beleg_vorschlag_schule on public.beleg_vorschlaege (school_id, status, created_at desc);
create index if not exists beleg_vorschlag_offen on public.beleg_vorschlaege (status, created_at) where status in ('holen', 'lesen');

alter table public.beleg_vorschlaege enable row level security;
revoke all on public.beleg_vorschlaege from anon;
revoke insert, update, delete on public.beleg_vorschlaege from authenticated;
drop policy if exists beleg_vorschlag_lesen on public.beleg_vorschlaege;
create policy beleg_vorschlag_lesen on public.beleg_vorschlaege for select to authenticated using (public._ist_schul_admin(school_id));

-- Hochgeladenen Beleg (bereits im Speicher „belege“ unter <school_id>/…) zum Auslesen anmelden
create or replace function public.beleg_vorschlag_anlegen(p_school uuid, p_pfad text, p_typ text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if public._ist_demo() then raise exception 'Im Demo-Modus nicht gespeichert.'; end if;
  if not public._ist_schul_admin(p_school) then raise exception 'Nur der Fahrschul-Admin darf Belege erfassen.'; end if;
  if p_pfad is null or split_part(p_pfad, '/', 1) <> p_school::text or array_length(string_to_array(p_pfad, '/'), 1) <> 2 or length(p_pfad) > 200 then
    raise exception 'Ungültiger Ablageort';
  end if;
  if coalesce(p_typ, '') not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then raise exception 'Bitte ein PDF oder Foto (JPEG, PNG, WebP).'; end if;
  if (select count(*) from beleg_vorschlaege where school_id = p_school and quelle = 'upload' and created_at > now() - interval '1 day') >= 200 then
    raise exception 'Heute wurden schon sehr viele Belege hochgeladen. Bitte morgen weiter.';
  end if;
  insert into beleg_vorschlaege (school_id, quelle, status, beleg_pfad, beleg_typ, beleg_name, erstellt_von)
  values (p_school, 'upload', 'lesen', p_pfad, p_typ, left(coalesce(p_name, ''), 120), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.beleg_vorschlag_anlegen(uuid, text, text, text) from public, anon;
grant execute on function public.beleg_vorschlag_anlegen(uuid, text, text, text) to authenticated;

-- Vorschlag als Ausgabe übernehmen (Werte kommen geprüft vom Admin, der Beleg bleibt derselbe)
create or replace function public.beleg_vorschlag_uebernehmen(p_id uuid, p_felder jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v beleg_vorschlaege%rowtype; v_aus uuid; v_datum date; v_betrag numeric; v_ust numeric; v_kat text; v_text text; v_zahlart text;
begin
  if public._ist_demo() then raise exception 'Im Demo-Modus nicht gespeichert.'; end if;
  select * into v from beleg_vorschlaege where id = p_id for update;
  if v.id is null or not public._ist_schul_admin(v.school_id) then raise exception 'Kein Zugriff'; end if;
  if v.status not in ('bereit', 'fehler') then raise exception 'Dieser Beleg ist schon erledigt oder wird gerade gelesen.'; end if;
  begin
    v_datum := (p_felder->>'datum')::date;
    v_betrag := round((p_felder->>'betrag')::numeric, 2);
  exception when others then raise exception 'Bitte Datum und Betrag prüfen.';
  end;
  if v_datum is null or v_datum < date '2000-01-01' or v_datum > current_date + 400 then raise exception 'Bitte ein gültiges Datum angeben.'; end if;
  if v_betrag is null or v_betrag <= 0 or v_betrag >= 1000000 then raise exception 'Bitte einen gültigen Betrag angeben.'; end if;
  v_ust := nullif(p_felder->>'ust_satz', '')::numeric;
  if v_ust is not null and v_ust not in (0, 7, 19) then raise exception 'Umsatzsteuer nur 0, 7 oder 19 %%.'; end if;
  v_kat := btrim(coalesce(p_felder->>'kategorie', ''));
  if length(v_kat) < 1 or length(v_kat) > 60 then raise exception 'Bitte eine Kategorie wählen.'; end if;
  v_text := nullif(left(btrim(coalesce(p_felder->>'beschreibung', '')), 200), '');
  v_zahlart := nullif(left(btrim(coalesce(p_felder->>'zahlart', '')), 30), '');
  insert into ausgaben (school_id, erfasst_von, datum, betrag, kategorie, beschreibung, ust_satz, zahlart, beleg_pfad, updated_at)
  values (v.school_id, auth.uid(), v_datum, v_betrag, v_kat, v_text, v_ust, v_zahlart, v.beleg_pfad, now())
  returning id into v_aus;
  update beleg_vorschlaege set status = 'uebernommen', ausgabe_id = v_aus, updated_at = now() where id = p_id;
  return v_aus;
end $$;
revoke all on function public.beleg_vorschlag_uebernehmen(uuid, jsonb) from public, anon;
grant execute on function public.beleg_vorschlag_uebernehmen(uuid, jsonb) to authenticated;

-- Vorschlag verwerfen; liefert den Ablageort zurück, damit die App die Datei löschen kann
create or replace function public.beleg_vorschlag_verwerfen(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v beleg_vorschlaege%rowtype;
begin
  if public._ist_demo() then raise exception 'Im Demo-Modus nicht gespeichert.'; end if;
  select * into v from beleg_vorschlaege where id = p_id for update;
  if v.id is null or not public._ist_schul_admin(v.school_id) then raise exception 'Kein Zugriff'; end if;
  if v.status = 'uebernommen' then raise exception 'Schon als Ausgabe übernommen – dort löschen.'; end if;
  update beleg_vorschlaege set status = 'verworfen', beleg_pfad = null, updated_at = now() where id = p_id;
  return v.beleg_pfad;
end $$;
revoke all on function public.beleg_vorschlag_verwerfen(uuid) from public, anon;
grant execute on function public.beleg_vorschlag_verwerfen(uuid) to authenticated;

-- Nächsten Vorschlag für den Zeitjob reservieren (nur Server; überspringt gesperrte Zeilen)
create or replace function public.beleg_vorschlag_naechster() returns setof public.beleg_vorschlaege
language sql security definer set search_path = public as $$
  update beleg_vorschlaege set versuche = versuche + 1, updated_at = now()
   where id = (select id from beleg_vorschlaege where status in ('holen', 'lesen') and versuche < 3
               order by created_at limit 1 for update skip locked)
  returning *;
$$;
revoke all on function public.beleg_vorschlag_naechster() from public, anon, authenticated;
grant execute on function public.beleg_vorschlag_naechster() to service_role;

-- Zeitjob: jede Minute, nur wenn etwas wartet (gleiches Geheimnis wie die anderen Jobs)
select cron.schedule('buchhaltung-ki', '* * * * *', $job$
  select net.http_post(
    url := 'https://allindrive.netlify.app/.netlify/functions/buchhaltung-ki',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')),
    body := '{}'::jsonb)
  where exists (select 1 from public.beleg_vorschlaege where status in ('holen', 'lesen') and versuche < 3);
$job$);
-- Aufräumen: Hängengebliebenes nach drei Versuchen als Fehler zeigen; Verworfenes/Fehler nach 12 Monaten weg
select cron.schedule('buchhaltung-aufraeumen', '50 3 * * *', $job$
  update public.beleg_vorschlaege set status = 'fehler', grund = 'Die KI konnte diesen Beleg nicht lesen. Bitte die Werte selbst eintragen.', updated_at = now()
   where status in ('holen', 'lesen') and versuche >= 3;
  delete from public.beleg_vorschlaege where status in ('verworfen', 'fehler') and updated_at < now() - interval '12 months';
$job$);
