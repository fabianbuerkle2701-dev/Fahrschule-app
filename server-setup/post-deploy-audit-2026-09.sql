-- ANGEWANDT am 2026-09-25 nach dem Deploy von v2.12.0 (Migration post_deploy_audit_2026_09_chat_limit_revoke).
-- Live geprüft: anon -> permission denied; booking-chat, explain-theory-question, morning-briefing antworten weiter (Service-Role-Key).
-- Audit 2026-09 (Server & DB): Schritte, die erst NACH dem Deploy der Netlify-Functions laufen
-- dürfen. Vorher würden sie die Live-App v2.9.33 bzw. die noch alten Functions brechen.
--
-- Reihenfolge:
--   1. Netlify: Umgebungsvariable SUPABASE_SERVICE_ROLE_KEY ist gesetzt (wird schon von
--      admin-delete-account.js/public-video-url.js genutzt - nur kurz prüfen).
--   2. Functions deployen (booking-chat.js, morning-briefing.js, explain-theory-question.js
--      rufen public_chat_rate_limit ab diesem Stand mit dem Service-Role-Key auf).
--   3. Nach dem Deploy einmal LIVE prüfen (Netlify-Functions lassen sich lokal nicht testen):
--      Buchungs-Chat auf einer Buchungsseite eine Frage stellen -> Antwort kommt. Oder per
--      curl -X POST .../.netlify/functions/booking-chat mit {"code":"<code>","message":"Hallo"}
--      -> 200 mit "reply". Im Netlify-Log darf kein 401/403 von /rest/v1/rpc stehen.
--   4. Erst dann diese Datei ausführen (Supabase SQL-Editor oder apply_migration).
--   5. Schritt 3 wiederholen - muss weiter funktionieren. Gegenprobe ohne Service-Key:
--      curl -X POST https://oavuftlfnknucxuortar.supabase.co/rest/v1/rpc/public_chat_rate_limit
--        -H "apikey: <anon-key>" -H "Content-Type: application/json"
--        -d '{"code":"<code>","max_per_day":1,"p_feature":"booking-chat"}'
--      -> muss jetzt mit "permission denied for function public_chat_rate_limit" scheitern.
--
-- Rückweg, falls der Chat danach nicht mehr antwortet:
--   GRANT EXECUTE ON FUNCTION public.public_chat_rate_limit(text, integer, text) TO anon, authenticated;

-- L-M4: public_chat_rate_limit(code, max_per_day, p_feature) war für anon ausführbar. Da der
-- Buchungscode kein Geheimnis ist (steht in jedem Buchungslink), konnte jeder per curl das
-- Tageskontingent einer Schule (Chat, Briefing, Theorie-Erklärungen) auf null zählen - die
-- Functions liefern danach bis Mitternacht nur noch "Tageslimit erreicht". Den Zähler erhöhen
-- dürfen künftig nur noch die Functions selbst (service_role).
REVOKE ALL ON FUNCTION public.public_chat_rate_limit(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_chat_rate_limit(text, integer, text) TO service_role;

-- Abschluss-Audit 2026-09 (L-N9-Rest) - NICHT per SQL, nur im Supabase-Dashboard:
--   - Auth > Password Security: "Leaked password protection" (HaveIBeenPwned) einschalten.
--     Betrifft nur neue/geänderte Passwörter, bestehende Konten bleiben unberührt.
--   - pg_net liegt im Schema public (Advisor extension_in_public). pg_net ist nicht
--     verschiebbar (ALTER EXTENSION ... SET SCHEMA geht nicht); nur per Drop/Neuanlage im Schema
--     extensions - vorher prüfen, dass notify_appointment_push/Cron-Jobs net.http_post weiter finden.
--     Kein akutes Risiko, bei Gelegenheit (z.B. beim netcup-Umzug) erledigen.
