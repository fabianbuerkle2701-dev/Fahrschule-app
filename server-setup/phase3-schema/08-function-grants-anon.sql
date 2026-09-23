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
