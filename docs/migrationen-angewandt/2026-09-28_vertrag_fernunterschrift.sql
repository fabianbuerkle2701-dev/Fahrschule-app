-- 2026-09-28 · Ausbildungsvertrag per Handy unterschreiben (Marktreife Stufe 2) · v2.55.0
--
-- Der Fahrlehrer schickt einen Vertrag "zum Unterschreiben in der App". Dabei legt die Fahrlehrer-App
-- am Vertrag (students.data.contracts[].fern) einen Schnappschuss des Wortlauts ab: der Schüler sieht
-- und unterschreibt genau diesen Text. Die Unterschrift landet NICHT im Vertrag selbst (den schreibt
-- die Fahrlehrer-App mit ihrem evtl. veralteten Stand zurück), sondern im schülereigenen Feld
-- data.vertragUnterschriften[<vertrags-id>] = {sig, am, via}, das students_teacher_update wie
-- wunschliste/avatarUrl immer vom Server nimmt. Die Fahrlehrer-App liest beides zusammen.

-- 1) Schüler-Übersicht liefert offene Verträge (mit fern-Schnappschuss, ohne Unterschrift)
do $mig$
declare def text; alt text := $a$'wunschliste', coalesce(v_row.data->'wunschliste','{}'::jsonb),$a$;
  neu text := $n$'wunschliste', coalesce(v_row.data->'wunschliste','{}'::jsonb),
      'vertraege', coalesce((select jsonb_agg(jsonb_build_object('id', c->>'id', 'number', c->>'number', 'date', c->>'date', 'fern', c->'fern') order by c->>'date')
         from jsonb_array_elements(case when jsonb_typeof(v_row.data->'contracts') = 'array' then v_row.data->'contracts' else '[]'::jsonb end) c
        where jsonb_typeof(c->'fern') = 'object' and coalesce(c->>'studentSignature', '') = ''
          and (v_row.data->'vertragUnterschriften'->(c->>'id')) is null), '[]'::jsonb),$n$;
begin
  def := pg_get_functiondef('public.public_student_overview(text,text,text)'::regprocedure);
  if position('''vertraege''' in def) > 0 then return; end if;
  if position(alt in def) = 0 then raise exception 'Anker fehlt in public_student_overview'; end if;
  execute replace(def, alt, neu);
end $mig$;

-- 2) Schüler unterschreibt (Name + PIN wie alle public_student_*-Funktionen)
create or replace function public.public_student_sign_contract(code text, p_name text, p_pin text, p_id text, p_sig text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_owner uuid; v_row students%rowtype; v_eff text; v_c jsonb;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return 'error'; end if;
  select * into v_row from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  order by _student_pin_matches(coalesce(nullif(s.data->>'pinCustom',''), s.data->>'pin'), p_pin) desc, s.created_at
  limit 1;
  if not found then return 'error'; end if;
  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then return 'error'; end if;
  -- Nur ein Bild der Unterschrift, mit Obergrenze (ein Pad-PNG liegt bei 5-40 KB)
  if p_sig is null or left(p_sig, 22) <> 'data:image/png;base64,' or length(p_sig) > 300000 then return 'error'; end if;
  select c into v_c from jsonb_array_elements(case when jsonb_typeof(v_row.data->'contracts') = 'array' then v_row.data->'contracts' else '[]'::jsonb end) c
   where c->>'id' = p_id limit 1;
  -- Nur Verträge, die der Fahrlehrer ausdrücklich zum Unterschreiben geschickt hat
  if v_c is null or jsonb_typeof(v_c->'fern') is distinct from 'object' then return 'error'; end if;
  if coalesce(v_c->>'studentSignature', '') <> '' then return 'schon'; end if;
  update students
     set data = jsonb_set(case when jsonb_typeof(data->'vertragUnterschriften') = 'object' then data
                               else data || '{"vertragUnterschriften":{}}'::jsonb end,
                          array['vertragUnterschriften', p_id],
                          jsonb_build_object('sig', p_sig, 'am', now()::text, 'via', 'app')),
         updated_at = now()
   where id = v_row.id and (data->'vertragUnterschriften'->p_id) is null;
  if not found then return 'schon'; end if;
  return 'ok';
end $$;
revoke all on function public.public_student_sign_contract(text, text, text, text, text) from public;
grant execute on function public.public_student_sign_contract(text, text, text, text, text) to anon, authenticated;

-- 3) Fahrlehrer-Speichern bewahrt die Schüler-Unterschriften
do $mig$
declare def text; alt text := $a$'wunschliste', v_current->'wunschliste'$a$;
  neu text := $n$'wunschliste', v_current->'wunschliste',
        'vertragUnterschriften', v_current->'vertragUnterschriften'$n$;
begin
  def := pg_get_functiondef('public.students_teacher_update(uuid,jsonb)'::regprocedure);
  if position('vertragUnterschriften' in def) > 0 then return; end if;
  if position(alt in def) = 0 then raise exception 'Anker fehlt in students_teacher_update'; end if;
  execute replace(def, alt, neu);
end $mig$;
