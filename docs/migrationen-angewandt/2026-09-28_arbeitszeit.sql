-- 2026-09-28 · Arbeitszeitnachweis nach § 12 FahrlG für Admin und Büro · v2.44.0
-- Liefert je Fahrlehrer der Schule die Termine eines Zeitraums (höchstens 31 Tage) - nur Zeiten,
-- Art und Status, keine Schülernamen oder Notizen. Ausgewertet wird im Client (arbeitszeitTage).
-- Nur der Urlaubs-/Sonstige-Marker aus der Notiz wird als Typ mitgegeben, damit solche Blocker
-- nicht als Arbeitszeit zählen.
create or replace function public.school_arbeitszeit(p_school_id uuid, p_von timestamptz, p_bis timestamptz)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not _darf_schulweit(p_school_id) then raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro'; end if;
  if p_von is null or p_bis is null or p_bis <= p_von or p_bis - p_von > interval '32 days' then
    raise exception 'Zeitraum ungültig (höchstens ein Monat)';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'lehrer_id', a.owner, 'start_at', a.start_at, 'end_at', a.end_at, 'art', a.art, 'status', a.status,
      'typ', case when coalesce(a.note, '') like '§URLAUB§%' then 'urlaub'
                  when a.art = 'PRIVAT' then 'privat'
                  when coalesce(a.note, '') like '§SONST§%' then 'sonstige' end) order by a.start_at)
    from appointments a
    join profiles p on p.id = a.owner
    where p.school_id = p_school_id and a.start_at >= p_von and a.start_at < p_bis
      and coalesce(a.status, '') in ('', 'confirmed', 'cancel_requested')), '[]'::jsonb);
end $$;
revoke all on function public.school_arbeitszeit(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.school_arbeitszeit(uuid, timestamptz, timestamptz) to authenticated;
