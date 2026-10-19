-- KI-Support (v2.125.0): Anfragen der Fahrlehrer an den Allindrive-Support.
-- Beantwortet werden sie von der KI (netlify/functions/support.js), der zentrale App-Admin sieht
-- alle in der Support-Zentrale der App. Der Verlauf enthält keine Schülernamen (die App schickt
-- Kürzel wie S1). Aufbewahrung: 12 Monate nach der letzten Änderung (support_aufraeumen).
--
-- Schreibwege (keine insert/update/delete-Policies, alles über Funktionen):
--   support_anfrage_anlegen   Fahrlehrer  - Absender, Fahrschule, E-Mail setzt der Server
--   support_verlauf_anhaengen nur Server  - Frage und KI-Antwort (Service-Schlüssel)
--   support_rueckmeldung      Fahrlehrer  - „Hat geholfen?“
--   support_weitergeben       Fahrlehrer  - an Allindrive (auch über die KI, oder ohne KI)
--   support_gelesen           Fahrlehrer  - Antwort von Allindrive gesehen
--   support_admin_setzen      App-Admin   - antworten, Status setzen, gesehen

create table if not exists public.support_anfragen (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid references public.schools(id) on delete set null,
  absender text not null default '',
  fahrschule text not null default '',
  kontakt_email text not null default '',
  rolle text not null default 'fahrlehrer',
  thema text not null default '',
  kategorie text not null default 'bedienung',
  status text not null default 'neu',
  zusammenfassung text not null default '',
  verlauf jsonb not null default '[]'::jsonb,
  diagnose jsonb not null default '{}'::jsonb,
  ohne_ki boolean not null default false,
  neu_fuer_nutzer boolean not null default false,
  neu_fuer_admin boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_kategorie_ok check (kategorie in ('bedienung','fehler','konto','abo','datenschutz','wunsch','sonstiges')),
  constraint support_status_ok check (status in ('neu','beantwortet','geloest','nicht_geloest','weitergegeben','erledigt')),
  constraint support_rolle_ok check (rolle in ('fahrlehrer','fahrschul_admin','buero')),
  constraint support_verlauf_liste check (jsonb_typeof(verlauf) = 'array')
);
comment on table public.support_anfragen is 'Anfragen an den KI-Support (v2.125.0). Die KI antwortet, der zentrale App-Admin sieht alle in der Support-Zentrale. Verlauf ohne Schülernamen (Kürzel). Gelöscht 12 Monate nach der letzten Änderung (support_aufraeumen). Schreiben nur über die support_*-Funktionen.';
create index if not exists support_anfragen_nutzer on public.support_anfragen (user_id, updated_at desc);
create index if not exists support_anfragen_status on public.support_anfragen (status, updated_at desc);
create index if not exists support_anfragen_alter on public.support_anfragen (updated_at);

alter table public.support_anfragen enable row level security;
revoke insert, update, delete on public.support_anfragen from anon, authenticated;
revoke all on public.support_anfragen from anon;
drop policy if exists support_lesen on public.support_anfragen;
create policy support_lesen on public.support_anfragen for select to authenticated
  using (user_id = auth.uid() or auth.uid() = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid);

-- Aufbewahrung: 12 Monate nach der letzten Änderung
create or replace function public.support_aufraeumen() returns void
language sql security definer set search_path = public as $$
  delete from public.support_anfragen where updated_at < now() - interval '12 months';
$$;
revoke all on function public.support_aufraeumen() from public, anon, authenticated;

