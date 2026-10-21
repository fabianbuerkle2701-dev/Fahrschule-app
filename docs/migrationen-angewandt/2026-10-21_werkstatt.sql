-- Fabian 21.10.2026: „Pro Auto eine Werkstatt anlegen – die KI macht dann einen Termin zum Service oder TÜV aus,
-- nach Bestätigung (Teilautonom) oder vollautonom, wie es der Admin will.“
-- Werkstatt-Angaben stehen bewusst nicht in schools.vehicles (die Spalte gibt der Kalender-Link der App heraus).
-- Admin und Büro (wie die Fristen). Anfragen legt nur der Server an (Function werkstatt-anfrage, Zeitjob); einen
-- Termin trägt werkstatt_termin_eintragen ein – nur, wenn das Fahrzeug in der Zeit frei ist.

create table if not exists public.fahrzeug_werkstaetten (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  fahrzeug_id text not null check (length(fahrzeug_id) between 1 and 80),
  name text not null check (length(btrim(name)) between 1 and 120),
  email text not null default '' check (length(email) <= 200),
  telefon text not null default '' check (length(telefon) <= 60),
  ansprechpartner text not null default '' check (length(ansprechpartner) <= 120),
  notiz text not null default '' check (length(notiz) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, fahrzeug_id)
);
alter table public.fahrzeug_werkstaetten enable row level security;
drop policy if exists werkstatt_lesen on public.fahrzeug_werkstaetten;
drop policy if exists werkstatt_anlegen on public.fahrzeug_werkstaetten;
drop policy if exists werkstatt_aendern on public.fahrzeug_werkstaetten;
drop policy if exists werkstatt_loeschen on public.fahrzeug_werkstaetten;
create policy werkstatt_lesen on public.fahrzeug_werkstaetten for select to authenticated using (_darf_schulweit(school_id));
create policy werkstatt_anlegen on public.fahrzeug_werkstaetten for insert to authenticated with check (_darf_schulweit(school_id) and not _ist_demo());
create policy werkstatt_aendern on public.fahrzeug_werkstaetten for update to authenticated
  using (_darf_schulweit(school_id) and not _ist_demo()) with check (_darf_schulweit(school_id) and not _ist_demo());
create policy werkstatt_loeschen on public.fahrzeug_werkstaetten for delete to authenticated using (_darf_schulweit(school_id) and not _ist_demo());
revoke all on public.fahrzeug_werkstaetten from anon;
grant select, insert, update, delete on public.fahrzeug_werkstaetten to authenticated;

