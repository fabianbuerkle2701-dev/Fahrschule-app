-- Funktionen ein/aus (v2.110.0), angewandt 2026-10-07.
-- Jeder Fahrlehrer kann die als "persoenlich" markierten Funktionen (FUNKTIONEN in index.html)
-- nur für seine eigene Oberfläche ausblenden. Schulweite Schalter bleiben in schools.bereiche_aus
-- (der Fahrschul-Admin schaltet dort jede Funktion für alle aus, inkl. Schüler-App).
-- Gelesen/geschrieben vom Fahrlehrer selbst über die bestehende profiles-RLS (eigene Zeile).
alter table public.profiles add column if not exists funktionen_aus text[] not null default '{}';
