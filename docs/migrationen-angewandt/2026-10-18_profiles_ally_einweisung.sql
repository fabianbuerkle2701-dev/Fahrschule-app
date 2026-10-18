-- Ally (KI im Kalender, v2.120.0), angewandt 2026-10-18 (apply_migration profiles_ally_einweisung_2026_10_18).
-- Zeitpunkt, zu dem der Fahrlehrer die Einweisung (KI-Kompetenz, Art. 4 KI-VO) bestätigt hat.
-- Ohne Eintrag lehnt die Netlify-Function "ally" ab (fail-closed).
-- Gelesen/geschrieben vom Fahrlehrer selbst über die bestehende profiles-RLS (eigene Zeile).
alter table public.profiles add column if not exists ally_einweisung_am timestamptz;
comment on column public.profiles.ally_einweisung_am is 'Ally: Einweisung bestätigt am (null = noch nicht)';
