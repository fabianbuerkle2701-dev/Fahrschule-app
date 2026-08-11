-- Sicherheits-Fix: Row Level Security für public.student_login_throttle fehlte.
--
-- Ursache: Die Tabelle speichert den Fehlversuchs-Zähler und die Sperrfrist für den
-- PIN-Login des Fahrschülerbereichs (siehe Funktion public._verify_student_login:
-- nach 8 falschen PIN-Versuchen innerhalb einer Stunde wird 15 Minuten gesperrt).
-- Ohne aktiviertes RLS ist die Tabelle für jeden mit dem öffentlichen Supabase-
-- Anon-Key voll lesbar UND beschreibbar (Standard-Policy von PostgREST ohne RLS).
-- Damit lässt sich die Sperre umgehen, indem man vor jedem PIN-Versuch die eigene
-- throttle_key-Zeile direkt per REST-Aufruf löscht oder zurücksetzt - der PIN-Login
-- ist dann effektiv unbegrenzt brute-forcebar, obwohl die Anwendung selbst (laut
-- Changelog v1.??) genau das verhindern sollte.
--
-- Die Tabelle wird ausschließlich von der SECURITY DEFINER-Funktion
-- public._verify_student_login gelesen/geschrieben - kein Frontend-Code greift
-- direkt darauf zu (geprüft per grep über index.html). Security-Definer-Funktionen
-- umgehen RLS, wenn ihr Owner (wie hier) auch Owner/privilegiert genug für die
-- Tabelle ist - das ist bereits exakt so für z.B. public.students eingerichtet
-- (dort ist RLS ebenfalls aktiv, und dieselbe Art von Funktionen schreibt trotzdem
-- erfolgreich hinein). Reines Aktivieren von RLS ohne Policies sperrt daher nur den
-- direkten Zugriff über den Anon-/Authenticated-Key und lässt die App unverändert
-- funktionsfähig.
--
-- Additiv, keine Datenänderung, keine Schema-Änderung außer dem RLS-Flag.

alter table public.student_login_throttle enable row level security;

-- Bewusst keine Policies: Es gibt keinen legitimen Grund, dass ein Client (anon
-- oder authenticated) direkt auf diese Tabelle zugreift. Ohne Policy blockt RLS
-- jeden PostgREST-Zugriff vollständig, während public._verify_student_login (läuft
-- mit den Rechten ihres Owners) weiterhin normal lesen und schreiben kann.
