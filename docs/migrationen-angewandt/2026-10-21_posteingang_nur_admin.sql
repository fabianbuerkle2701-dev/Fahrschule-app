-- Fabian 21.10.2026: Lohnpost im Posteingang sieht nur der Fahrschul-Admin, nicht das Büro.
-- Markiert wird beim Abholen (Absenderliste „nur für den Admin“ in den Postfach-Regeln, Lohn-Stichworte) und von der
-- KI (Kategorie „personal“), siehe netlify/functions/lib/posteingang.js nurAdmin(). Rein additiv bis auf die Leseregel.

alter table public.posteingang add column if not exists nur_admin boolean not null default false;

drop policy if exists posteingang_lesen on public.posteingang;
create policy posteingang_lesen on public.posteingang for select to authenticated
  using (public._darf_posteingang(school_id) and (not nur_admin or public._ist_schul_admin(school_id)));

create or replace function public.posteingang_status(p_id uuid, p_status text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_school uuid; v_nur_admin boolean;
begin
  if p_status not in ('erledigt', 'spam', 'braucht_dich') then raise exception 'Ungültiger Status'; end if;
  select school_id, nur_admin into v_school, v_nur_admin from posteingang where id = p_id;
  if v_school is null or not public._darf_posteingang(v_school) then raise exception 'Kein Zugriff'; end if;
  if v_nur_admin and not public._ist_schul_admin(v_school) then raise exception 'Kein Zugriff'; end if;
  update posteingang set status = p_status, updated_at = now(),
         aktionen = aktionen || jsonb_build_array(jsonb_build_object('art', 'status', 'status', p_status, 'von', auth.uid(), 'zeit', now()))
   where id = p_id;
end $function$;

create or replace function public.postfach_regeln_setzen(p_school uuid, p_regeln jsonb, p_aktiv boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (auth.uid() = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid or public._ist_schul_admin(p_school)) then
    raise exception 'Nur der Fahrschul-Admin darf die Regeln ändern.';
  end if;
  update postfaecher set
    regeln = jsonb_build_object(
      'autopilot', coalesce((p_regeln->>'autopilot')::boolean, true),
      'interessenten_anlegen', coalesce((p_regeln->>'interessenten_anlegen')::boolean, true),
      'tageslimit', greatest(0, least(100, coalesce((p_regeln->>'tageslimit')::int, 20))),
      -- Absender, deren E-Mails nur der Admin sieht: Adresse oder Domain (lohnbuero@steuer.de, @steuer.de), höchstens 50
      'nur_admin_absender', (select coalesce(jsonb_agg(a order by a), '[]'::jsonb) from (
          select distinct lower(btrim(x)) a
          from jsonb_array_elements_text(case when jsonb_typeof(p_regeln->'nur_admin_absender') = 'array' then p_regeln->'nur_admin_absender' else '[]'::jsonb end) x
          where length(btrim(x)) between 3 and 200 and btrim(x) !~ '[[:space:]<>"]'
          limit 50) t)),
    -- Wieder eingeschaltet: alten Fehlerstand vergessen, sonst pausiert der nächste Fehler sofort wieder
    fehler_seit = case when p_aktiv is true and not aktiv then null else fehler_seit end,
    letzter_fehler = case when p_aktiv is true and not aktiv then '' else letzter_fehler end,
    aktiv = coalesce(p_aktiv, aktiv), updated_at = now()
  where school_id = p_school;
end $function$;

notify pgrst, 'reload schema';
