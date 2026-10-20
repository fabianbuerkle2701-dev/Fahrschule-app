-- KI-Verwaltung · Posteingang (v2.126.0): E-Mails der Fahrschule an einer Stelle.
-- Die Fahrschule verbindet ihr bestehendes Postfach (IMAP/SMTP), ein pg_cron-Job holt alle 5 Minuten
-- neue Mails (netlify/functions/posteingang-abruf.js), ein zweiter Job lässt sie einzeln von der KI
-- einordnen und beantworten (posteingang-ki.js). Autopilot mit Regeln: allgemeine Interessenten-
-- Anfragen, die der Steckbrief vollständig beantwortet, schickt die KI selbst (mit KI-Hinweis),
-- alles andere liegt als Entwurf beim Fahrschul-Admin bzw. Büro.
--
-- Sicherheit: Das Postfach-Passwort liegt verschlüsselt im Supabase-Tresor (vault.secrets); lesen
-- kann es nur der Server (service_role). Tabellen nur lesbar für Admin/Büro der eigenen Fahrschule,
-- geschrieben wird über Funktionen. Aufbewahrung der Kopien: 12 Monate (das Original bleibt im Postfach).

alter table public.schools add column if not exists ki_steckbrief text;
comment on column public.schools.ki_steckbrief is 'Steckbrief für die KI im Posteingang (v2.126.0): Angebot, Preise, Anmeldung, Erreichbarkeit - nur daraus beantwortet die KI Anfragen selbst.';
alter table public.interessenten add column if not exists email text;

