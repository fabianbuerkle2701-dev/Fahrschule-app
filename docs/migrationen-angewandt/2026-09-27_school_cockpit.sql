-- 2026-09-27 · Inhaber-Cockpit (Produktplan Teil N) · v2.34.0
-- Eine rein lesende, schulweite Abfrage für die Entscheidungs-Kennzahlen des Inhabers.
-- Gleiche Schutzbauart wie die übrigen school_*-RPCs: SECURITY DEFINER + _ist_schul_admin().
-- Keine Notizen, Bewertungen oder Kontaktdaten - nur Termine/Minuten, Datumswerte, Status.
create or replace function public.school_cockpit(p_school_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tz constant text := 'Europe/Berlin';
  v jsonb;
begin
  if not _ist_schul_admin(p_school_id) then
    raise exception 'Kein Zugriff: nur Fahrschul-Admin';
  end if;
  select jsonb_build_object(
    -- Fahrlehrer mit Arbeitszeiten und Limits (für die freie Kapazität)
    'lehrer', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', coalesce(nullif(p.display_name, ''), split_part(p.email, '@', 1)),
        'work_hours', p.work_hours,
        'day_limit', coalesce(p.day_limit, 0),
        'week_limit', coalesce(p.week_limit, 0)))
      from profiles p where p.school_id = p_school_id), '[]'::jsonb),
    -- Belegung je Fahrlehrer und Tag, heute bis +28 Tage (bestätigt = belegt, Anfragen gezählt)
    'belegung', coalesce((
      select jsonb_agg(x) from (
        select a.owner as lehrer_id,
               to_char(a.start_at at time zone v_tz, 'YYYY-MM-DD') as datum,
               coalesce(sum(case when a.status <> 'pending'
                   then extract(epoch from (coalesce(a.end_at, a.start_at + interval '45 minutes') - a.start_at)) / 60
                   else 0 end), 0)::int as minuten,
               (count(*) filter (where a.status = 'pending'))::int as anfragen
        from appointments a
        join profiles p on p.id = a.owner
        where p.school_id = p_school_id
          and a.start_at >= date_trunc('day', now() at time zone v_tz) at time zone v_tz
          and a.start_at < (date_trunc('day', now() at time zone v_tz) + interval '28 days') at time zone v_tz
          and coalesce(a.status, '') <> 'offered'
        group by 1, 2) x), '[]'::jsonb),
    -- Aktive Schüler: letzte/nächste Fahrstunde, erste Stunde, bestandene Praxisprüfung
    'schueler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', btrim(coalesce(s.data->>'vorname', '') || ' ' || coalesce(s.data->>'name', '')),
        'lehrer_id', s.owner,
        'archiviert', coalesce(s.data->>'archived', 'false') = 'true',
        'angemeldet', coalesce(s.data->>'pending', 'false') <> 'true',
        'angelegt', s.created_at,
        'letzte', greatest(
            (select max(a.start_at) from appointments a
              where a.student_id::text = s.id::text and a.status in ('confirmed', 'cancel_requested') and a.start_at < now()),
            (select max((e->>'date')::date)::timestamptz
               from jsonb_array_elements(case when jsonb_typeof(s.data->'drivenLessons') = 'array' then s.data->'drivenLessons' else '[]'::jsonb end) e
              where (e->>'date') ~ '^\d{4}-\d{2}-\d{2}')),
        'naechste', (select min(a.start_at) from appointments a
              where a.student_id::text = s.id::text and a.status in ('confirmed', 'pending', 'cancel_requested') and a.start_at >= now()),
        'erste_stunde', (select min((e->>'date')::date)
               from jsonb_array_elements(case when jsonb_typeof(s.data->'drivenLessons') = 'array' then s.data->'drivenLessons' else '[]'::jsonb end) e
              where (e->>'date') ~ '^\d{4}-\d{2}-\d{2}'),
        'bestanden_am', (select min((e->>'date')::date)
               from jsonb_array_elements(case when jsonb_typeof(s.data->'exams') = 'array' then s.data->'exams' else '[]'::jsonb end) e
              where e->>'art' = 'praxis' and e->>'passed' = 'true' and (e->>'date') ~ '^\d{4}-\d{2}-\d{2}')))
      from students s
      join profiles p on p.id = s.owner
      where p.school_id = p_school_id), '[]'::jsonb),
    -- Interessenten der letzten 90 Tage nach Status (Conversion Anfrage -> Anmeldung)
    'interessenten', coalesce((
      select jsonb_object_agg(st, n) from (
        select coalesce(i.status, 'offen') as st, count(*)::int as n
        from interessenten i join profiles p on p.id = i.owner
        where p.school_id = p_school_id and i.created_at >= now() - interval '90 days'
        group by 1) y), '{}'::jsonb)
  ) into v;
  return v;
end;
$function$;

revoke all on function public.school_cockpit(uuid) from public, anon;
grant execute on function public.school_cockpit(uuid) to authenticated;
