-- 2026-09-28 · Fahrzeug an jeder Fahrstunde (#23) · v2.52.0
-- Additiv wie appointments.ziel/abholort; ältere App-Versionen schreiben/lesen die Spalte nicht.
-- Der Wert ist die id aus schools.vehicles (z.B. "veh_lx3k…"), dieselbe wie bookings.vehicle_id.
alter table public.appointments add column if not exists fahrzeug text;
do $mig$ begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_fahrzeug_laenge') then
    alter table public.appointments add constraint appointments_fahrzeug_laenge check (fahrzeug is null or char_length(fahrzeug) <= 64);
  end if;
end $mig$;

-- Ist das Fahrzeug in diesem Zeitraum schon belegt - durch einen Termin eines Kollegen derselben
-- Fahrschule oder eine Buchung im Fahrzeug-Kalender? Liefert den ersten Treffer oder null.
-- Nur Name des Kollegen und Uhrzeit, keine Schülerdaten. Ohne Fahrschule immer null (dann prüft
-- der Client die eigenen Termine selbst).
create or replace function public.fahrzeug_belegt(p_fahrzeug text, p_start timestamptz, p_end timestamptz, p_ausser uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_school uuid; r record; v_ende timestamptz := coalesce(p_end, p_start + interval '45 minutes');
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if p_fahrzeug is null or p_fahrzeug = '' or p_start is null then return null; end if;
  select school_id into v_school from profiles where id = auth.uid();
  if v_school is null then return null; end if;
  select a.start_at, a.end_at, coalesce(nullif(p.display_name, ''), 'Kollege') as wer into r
    from appointments a join profiles p on p.id = a.owner
   where p.school_id = v_school and a.fahrzeug = p_fahrzeug
     and (p_ausser is null or a.id <> p_ausser)
     and a.owner <> auth.uid()
     and a.start_at < v_ende and coalesce(a.end_at, a.start_at + interval '45 minutes') > p_start
   order by a.start_at limit 1;
  if found then
    return jsonb_build_object('quelle', 'termin', 'wer', r.wer, 'start_at', r.start_at, 'end_at', r.end_at);
  end if;
  select b.start_at, b.end_at, coalesce(nullif(b.teacher_name, ''), 'Fahrzeug-Kalender') as wer into r
    from bookings b
   where b.school_id = v_school and b.vehicle_id = p_fahrzeug
     and (b.teacher_id is null or b.teacher_id <> auth.uid())
     and b.start_at < v_ende and b.end_at > p_start
   order by b.start_at limit 1;
  if found then
    return jsonb_build_object('quelle', 'kalender', 'wer', r.wer, 'start_at', r.start_at, 'end_at', r.end_at);
  end if;
  return null;
end $$;
revoke all on function public.fahrzeug_belegt(text, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.fahrzeug_belegt(text, timestamptz, timestamptz, uuid) to authenticated;

-- Gefahrene Minuten je Fahrzeug aus den Terminen der ganzen Fahrschule (für die Fuhrpark-
-- Auslastung). Nur Summen je Fahrzeug, keine Einzeltermine.
create or replace function public.fahrzeug_minuten(p_von timestamptz, p_bis timestamptz)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_school uuid; v jsonb;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select school_id into v_school from profiles where id = auth.uid();
  select coalesce(jsonb_object_agg(fahrzeug, minuten), '{}'::jsonb) into v from (
    select a.fahrzeug, sum(extract(epoch from (coalesce(a.end_at, a.start_at + interval '45 minutes') - a.start_at)) / 60)::int as minuten
      from appointments a join profiles p on p.id = a.owner
     where a.fahrzeug is not null
       and (case when v_school is null then a.owner = auth.uid() else p.school_id = v_school end)
       and a.start_at >= p_von and a.start_at < p_bis
     group by a.fahrzeug) t;
  return v;
end $$;
revoke all on function public.fahrzeug_minuten(timestamptz, timestamptz) from public, anon;
grant execute on function public.fahrzeug_minuten(timestamptz, timestamptz) to authenticated;