-- 1. Neue Anfrage. Absender, Fahrschule, E-Mail und Rolle kommen vom Server, nicht vom Gerät.
create or replace function public.support_anfrage_anlegen(p_thema text, p_diagnose jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text; v_schule_id uuid; v_admin boolean; v_buero boolean;
  v_schule text; v_email text; v_id uuid;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  if v_uid = '114d1f0a-9947-459d-8009-06282799ca44'::uuid then raise exception 'Im Demo-Modus nicht verfügbar'; end if;
  if (select count(*) from support_anfragen where user_id = v_uid and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Heute sind schon sehr viele Anfragen eingegangen. Bitte schreib in einer bestehenden Anfrage weiter.';
  end if;
  perform support_aufraeumen();
  select display_name, school_id, coalesce(school_admin, false), coalesce(school_office, false)
    into v_name, v_schule_id, v_admin, v_buero from profiles where id = v_uid;
  select name into v_schule from schools where id = v_schule_id;
  select email into v_email from auth.users where id = v_uid;
  insert into support_anfragen (user_id, school_id, absender, fahrschule, kontakt_email, rolle, thema, diagnose)
  values (v_uid, v_schule_id, left(coalesce(v_name, ''), 120), left(coalesce(v_schule, ''), 160), left(coalesce(v_email, ''), 200),
          case when v_admin then 'fahrschul_admin' when v_buero then 'buero' else 'fahrlehrer' end,
          left(btrim(coalesce(p_thema, '')), 300),
          case when p_diagnose is not null and jsonb_typeof(p_diagnose) = 'object' and length(p_diagnose::text) <= 4000 then p_diagnose else '{}'::jsonb end)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.support_anfrage_anlegen(text, jsonb) from public, anon;
grant execute on function public.support_anfrage_anlegen(text, jsonb) to authenticated;

-- 2. Verlauf anhängen: nur der Server (Service-Schlüssel) - Frage und Antwort der KI
create or replace function public.support_verlauf_anhaengen(p_id uuid, p_user uuid, p_eintraege jsonb, p_status text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_eintraege is null or jsonb_typeof(p_eintraege) <> 'array' or jsonb_array_length(p_eintraege) > 4 or length(p_eintraege::text) > 20000 then
    raise exception 'Ungültiger Verlauf';
  end if;
  update support_anfragen
     set verlauf = verlauf || p_eintraege,
         status = case when p_status = 'beantwortet' and status <> 'weitergegeben' then 'beantwortet' else status end,
         updated_at = now(), neu_fuer_admin = true
   where id = p_id and user_id = p_user and jsonb_array_length(verlauf) < 200;
  return found;
end $$;
revoke all on function public.support_verlauf_anhaengen(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.support_verlauf_anhaengen(uuid, uuid, jsonb, text) to service_role;

-- 3. Rückmeldung „Hat geholfen?“
create or replace function public.support_rueckmeldung(p_id uuid, p_hilfreich boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update support_anfragen
     set status = case when p_hilfreich then 'geloest' else 'nicht_geloest' end,
         verlauf = verlauf || jsonb_build_array(jsonb_build_object('rolle', 'system', 'text', case when p_hilfreich then 'Hat geholfen' else 'Hat noch nicht geholfen' end, 'zeit', now())),
         updated_at = now(), neu_fuer_admin = neu_fuer_admin or not p_hilfreich
   where id = p_id and user_id = auth.uid() and status in ('neu', 'beantwortet', 'geloest', 'nicht_geloest') and jsonb_array_length(verlauf) < 200;
end $$;
revoke all on function public.support_rueckmeldung(uuid, boolean) from public, anon;
grant execute on function public.support_rueckmeldung(uuid, boolean) to authenticated;

-- 4. An Allindrive weitergeben (über die KI oder von Hand; ohne KI kommt die Nachricht selbst mit)
create or replace function public.support_weitergeben(p_id uuid, p_kategorie text, p_zusammenfassung text, p_nachricht text default null, p_ohne_ki boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_kat text := case when p_kategorie in ('bedienung','fehler','konto','abo','datenschutz','wunsch','sonstiges') then p_kategorie else 'sonstiges' end;
  v_neu jsonb := '[]'::jsonb;
begin
  if coalesce(btrim(p_nachricht), '') <> '' then
    v_neu := jsonb_build_array(jsonb_build_object('rolle', 'nutzer', 'text', left(btrim(p_nachricht), 4000), 'zeit', now()));
  end if;
  v_neu := v_neu || jsonb_build_array(jsonb_build_object('rolle', 'system', 'text', 'An Allindrive weitergegeben', 'zeit', now()));
  update support_anfragen
     set status = 'weitergegeben', kategorie = v_kat,
         zusammenfassung = left(btrim(coalesce(p_zusammenfassung, '')), 1000),
         ohne_ki = ohne_ki or coalesce(p_ohne_ki, false),
         verlauf = verlauf || v_neu,
         updated_at = now(), neu_fuer_admin = true
   where id = p_id and user_id = auth.uid() and jsonb_array_length(verlauf) < 200;
  if not found then raise exception 'Anfrage nicht gefunden'; end if;
end $$;
revoke all on function public.support_weitergeben(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.support_weitergeben(uuid, text, text, text, boolean) to authenticated;

-- 5. Antwort von Allindrive gesehen
create or replace function public.support_gelesen(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.support_anfragen set neu_fuer_nutzer = false where id = p_id and user_id = auth.uid() and neu_fuer_nutzer;
$$;
revoke all on function public.support_gelesen(uuid) from public, anon;
grant execute on function public.support_gelesen(uuid) to authenticated;

-- 6. Support-Zentrale (nur der zentrale App-Admin): antworten, Status setzen, als gesehen markieren
create or replace function public.support_admin_setzen(p_id uuid, p_status text default null, p_antwort text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_antwort text := btrim(coalesce(p_antwort, ''));
begin
  if auth.uid() is distinct from '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid then
    raise exception 'Nur der App-Admin darf das.';
  end if;
  if p_status is not null and p_status not in ('neu','beantwortet','geloest','nicht_geloest','weitergegeben','erledigt') then
    raise exception 'Ungültiger Status';
  end if;
  update support_anfragen
     set status = coalesce(p_status, status),
         verlauf = case when v_antwort = '' then verlauf
                        else verlauf || jsonb_build_array(jsonb_build_object('rolle', 'allindrive', 'text', left(v_antwort, 4000), 'zeit', now())) end,
         neu_fuer_nutzer = neu_fuer_nutzer or v_antwort <> '',
         neu_fuer_admin = false,
         updated_at = case when v_antwort <> '' or p_status is not null then now() else updated_at end
   where id = p_id;
end $$;
revoke all on function public.support_admin_setzen(uuid, text, text) from public, anon;
grant execute on function public.support_admin_setzen(uuid, text, text) to authenticated;
