-- 2026-10-01 · Buchungsseite anpassen (Fabian) · v2.77.0
-- Fahrlehrer hinterlegt eine Nachricht (optional mit Enddatum), eine Telefonnummer für Rückfragen
-- und kann die Anleitung „So funktioniert es“ ausblenden. Gespeichert im eigenen Profil (RLS wie
-- bisher: nur der Fahrlehrer selbst schreibt). Öffentlich lesbar nur über public_buchungsseite,
-- die ausschließlich diese drei Angaben herausgibt (abgelaufene Nachricht = leer). Additiv.
alter table public.profiles add column if not exists buchungsseite jsonb not null default '{}'::jsonb;

create or replace function public.public_buchungsseite(code text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'nachricht', case when coalesce(p.buchungsseite->>'nachrichtBis', '') = ''
                        or (p.buchungsseite->>'nachrichtBis') >= to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD')
                      then left(coalesce(p.buchungsseite->>'nachricht', ''), 600) else '' end,
    'telefon', left(coalesce(p.buchungsseite->>'telefon', ''), 40),
    'ohneAnleitung', coalesce(p.buchungsseite->>'ohneAnleitung', '') = 'true')
  from profiles p where p.id = _owner_by_code(code);
$$;
revoke all on function public.public_buchungsseite(text) from public;
grant execute on function public.public_buchungsseite(text) to anon, authenticated;
