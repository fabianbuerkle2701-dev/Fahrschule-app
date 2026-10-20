-- KI-Verwaltung · Posteingang (v2.126.0): Wird ein pausiertes Postfach wieder eingeschaltet, den
-- alten Fehlerstand vergessen - sonst pausiert der nächste Abruffehler es sofort wieder
-- (posteingang-abruf.js pausiert nach drei Tagen am Stück mit Fehlern, gemessen ab fehler_seit).
create or replace function public.postfach_regeln_setzen(p_school uuid, p_regeln jsonb, p_aktiv boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (auth.uid() = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid or public._ist_schul_admin(p_school)) then
    raise exception 'Nur der Fahrschul-Admin darf die Regeln ändern.';
  end if;
  update postfaecher set
    regeln = jsonb_build_object(
      'autopilot', coalesce((p_regeln->>'autopilot')::boolean, true),
      'interessenten_anlegen', coalesce((p_regeln->>'interessenten_anlegen')::boolean, true),
      'tageslimit', greatest(0, least(100, coalesce((p_regeln->>'tageslimit')::int, 20)))),
    -- Wieder eingeschaltet: alten Fehlerstand vergessen, sonst pausiert der nächste Fehler sofort wieder
    fehler_seit = case when p_aktiv is true and not aktiv then null else fehler_seit end,
    letzter_fehler = case when p_aktiv is true and not aktiv then '' else letzter_fehler end,
    aktiv = coalesce(p_aktiv, aktiv), updated_at = now()
  where school_id = p_school;
end $$;
revoke all on function public.postfach_regeln_setzen(uuid, jsonb, boolean) from public, anon;
grant execute on function public.postfach_regeln_setzen(uuid, jsonb, boolean) to authenticated;
