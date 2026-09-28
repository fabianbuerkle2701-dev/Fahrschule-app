-- 2026-09-27 · KI-Schalter je Fahrschule (Marktreife Stufe 2, Datenschutz) · v2.38.0
-- Der Fahrschul-Admin kann alle KI-Funktionen seiner Schule ausschalten. Voreinstellung: an (wie bisher).
-- Durchgesetzt wird serverseitig in den Netlify-Functions (lib/ki-guard.js + die 3 öffentlichen KI-Functions);
-- der Client blendet die KI-Einstiege nur zusätzlich aus.

alter table public.schools add column if not exists ki_aus boolean not null default false;

-- 1) Angemeldete Konten: darf mein Konto KI nutzen? (Konto ohne Schule: ja)
create or replace function public.ki_erlaubt()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select not s.ki_aus from profiles p join schools s on s.id = p.school_id where p.id = auth.uid()), true);
$$;
revoke all on function public.ki_erlaubt() from public, anon;
grant execute on function public.ki_erlaubt() to authenticated;

-- 2) Öffentliche Functions (Buchungscode): verrät nur ein Ja/Nein, deshalb auch für anon.
create or replace function public.public_ki_erlaubt(code text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select not s.ki_aus from profiles p join schools s on s.id = p.school_id where p.id = _owner_by_code(code)), true);
$$;
revoke all on function public.public_ki_erlaubt(text) from public;
grant execute on function public.public_ki_erlaubt(text) to anon, authenticated;
