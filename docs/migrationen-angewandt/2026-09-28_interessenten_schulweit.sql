-- 2026-09-28 · Interessenten schulweit für Admin und Büro (Produktplan Teil Q) · v2.42.0
-- Interessenten gehören wie Schüler genau einem Konto (owner, RLS nur owner). Admin und Büro
-- sehen jetzt alle Interessenten der Fahrschule, legen sie für einen Fahrlehrer an, bearbeiten
-- sie und teilen sie einem Fahrlehrer zu. Die Übernahme als Schüler bleibt beim Fahrlehrer.

-- Gemeinsame Prüfung: Konto gehört zur Schule und ist ein Fahrlehrer (kein reines Büro-Konto).
create or replace function public._ist_fahrlehrer_der_schule(p_user uuid, p_school_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from profiles where id = p_user and school_id = p_school_id and not coalesce(school_office, false));
$$;
revoke all on function public._ist_fahrlehrer_der_schule(uuid, uuid) from public, anon, authenticated;

-- 1) Liste
create or replace function public.school_interessenten(p_school_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not _darf_schulweit(p_school_id) then raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'owner', i.owner, 'owner_name', coalesce(nullif(p.display_name, ''), split_part(p.email, '@', 1)),
      'vorname', i.vorname, 'name', i.name, 'tel', i.tel, 'klasse', i.klasse, 'notiz', i.notiz,
      'status', i.status, 'follow_up_am', i.follow_up_am, 'created_at', i.created_at, 'updated_at', i.updated_at)
      order by i.created_at desc)
    from interessenten i join profiles p on p.id = i.owner
    where p.school_id = p_school_id), '[]'::jsonb);
end $$;
revoke all on function public.school_interessenten(uuid) from public, anon;
grant execute on function public.school_interessenten(uuid) to authenticated;

-- 2) Anlegen (p_id null) oder ändern; p_owner = zuständiger Fahrlehrer (null = unverändert)
create or replace function public.school_interessent_speichern(p_school_id uuid, p_id uuid, p_owner uuid, p_felder jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_alt interessenten%rowtype; v_k text; v_v jsonb; v_neu jsonb := '{}'::jsonb; v_id uuid;
  v_erlaubt constant text[] := array['vorname', 'name', 'tel', 'klasse', 'notiz', 'status', 'follow_up_am'];
begin
  if _ist_demo() then raise exception 'Im Demo-Modus nicht gespeichert.'; end if;
  if not _darf_schulweit(p_school_id) then raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro'; end if;
  if jsonb_typeof(coalesce(p_felder, '{}'::jsonb)) <> 'object' then raise exception 'Ungültige Angaben'; end if;
  for v_k, v_v in select key, value from jsonb_each(coalesce(p_felder, '{}'::jsonb)) loop
    if not (v_k = any(v_erlaubt)) then raise exception 'Feld nicht änderbar: %', v_k; end if;
    if jsonb_typeof(v_v) not in ('string', 'null') then raise exception 'Ungültiger Wert für %', v_k; end if;
    if length(coalesce(v_v #>> '{}', '')) > (case when v_k = 'notiz' then 2000 else 200 end) then raise exception '% ist zu lang', v_k; end if;
    v_neu := v_neu || jsonb_build_object(v_k, nullif(btrim(coalesce(v_v #>> '{}', '')), ''));
  end loop;
  if v_neu ? 'status' and coalesce(v_neu->>'status', '') not in ('offen', 'kontaktiert', 'angemeldet', 'abgesagt') then
    raise exception 'Unbekannter Status';
  end if;
  if (v_neu->>'follow_up_am') is not null and (v_neu->>'follow_up_am') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Nächster Kontakt bitte als Datum angeben';
  end if;
  if p_owner is not null and not _ist_fahrlehrer_der_schule(p_owner, p_school_id) then
    raise exception 'Zuständig kann nur ein Fahrlehrer dieser Fahrschule sein';
  end if;

  if p_id is null then
    if p_owner is null then raise exception 'Bitte einen zuständigen Fahrlehrer wählen'; end if;
    if coalesce(v_neu->>'vorname', '') = '' and coalesce(v_neu->>'name', '') = '' then raise exception 'Bitte einen Namen angeben'; end if;
    insert into interessenten(owner, vorname, name, tel, klasse, notiz, status, follow_up_am)
    values (p_owner, v_neu->>'vorname', v_neu->>'name', v_neu->>'tel', v_neu->>'klasse', v_neu->>'notiz',
            coalesce(v_neu->>'status', 'offen'), (v_neu->>'follow_up_am')::date)
    returning id into v_id;
    return v_id;
  end if;

  select i.* into v_alt from interessenten i join profiles p on p.id = i.owner
   where i.id = p_id and p.school_id = p_school_id for update of i;
  if v_alt.id is null then raise exception 'Interessent nicht gefunden'; end if;
  update interessenten set
    owner = coalesce(p_owner, owner),
    vorname = case when v_neu ? 'vorname' then v_neu->>'vorname' else vorname end,
    name = case when v_neu ? 'name' then v_neu->>'name' else name end,
    tel = case when v_neu ? 'tel' then v_neu->>'tel' else tel end,
    klasse = case when v_neu ? 'klasse' then v_neu->>'klasse' else klasse end,
    notiz = case when v_neu ? 'notiz' then v_neu->>'notiz' else notiz end,
    status = case when v_neu ? 'status' then v_neu->>'status' else status end,
    follow_up_am = case when v_neu ? 'follow_up_am' then (v_neu->>'follow_up_am')::date else follow_up_am end,
    updated_at = now()
  where id = p_id;
  if coalesce(nullif(btrim(coalesce((select vorname from interessenten where id = p_id), '') || coalesce((select name from interessenten where id = p_id), '')), ''), '') = '' then
    raise exception 'Bitte einen Namen angeben';
  end if;
  return p_id;
end $$;
revoke all on function public.school_interessent_speichern(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.school_interessent_speichern(uuid, uuid, uuid, jsonb) to authenticated;

-- 3) Löschen (z.B. Spam-Anfragen)
create or replace function public.school_interessent_loeschen(p_school_id uuid, p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if _ist_demo() then raise exception 'Im Demo-Modus nicht gespeichert.'; end if;
  if not _darf_schulweit(p_school_id) then raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro'; end if;
  delete from interessenten i using profiles p where p.id = i.owner and i.id = p_id and p.school_id = p_school_id;
  if not found then raise exception 'Interessent nicht gefunden'; end if;
end $$;
revoke all on function public.school_interessent_loeschen(uuid, uuid) from public, anon;
grant execute on function public.school_interessent_loeschen(uuid, uuid) to authenticated;
