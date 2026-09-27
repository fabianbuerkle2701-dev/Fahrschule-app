# Angewandte Migrationen

Am 2026-09-27 zusammen mit v2.33.1 auf Supabase `oavuftlfnknucxuortar` eingespielt (apply_migration):

- `anfragen_ueberschneidung_2026_09_27` – jede Überlappung = OVERLAP (live geprüft: überlappend abgelehnt, anschließend angenommen)
- `schueler_unterlagen_2026_09_27` – public_student_overview liefert `unterlagen`
- `student_data_delete_pruefungsreife_2026_09_27` – eingespielt als gezielter Einschub von examReadiness/examReadinessVerlauf in v_felder statt des vollständigen Funktionstexts aus der Datei (sicherer gegen zwischenzeitliche Änderungen)
- `school_cockpit_2026_09_27` (+ `school_cockpit_fix_student_id_text`) – Inhaber-Cockpit, nur lesend, `_ist_schul_admin`; Zugriffstests: eigener Admin ok, fremder Admin/Fahrlehrer/anon abgelehnt
