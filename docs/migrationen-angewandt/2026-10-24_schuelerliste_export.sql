-- Allindrive Autopilot · Schülerliste exportieren (Fabian 23.10.2026, Lückenliste „Kleinkram“): alle Schüler der
-- Fahrschule als Tabelle – dieselben Spalten wie „Schülerliste exportieren“ der App (exportSchuelerliste), dazu der
-- zuständige Fahrlehrer. Admin und Büro; ohne Notizen und ohne PIN. Für Kosten/Bezahlt/Offen liefert die Funktion
-- Fahrstunden (ohne Notizen), Posten, Zahlungen, Pakete und Rechnungen – gerechnet wird im Autopilot wie in der App.
create or replace function public.school_schueler_export(p_school_id uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_school_id is null or not _darf_schulweit(p_school_id) then raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'student_id', s.id, 'vorname', coalesce(s.data->>'vorname', ''), 'name', coalesce(s.data->>'name', ''), 'klasse', coalesce(s.data->>'klasse', ''),
      'geb', coalesce(s.data->>'geb', ''), 'tel', coalesce(s.data->>'tel', ''), 'festnetz', coalesce(s.data->>'festnetz', ''),
      'eltern_tel', coalesce(s.data->>'elternTel', ''), 'email', coalesce(s.data->>'email', ''), 'anschrift', coalesce(s.data->>'anschrift', ''),
      'ausbildungsbeginn', coalesce(s.data->>'ausbildungsbeginn', ''), 'location_id', coalesce(s.data->>'location_id', ''),
      'theorie', coalesce(s.data->>'theorie', ''), 'sehhilfe', coalesce(s.data->'sehhilfe' = 'true'::jsonb, false),
      'archiviert', coalesce(s.data->'archived' = 'true'::jsonb, false), 'angelegt', s.created_at, 'lehrer', coalesce(_profil_name(s.owner), ''),
      'abrechnungs_modell', s.data->>'abrechnungsModell',
      'lessons', coalesce((select jsonb_agg(e - 'note' - 'notiz' - 'signature') from jsonb_array_elements(_json_liste(s.data->'drivenLessons')) e), '[]'::jsonb),
      'cost_items', _json_liste(s.data->'costItems'), 'payments', _json_liste(s.data->'payments'), 'packages', _json_liste(s.data->'packages'),
      'invoices', _json_liste(s.data->'invoices'))
      order by lower(coalesce(s.data->>'name', '')), lower(coalesce(s.data->>'vorname', '')))
    from students s join profiles p on p.id = s.owner
   where p.school_id = p_school_id and coalesce(s.data->>'dataDeletedAt', '') = '' and coalesce(s.data->>'pending', 'false') <> 'true'), '[]'::jsonb);
end $$;
revoke all on function public.school_schueler_export(uuid) from public, anon;
grant execute on function public.school_schueler_export(uuid) to authenticated;