create table if not exists public.postfaecher (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null unique references public.schools(id) on delete cascade,
  email text not null,
  benutzer text not null,
  imap_host text not null,
  imap_port integer not null default 993,
  imap_tls boolean not null default true,
  smtp_host text not null,
  smtp_port integer not null default 465,
  smtp_tls boolean not null default true,
  absender_name text not null default '',
  geheimnis_id uuid,
  aktiv boolean not null default true,
  regeln jsonb not null default '{"autopilot": true, "interessenten_anlegen": true, "tageslimit": 20}'::jsonb,
  letzte_uid bigint not null default 0,
  uid_validity bigint,
  letzter_abruf timestamptz,
  letzter_fehler text not null default '',
  fehler_seit timestamptz,
  verbunden_von uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.postfaecher is 'Verbundenes E-Mail-Postfach je Fahrschule (v2.126.0). Passwort nur im Tresor (geheimnis_id), lesbar allein für den Server.';

create table if not exists public.posteingang (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  postfach_id uuid references public.postfaecher(id) on delete set null,
  quelle text not null default 'email',
  message_id text not null default '',
  antwort_auf text not null default '',
  referenzen text not null default '',
  von_name text not null default '',
  von_email text not null default '',
  betreff text not null default '',
  text text not null default '',
  empfangen_am timestamptz not null default now(),
  status text not null default 'neu',
  kategorie text not null default '',
  zusammenfassung text not null default '',
  grund text not null default '',
  entwurf_betreff text not null default '',
  entwurf_text text not null default '',
  antwort_text text not null default '',
  gesendet_am timestamptz,
  gesendet_von text not null default '',
  aktionen jsonb not null default '[]'::jsonb,
  versuche integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posteingang_status_ok check (status in ('neu','braucht_dich','zu_senden','beantwortet_ki','beantwortet','erledigt','spam','info','fehler')),
  constraint posteingang_aktionen_liste check (jsonb_typeof(aktionen) = 'array')
);
comment on table public.posteingang is 'E-Mails im Posteingang der KI-Verwaltung (v2.126.0): Kopie, Einordnung, Entwurf, gesendete Antwort. 12 Monate nach der letzten Änderung gelöscht.';
create unique index if not exists posteingang_eindeutig on public.posteingang (postfach_id, message_id) where message_id <> '';
create index if not exists posteingang_schule on public.posteingang (school_id, empfangen_am desc);
create index if not exists posteingang_offen on public.posteingang (status, empfangen_am) where status in ('neu','zu_senden');
create index if not exists posteingang_alter on public.posteingang (updated_at);

-- Wer den Posteingang einer Fahrschule sehen und bearbeiten darf: Fahrschul-Admin, Büro, App-Admin
create or replace function public._darf_posteingang(p_school uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid
      or exists (select 1 from profiles where id = auth.uid() and school_id = p_school
                 and (coalesce(school_admin, false) or coalesce(school_office, false)));
$$;
revoke all on function public._darf_posteingang(uuid) from public, anon;
grant execute on function public._darf_posteingang(uuid) to authenticated;

alter table public.postfaecher enable row level security;
alter table public.posteingang enable row level security;
revoke insert, update, delete on public.postfaecher, public.posteingang from anon, authenticated;
revoke all on public.postfaecher, public.posteingang from anon;
drop policy if exists postfach_lesen on public.postfaecher;
create policy postfach_lesen on public.postfaecher for select to authenticated using (public._darf_posteingang(school_id));
drop policy if exists posteingang_lesen on public.posteingang;
create policy posteingang_lesen on public.posteingang for select to authenticated using (public._darf_posteingang(school_id));

-- Postfach speichern (nur Server, nach erfolgreichem Verbindungstest). Passwort -> Tresor.
create or replace function public.postfach_speichern(p_school uuid, p_user uuid, p_cfg jsonb, p_passwort text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_alt uuid; v_geheimnis uuid; v_id uuid;
begin
  select geheimnis_id into v_alt from postfaecher where school_id = p_school;
  if coalesce(p_passwort, '') <> '' then
    if v_alt is not null then
      perform vault.update_secret(v_alt, p_passwort);
      v_geheimnis := v_alt;
    else
      v_geheimnis := vault.create_secret(p_passwort, 'postfach_' || p_school::text || '_' || substr(md5(random()::text), 1, 6), 'IMAP/SMTP-Passwort Posteingang');
    end if;
  else
    v_geheimnis := v_alt;
  end if;
  if v_geheimnis is null then raise exception 'Passwort fehlt'; end if;
  insert into postfaecher (school_id, email, benutzer, imap_host, imap_port, imap_tls, smtp_host, smtp_port, smtp_tls, absender_name,
                           geheimnis_id, aktiv, letzte_uid, uid_validity, letzter_abruf, letzter_fehler, fehler_seit, verbunden_von, updated_at)
  values (p_school, p_cfg->>'email', p_cfg->>'benutzer', p_cfg->>'imap_host', (p_cfg->>'imap_port')::int, (p_cfg->>'imap_tls')::boolean,
          p_cfg->>'smtp_host', (p_cfg->>'smtp_port')::int, (p_cfg->>'smtp_tls')::boolean, coalesce(p_cfg->>'absender_name', ''),
          v_geheimnis, true, coalesce((p_cfg->>'letzte_uid')::bigint, 0), (p_cfg->>'uid_validity')::bigint, now(), '', null, p_user, now())
  on conflict (school_id) do update set
    email = excluded.email, benutzer = excluded.benutzer, imap_host = excluded.imap_host, imap_port = excluded.imap_port, imap_tls = excluded.imap_tls,
    smtp_host = excluded.smtp_host, smtp_port = excluded.smtp_port, smtp_tls = excluded.smtp_tls, absender_name = excluded.absender_name,
    geheimnis_id = excluded.geheimnis_id, aktiv = true, letzte_uid = excluded.letzte_uid, uid_validity = excluded.uid_validity,
    letzter_abruf = now(), letzter_fehler = '', fehler_seit = null, verbunden_von = excluded.verbunden_von, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.postfach_speichern(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.postfach_speichern(uuid, uuid, jsonb, text) to service_role;

-- Passwort lesen (nur Server)
create or replace function public.postfach_passwort(p_postfach uuid) returns text
language sql stable security definer set search_path = public as $$
  select s.decrypted_secret from vault.decrypted_secrets s join public.postfaecher p on p.geheimnis_id = s.id where p.id = p_postfach;
$$;
revoke all on function public.postfach_passwort(uuid) from public, anon, authenticated;
grant execute on function public.postfach_passwort(uuid) to service_role;

-- Postfach trennen (Fahrschul-Admin): Passwort aus dem Tresor löschen, Verbindung entfernen.
-- Die bisherigen Einträge im Posteingang bleiben (ohne Postfach).
create or replace function public.postfach_entfernen(p_school uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_geheimnis uuid;
begin
  if not (auth.uid() = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid or public._ist_schul_admin(p_school)) then
    raise exception 'Nur der Fahrschul-Admin darf das Postfach trennen.';
  end if;
  select geheimnis_id into v_geheimnis from postfaecher where school_id = p_school;
  delete from postfaecher where school_id = p_school;
  if v_geheimnis is not null then delete from vault.secrets where id = v_geheimnis; end if;
end $$;
revoke all on function public.postfach_entfernen(uuid) from public, anon;
grant execute on function public.postfach_entfernen(uuid) to authenticated;

-- Regeln und Ein/Aus (Fahrschul-Admin)
create or replace function public.postfach_regeln_setzen(p_school uuid, p_regeln jsonb, p_aktiv boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (auth.uid() = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid or public._ist_schul_admin(p_school)) then
    raise exception 'Nur der Fahrschul-Admin darf die Regeln ändern.';
  end if;
  update postfaecher set
    regeln = jsonb_build_object(
      'autopilot', coalesce((p_regeln->>'autopilot')::boolean, true),
      'interessenten_anlegen', coalesce((p_regeln->>'interessenten_anlegen')::boolean, true),
      'tageslimit', greatest(0, least(100, coalesce((p_regeln->>'tageslimit')::int, 20)))),
    aktiv = coalesce(p_aktiv, aktiv), updated_at = now()
  where school_id = p_school;
end $$;
revoke all on function public.postfach_regeln_setzen(uuid, jsonb, boolean) from public, anon;
grant execute on function public.postfach_regeln_setzen(uuid, jsonb, boolean) to authenticated;

-- Status von Hand (Admin/Büro): erledigt, spam oder wieder vorlegen
create or replace function public.posteingang_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare v_school uuid;
begin
  if p_status not in ('erledigt', 'spam', 'braucht_dich') then raise exception 'Ungültiger Status'; end if;
  select school_id into v_school from posteingang where id = p_id;
  if v_school is null or not public._darf_posteingang(v_school) then raise exception 'Kein Zugriff'; end if;
  update posteingang set status = p_status, updated_at = now(),
         aktionen = aktionen || jsonb_build_array(jsonb_build_object('art', 'status', 'status', p_status, 'von', auth.uid(), 'zeit', now()))
   where id = p_id;
end $$;
revoke all on function public.posteingang_status(uuid, text) from public, anon;
grant execute on function public.posteingang_status(uuid, text) to authenticated;

-- Nächste Mail für die KI holen und dabei reservieren (nur Server; überspringt gesperrte Zeilen)
create or replace function public.posteingang_naechster() returns setof public.posteingang
language sql security definer set search_path = public as $$
  update posteingang set versuche = versuche + 1, updated_at = now()
   where id = (select id from posteingang where status in ('neu', 'zu_senden') and versuche < 3
               order by empfangen_am limit 1 for update skip locked)
  returning *;
$$;
revoke all on function public.posteingang_naechster() from public, anon, authenticated;
grant execute on function public.posteingang_naechster() to service_role;

-- Zeitjobs: Abruf alle 5 Minuten (nur wenn ein Postfach aktiv ist), KI jede Minute (nur wenn etwas
-- wartet), Aufräumen nachts. Gleiches Geheimnis wie die Push-Jobs (Tresor push_cron_secret = CRON_SECRET).
select cron.schedule('posteingang-abruf', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://allindrive.netlify.app/.netlify/functions/posteingang-abruf',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')),
    body := '{}'::jsonb)
  where exists (select 1 from public.postfaecher where aktiv);
$job$);
select cron.schedule('posteingang-ki', '* * * * *', $job$
  select net.http_post(
    url := 'https://allindrive.netlify.app/.netlify/functions/posteingang-ki',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')),
    body := '{}'::jsonb)
  where exists (select 1 from public.posteingang where status in ('neu', 'zu_senden') and versuche < 3);
$job$);
select cron.schedule('posteingang-aufraeumen', '45 3 * * *', $job$
  delete from public.posteingang where updated_at < now() - interval '12 months';
  update public.posteingang set status = 'fehler', grund = 'Die KI konnte diese E-Mail nicht bearbeiten. Bitte selbst ansehen.', updated_at = now()
   where status in ('neu', 'zu_senden') and versuche >= 3;
$job$);