create table if not exists public.werkstatt_anfragen (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  fahrzeug_id text not null,
  werkstatt_id uuid references public.fahrzeug_werkstaetten(id) on delete set null,
  anlass text not null check (anlass in ('hu', 'service')),
  status text not null default 'gesendet' check (status in ('gesendet', 'antwort', 'gebucht', 'abgelehnt', 'abgebrochen')),
  an text not null default '',
  betreff text not null default '',
  text text not null default '',
  vorschlaege jsonb not null default '[]'::jsonb,   -- angebotene Zeiten [{start, ende}]
  message_id text not null default '',               -- unsere Anfrage: so findet sich die Antwort (In-Reply-To)
  antwort_mail_id uuid,                              -- posteingang.id der Antwort
  antwort jsonb not null default '{}'::jsonb,        -- was die KI aus der Antwort gelesen hat
  termin_start timestamptz,
  termin_ende timestamptz,
  booking_id uuid,
  von_ki boolean not null default false,             -- Vollautonom: selbst angefragt bzw. eingetragen
  erstellt_von uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists werkstatt_anfragen_schule on public.werkstatt_anfragen (school_id, created_at desc);
alter table public.werkstatt_anfragen enable row level security;
drop policy if exists werkstatt_anfrage_lesen on public.werkstatt_anfragen;
create policy werkstatt_anfrage_lesen on public.werkstatt_anfragen for select to authenticated using (_darf_schulweit(school_id));
revoke all on public.werkstatt_anfragen from anon;
grant select on public.werkstatt_anfragen to authenticated;

-- Termin eintragen: Fahrzeug im Kalender blockieren (bookings) und die Anfrage abschließen. Admin/Büro der Fahrschule
-- oder der Server (Vollautonom). Nur, wenn das Fahrzeug in der Zeit frei ist (Fahrstunden und Fahrzeug-Kalender).
create or replace function public.werkstatt_termin_eintragen(p_anfrage uuid, p_start timestamptz, p_ende timestamptz)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare a werkstatt_anfragen%rowtype; w text; v_id uuid; dienst boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if _ist_demo() then raise exception 'Im Demo-Modus nicht gespeichert.'; end if;
  select * into a from werkstatt_anfragen where id = p_anfrage for update;
  if a.id is null or not (dienst or _darf_schulweit(a.school_id)) then raise exception 'Kein Zugriff'; end if;
  if a.status not in ('gesendet', 'antwort') then raise exception 'Diese Anfrage ist schon erledigt.'; end if;
  if p_start is null or p_ende is null or p_ende <= p_start or p_ende - p_start > interval '12 hours' then raise exception 'Bitte Beginn und Ende prüfen.'; end if;
  if p_start < now() - interval '1 hour' or p_start > now() + interval '120 days' then raise exception 'Der Termin liegt zu weit in der Vergangenheit oder Zukunft.'; end if;
  if exists (select 1 from bookings b where b.school_id = a.school_id and b.vehicle_id = a.fahrzeug_id and b.start_at < p_ende and b.end_at > p_start)
     or exists (select 1 from appointments t join profiles p on p.id = t.owner
                 where p.school_id = a.school_id and t.fahrzeug = a.fahrzeug_id
                   and t.start_at < p_ende and coalesce(t.end_at, t.start_at + interval '45 minutes') > p_start) then
    raise exception 'Das Fahrzeug ist in dieser Zeit schon verplant.';
  end if;
  select name into w from fahrzeug_werkstaetten where id = a.werkstatt_id;
  insert into bookings (school_id, vehicle_id, teacher_name, teacher_id, start_at, end_at, note)
  values (a.school_id, a.fahrzeug_id, left('Werkstatt' || coalesce(': ' || w, ''), 120), null, p_start, p_ende,
          case when a.anlass = 'hu' then 'HU/TÜV' else 'Inspektion/Service' end)
  returning id into v_id;
  update werkstatt_anfragen set status = 'gebucht', termin_start = p_start, termin_ende = p_ende, booking_id = v_id,
         von_ki = von_ki or dienst, updated_at = now()
   where id = p_anfrage;
  return v_id;
end $function$;
revoke all on function public.werkstatt_termin_eintragen(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.werkstatt_termin_eintragen(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- Anfrage beenden (Werkstatt hat abgesagt oder es hat sich erledigt) – Admin/Büro
create or replace function public.werkstatt_anfrage_beenden(p_anfrage uuid, p_status text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare a werkstatt_anfragen%rowtype;
begin
  if _ist_demo() then raise exception 'Im Demo-Modus nicht gespeichert.'; end if;
  if p_status not in ('abgelehnt', 'abgebrochen') then raise exception 'Unbekannter Stand'; end if;
  select * into a from werkstatt_anfragen where id = p_anfrage for update;
  if a.id is null or not _darf_schulweit(a.school_id) then raise exception 'Kein Zugriff'; end if;
  if a.status not in ('gesendet', 'antwort') then raise exception 'Diese Anfrage ist schon erledigt.'; end if;
  update werkstatt_anfragen set status = p_status, updated_at = now() where id = p_anfrage;
end $function$;
revoke all on function public.werkstatt_anfrage_beenden(uuid, text) from public, anon;
grant execute on function public.werkstatt_anfrage_beenden(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- Je Fahrzeug und Anlass höchstens eine offene Anfrage (ein Doppelklick oder zwei Läufe schreiben die Werkstatt nicht zweimal an)
create unique index if not exists werkstatt_anfragen_eine_offene on public.werkstatt_anfragen (school_id, fahrzeug_id, anlass) where status in ('gesendet', 'antwort');

-- Zeitjob Vollautonom: stündlich (die Function fragt nur werktags 8–17 Uhr an), nur wenn eine Fahrschule den Schalter hat
select cron.schedule('vollautonom-werkstatt', '23 * * * *', $cron$
  select net.http_post(
    url := 'https://allindrive.netlify.app/.netlify/functions/vollautonom-werkstatt',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')),
    body := '{}'::jsonb)
  where exists (select 1 from public.schools where autopilot_paket = 'vollautonom' and ki_autonomie->>'werkstatt_termine' = 'true');
$cron$);
