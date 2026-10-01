-- Live-Kalender (v2.79.0), angewandt 2026-10-01.
-- Termine über Supabase Realtime an die Fahrlehrer-App melden.
-- INSERT/UPDATE liefert Realtime nur an Abonnenten, die die Zeile per RLS sehen dürfen
-- ("appt eigene sehen": owner = auth.uid()) - geprüft: ein anonymer Abonnent bekam bei einem
-- Test-INSERT nichts. DELETE-Ereignisse gehen (Supabase-Verhalten, wie bei bookings) an alle
-- Abonnenten, enthalten aber nur die Termin-ID (UUID), keine Inhalte. Die App abonniert DELETE nicht.
alter publication supabase_realtime add table public.appointments;
