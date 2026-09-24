-- Teil 8/N: Funktions-EXECUTE-Rechte, die vom Supabase-Default abweichen (per CREATE FUNCTION
-- wird EXECUTE standardmaessig an PUBLIC vergeben - diese hier wurden auf Cloud bewusst
-- eingeschraenkt und muessen hier reproduziert werden. Gefunden durch den Sicherheitsaudit-
-- Nachtest von Phase 3 (admin_school_stats() war anon-aufrufbar, haette es nicht sein duerfen).

REVOKE EXECUTE ON FUNCTION public._can_review_theory_resource FROM anon;
REVOKE EXECUTE ON FUNCTION public._payer_lookup_allowed FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_school_stats FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_school_teachers FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_teacher_flags FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_and_assign_school FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_school_location FROM anon;
REVOKE EXECUTE ON FUNCTION public.ensure_widget_token FROM anon;
REVOKE EXECUTE ON FUNCTION public.join_school_by_code FROM anon;
-- Neu angelegte Funktionen bekommen von Postgres per Default EXECUTE fuer PUBLIC (nicht nur fuer
-- anon) - anders als die uebrigen, laenger bestehenden Funktionen in dieser Datei. Deshalb hier
-- zusaetzlich explizit von PUBLIC entzogen, sonst waere ki_rate_limit trotz REVOKE FROM anon
-- ueber die PUBLIC-Rolle weiterhin fuer anon aufrufbar gewesen (beim Anlegen am 23.9.2026 per
-- Advisor-Check aufgefallen - lohnt sich, bei jeder kuenftigen neuen Funktion zu pruefen).
REVOKE EXECUTE ON FUNCTION public.ki_rate_limit FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.ki_rate_limit TO authenticated;
REVOKE EXECUTE ON FUNCTION public.my_school_id FROM anon;
REVOKE EXECUTE ON FUNCTION public.next_document_number FROM anon;
REVOKE EXECUTE ON FUNCTION public.profile_email_by_id FROM anon;
REVOKE EXECUTE ON FUNCTION public.profile_id_by_email FROM anon;
REVOKE EXECUTE ON FUNCTION public.school_exam_stats FROM anon;
REVOKE EXECUTE ON FUNCTION public.school_leistungen FROM anon;
REVOKE EXECUTE ON FUNCTION public.school_offene_posten FROM anon;
REVOKE EXECUTE ON FUNCTION public.school_teacher_hours FROM anon;
REVOKE EXECUTE ON FUNCTION public.school_teacher_month FROM anon;
REVOKE EXECUTE ON FUNCTION public.school_verguetung_list FROM anon;
REVOKE EXECUTE ON FUNCTION public.school_verguetung_set FROM anon;
REVOKE EXECUTE ON FUNCTION public.student_data_delete FROM anon;
REVOKE EXECUTE ON FUNCTION public.voucher_redeem FROM anon;

REVOKE EXECUTE ON FUNCTION public._owner_by_code FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._verify_student_login FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_delete_students_with_invoices FROM anon, authenticated;

-- Audit 2026-09 (Server & DB): REVOKE FROM anon allein reicht nicht, solange PUBLIC das Recht
-- noch hat (anon erbt von PUBLIC) - genau das war bei den folgenden Funktionen der Fall.
-- Live angewandt per Migration audit_2026_09_schueler_login_pin_reset_rechte bzw.
-- audit_2026_09_buchungslink_pruefungen.
REVOKE ALL ON FUNCTION public.student_data_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_data_delete(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_school_teachers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_school_teachers(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_and_assign_school(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_and_assign_school(text) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_school_location(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_school_location(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.join_school_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_school_by_code(text) TO authenticated;
REVOKE ALL ON FUNCTION public.my_school_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_school_id() TO authenticated;
REVOKE ALL ON FUNCTION public._can_review_theory_resource(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._can_review_theory_resource(uuid) TO authenticated;
-- Trigger-Funktionen: EXECUTE wird nur beim CREATE TRIGGER geprüft, nicht beim Auslösen.
REVOKE ALL ON FUNCTION public._guard_profile_privilege_flags() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._hash_student_pins() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_appointment_push() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._guard_student_owner_share() FROM PUBLIC, anon, authenticated;
-- Seit v2.9.32 unbenutzt und ein Umweg um die Prüfungen von public_book_or_propose_appointment.
REVOKE ALL ON FUNCTION public.public_propose_appointment(text, timestamp with time zone, timestamp with time zone, text, text, text) FROM PUBLIC, anon, authenticated;
-- Neue Funktionen (Audit 2026-09): nur intern bzw. nur angemeldet.
REVOKE ALL ON FUNCTION public._student_pin_matches(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_reset_student_pin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_reset_student_pin(uuid, text) TO authenticated;

-- Abschluss-Audit 2026-09: nachgezogen, damit ein Neuaufbau (netcup) dieselben Rechte hat wie live.
-- invite_code_gueltig läuft vor dem Login (Registrierung) - deshalb bewusst auch anon.
REVOKE ALL ON FUNCTION public.invite_code_gueltig(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_code_gueltig(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.profile_id_by_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_id_by_email(text) TO authenticated;
REVOKE ALL ON FUNCTION public._storage_pfad_verwaist(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._storage_pfad_verwaist(text, text) TO authenticated;
-- L-M4: den Zähler erhöhen dürfen nur die Netlify-Functions (service_role). Live erst NACH dem
-- Function-Deploy (server-setup/post-deploy-audit-2026-09.sql) - bei einem Neuaufbau laufen die
-- neuen Functions von Anfang an, deshalb hier direkt.
REVOKE ALL ON FUNCTION public.public_chat_rate_limit(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_chat_rate_limit(text, integer, text) TO service_role;
