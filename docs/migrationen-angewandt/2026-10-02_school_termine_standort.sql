-- Team-Kalender: Standort des Schülers mitliefern (v2.97.0, Produktplan #39), angewandt 2026-10-02.
-- school_termine() gibt je Termin zusätzlich 'standort' (students.data->>'location_id') zurück,
-- bei privaten Terminen null. Rückgabetyp bleibt jsonb, die Signatur ist unverändert.
create or replace function public.school_termine(p_school_id uuid, p_von timestamp with time zone, p_bis timestamp with time zone)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not _darf_schulweit(p_school_id) then raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro'; end if;
  if p_von is null or p_bis is null or p_bis <= p_von or p_bis - p_von > interval '14 days' then raise exception 'Zeitraum ungültig (höchstens 14 Tage)'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'lehrer_id', a.owner, 'start_at', a.start_at, 'end_at', a.end_at, 'status', a.status, 'art', a.art,
      'typ', case when coalesce(a.note, '') like '§URLAUB§%' then 'urlaub' when a.art = 'PRIVAT' then 'privat' when coalesce(a.note, '') like '§SONST§%' then 'sonstige' else 'fahrstunde' end,
      'name', case when coalesce(a.note, '') like '§URLAUB§%' or a.art = 'PRIVAT' then null else coalesce(nullif(btrim(coalesce(s.data->>'vorname', '') || ' ' || coalesce(s.data->>'name', '')), ''), a.title) end,
      'klasse', case when a.art = 'PRIVAT' then null else s.data->>'klasse' end,
      'student_id', case when a.art = 'PRIVAT' then null else a.student_id end,
      'standort', case when a.art = 'PRIVAT' then null else nullif(s.data->>'location_id', '') end
    ) order by a.start_at)
    from appointments a join profiles p on p.id = a.owner left join students s on s.id::text = a.student_id
    where p.school_id = p_school_id and a.start_at >= p_von and a.start_at < p_bis and coalesce(a.status, '') <> 'offered'), '[]'::jsonb);
end $function$;
