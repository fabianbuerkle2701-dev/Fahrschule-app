-- 2026-09-28 · Interessenten als schlankes CRM für den Inhaber (Produktplan Teil N) · v2.62.0
-- Quelle (woher kam die Anfrage) und Absagegrund (warum wurde nichts daraus) - beides speist das
-- Cockpit: "Warum sagen Anfragen ab?" entscheidet über Preis/Zeiten, "Woher kommen sie?" über
-- Werbung. Dazu Anfragen, die seit über 48 Stunden unbeantwortet sind.
alter table public.interessenten add column if not exists quelle text;
alter table public.interessenten add column if not exists absagegrund text;
do $mig$ begin
  if not exists (select 1 from pg_constraint where conname = 'interessenten_quelle_werte') then
    alter table public.interessenten add constraint interessenten_quelle_werte
      check (quelle is null or quelle in ('telefon', 'persoenlich', 'website', 'empfehlung', 'foto', 'chat', 'sonstiges'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'interessenten_absagegrund_werte') then
    alter table public.interessenten add constraint interessenten_absagegrund_werte
      check (absagegrund is null or absagegrund in ('preis', 'zeit', 'andere_fahrschule', 'meldet_sich_nicht', 'sonstiges'));
  end if;
end $mig$;

-- 1) Liste schulweit liefert beide Felder
do $mig$
declare def text; alt text := $a$'status', i.status, $a$; neu text := $n$'status', i.status, 'quelle', i.quelle, 'absagegrund', i.absagegrund, $n$;
begin
  def := pg_get_functiondef('public.school_interessenten(uuid)'::regprocedure);
  if position('absagegrund' in def) > 0 then return; end if;
  if position(alt in def) = 0 then raise exception 'Anker fehlt in school_interessenten'; end if;
  execute replace(def, alt, neu);
end $mig$;

-- 2) Speichern schulweit nimmt beide Felder an (sonst Wort für Wort wie 2026-09-28_interessenten_schulweit)
create or replace function public.school_interessent_speichern(p_school_id uuid, p_id uuid, p_owner uuid, p_felder jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_alt interessenten%rowtype; v_k text; v_v jsonb; v_neu jsonb := '{}'::jsonb; v_id uuid;
  v_erlaubt constant text[] := array['vorname', 'name', 'tel', 'klasse', 'notiz', 'status', 'follow_up_am', 'quelle', 'absagegrund'];
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
    insert into interessenten(owner, vorname, name, tel, klasse, notiz, status, follow_up_am, quelle, absagegrund)
    values (p_owner, v_neu->>'vorname', v_neu->>'name', v_neu->>'tel', v_neu->>'klasse', v_neu->>'notiz',
            coalesce(v_neu->>'status', 'offen'), (v_neu->>'follow_up_am')::date, v_neu->>'quelle',
            case when coalesce(v_neu->>'status', 'offen') = 'abgesagt' then v_neu->>'absagegrund' end)
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
    quelle = case when v_neu ? 'quelle' then v_neu->>'quelle' else quelle end,
    absagegrund = case when v_neu ? 'absagegrund' then v_neu->>'absagegrund' else absagegrund end,
    updated_at = now()
  where id = p_id;
  -- Ein Absagegrund gehört nur zu "abgesagt"
  update interessenten set absagegrund = null where id = p_id and status is distinct from 'abgesagt' and absagegrund is not null;
  if coalesce(nullif(btrim(coalesce((select vorname from interessenten where id = p_id), '') || coalesce((select name from interessenten where id = p_id), '')), ''), '') = '' then
    raise exception 'Bitte einen Namen angeben';
  end if;
  return p_id;
end $$;
revoke all on function public.school_interessent_speichern(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.school_interessent_speichern(uuid, uuid, uuid, jsonb) to authenticated;

-- 3) Cockpit: Quellen und Absagegründe (90 Tage), unbeantwortete Anfragen (> 48 h offen)
do $mig$
declare def text; alt text := $a$    'interessenten', coalesce(($a$;
  neu text := $n$    'anfrage_quellen', coalesce((
      select jsonb_object_agg(q, n) from (
        select coalesce(i.quelle, 'ohne') as q, count(*)::int as n
        from interessenten i join profiles p on p.id = i.owner
        where p.school_id = p_school_id and i.created_at >= now() - interval '90 days'
        group by 1) y), '{}'::jsonb),
    'absagegruende', coalesce((
      select jsonb_object_agg(g, n) from (
        select coalesce(i.absagegrund, 'ohne') as g, count(*)::int as n
        from interessenten i join profiles p on p.id = i.owner
        where p.school_id = p_school_id and i.status = 'abgesagt' and i.created_at >= now() - interval '90 days'
        group by 1) y), '{}'::jsonb),
    'unbeantwortet', coalesce((
      select jsonb_agg(jsonb_build_object('name', btrim(coalesce(i.vorname, '') || ' ' || coalesce(i.name, '')),
               'lehrer_id', i.owner, 'seit', i.created_at) order by i.created_at)
      from interessenten i join profiles p on p.id = i.owner
      where p.school_id = p_school_id and coalesce(i.status, 'offen') = 'offen'
        and i.created_at < now() - interval '48 hours'
        and (i.follow_up_am is null or i.follow_up_am <= (now() at time zone 'Europe/Berlin')::date)), '[]'::jsonb),
    'interessenten', coalesce(($n$;
begin
  def := pg_get_functiondef('public.school_cockpit(uuid)'::regprocedure);
  if position('unbeantwortet' in def) > 0 then return; end if;
  if position(alt in def) = 0 then raise exception 'Anker fehlt in school_cockpit'; end if;
  execute replace(def, alt, neu);
end $mig$;
