-- Allindrive Autopilot · Fuhrpark & Termine (21.10.2026): Fristen der Fahrschule.
-- Eigene Fristen neben dem TÜV-Datum der Fahrzeuge: Versicherung, Leasing-Ende, Inspektion, Reifenwechsel,
-- Fahrlehrerlaubnis/Führerschein-Kontrolle, Fortbildung, Behörde … – optional mit Fahrzeug oder Person und
-- mit Wiederholung (z. B. alle 12 Monate). Bewusst NICHT in schools.vehicles: diese Spalte gibt cal_info an
-- jeden mit dem Kalender-Link heraus. Lesen und schreiben dürfen Fahrschul-Admin und Büro (_darf_schulweit),
-- das Demo-Konto nur lesen. Rein additiv.

create table if not exists public.schul_fristen (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  titel text not null,
  art text not null default 'sonstiges',
  faellig_am date not null,
  fahrzeug_id text,
  person_id uuid references public.profiles(id) on delete set null,
  wiederholung_monate integer,
  notiz text not null default '',
  erledigt_am date,
  erstellt_von uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schul_frist_titel check (length(btrim(titel)) between 1 and 120),
  constraint schul_frist_art check (art in ('fahrzeug', 'versicherung', 'leasing', 'personal', 'fortbildung', 'behoerde', 'sonstiges')),
  constraint schul_frist_fahrzeug check (fahrzeug_id is null or length(fahrzeug_id) <= 64),
  constraint schul_frist_wiederholung check (wiederholung_monate is null or wiederholung_monate between 1 and 120),
  constraint schul_frist_notiz check (length(notiz) <= 1000)
);
comment on table public.schul_fristen is 'Allindrive Autopilot: Fristen der Fahrschule (Versicherung, Leasing, Personal, Fortbildung …), optional mit Fahrzeug/Person und Wiederholung. Admin und Büro.';
create index if not exists schul_fristen_offen on public.schul_fristen (school_id, faellig_am) where erledigt_am is null;

alter table public.schul_fristen enable row level security;
revoke all on public.schul_fristen from anon;
grant select, insert, update, delete on public.schul_fristen to authenticated;
drop policy if exists schul_frist_lesen on public.schul_fristen;
drop policy if exists schul_frist_anlegen on public.schul_fristen;
drop policy if exists schul_frist_aendern on public.schul_fristen;
drop policy if exists schul_frist_loeschen on public.schul_fristen;
create policy schul_frist_lesen on public.schul_fristen for select to authenticated using (public._darf_schulweit(school_id));
create policy schul_frist_anlegen on public.schul_fristen for insert to authenticated
  with check (public._darf_schulweit(school_id) and not public._ist_demo()
              and (person_id is null or exists (select 1 from public.profiles p where p.id = person_id and p.school_id = schul_fristen.school_id)));
create policy schul_frist_aendern on public.schul_fristen for update to authenticated
  using (public._darf_schulweit(school_id) and not public._ist_demo())
  with check (public._darf_schulweit(school_id) and not public._ist_demo()
              and (person_id is null or exists (select 1 from public.profiles p where p.id = person_id and p.school_id = schul_fristen.school_id)));
create policy schul_frist_loeschen on public.schul_fristen for delete to authenticated
  using (public._darf_schulweit(school_id) and not public._ist_demo());

-- Erledigt: in einem Schritt abhaken und – bei Wiederholung – die nächste Frist anlegen.
-- SECURITY INVOKER: die Regeln oben gelten auch hier.
create or replace function public.schul_frist_erledigen(p_id uuid)
returns uuid language plpgsql security invoker set search_path to 'public' as $$
declare v public.schul_fristen; v_neu uuid;
begin
  select * into v from public.schul_fristen where id = p_id for update;
  if not found then raise exception 'Frist nicht gefunden'; end if;
  if v.erledigt_am is not null then return null; end if;
  update public.schul_fristen set erledigt_am = (now() at time zone 'Europe/Berlin')::date, updated_at = now() where id = p_id;
  if v.wiederholung_monate is not null then
    insert into public.schul_fristen (school_id, titel, art, faellig_am, fahrzeug_id, person_id, wiederholung_monate, notiz)
    values (v.school_id, v.titel, v.art, (v.faellig_am + make_interval(months => v.wiederholung_monate))::date, v.fahrzeug_id, v.person_id, v.wiederholung_monate, v.notiz)
    returning id into v_neu;
  end if;
  return v_neu;
end $$;
revoke all on function public.schul_frist_erledigen(uuid) from public, anon;
grant execute on function public.schul_frist_erledigen(uuid) to authenticated;

-- Proben (21.10.2026, verworfene Transaktion, Ergebnis per raise exception, danach 0 Zeilen):
-- normaler Fahrschul-Admin legt an und sieht · Erledigen legt die Folgefrist +12 Monate an · fremde Schule,
-- Person einer fremden Schule und unbekannte Art gesperrt · reiner Fahrlehrer sieht nichts und legt nichts an ·
-- Demo-Konto legt nichts an · anon liest nicht. get_advisors: nur der bekannte, gewollte Hinweis
-- „SECURITY DEFINER von authenticated ausführbar“ für school_rechnungen/school_erinnerung_vermerken (Prüfung im Körper).
