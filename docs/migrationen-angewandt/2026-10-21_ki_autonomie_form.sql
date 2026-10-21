-- Fabian 21.10.2026: Schalter „Was die KI selbst erledigt“ (schools.ki_autonomie) – nur die bekannten Schalter,
-- nur ja/nein. Schreiben darf ohnehin nur der Fahrschul-Admin (Regel „school admins update own school“);
-- die KI handelt erst mit Paket Vollautonom UND Schalter UND eingeschalteter KI (Prüfung in den Functions).

alter table public.schools drop constraint if exists schools_ki_autonomie_form;
alter table public.schools add constraint schools_ki_autonomie_form check (
  jsonb_typeof(ki_autonomie) = 'object'
  and (ki_autonomie - array['mails_alle', 'erinnerungen', 'zahlungen_buchen', 'belege_buchen', 'abrechnen', 'werkstatt_termine']) = '{}'::jsonb
  and not jsonb_path_exists(ki_autonomie, '$.* ? (@.type() != "boolean")')
);
