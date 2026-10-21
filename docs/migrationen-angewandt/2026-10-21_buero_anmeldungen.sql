-- Fabian 21.10.2026: Das Büro bestätigt Online-Anmeldungen, wenn der Fahrschul-Admin es mit einem Klick freischaltet
-- (Autopilot › Team). Bestätigen = wie activateEnrollment() der App: pending weg, bei Empfehlungscode einmalig der
-- Empfehlungsbonus (schools.referral_reward, Vorgabe 20 €) für beide. Änderungsmarken, damit die App des Fahrlehrers
-- nichts zurückschreibt. Rein additiv.

alter table public.schools add column if not exists buero_bestaetigt_anmeldungen boolean not null default false;

create or replace function public.school_anmeldung_bestaetigen(p_student_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_school uuid; v_data jsonb; v_name text; v_code text; v_anzahl int;
  v_ref_id uuid; v_ref_data jsonb; v_ref_name text; v_bonus numeric; v_mit_bonus boolean := false;
  v_tag text := to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM-DD');
begin
  if _ist_demo() then raise exception 'Im Demo-Modus wird nichts gespeichert.'; end if;
  select p.school_id, s.data into v_school, v_data from students s join profiles p on p.id = s.owner where s.id = p_student_id for update of s;
  if v_school is null then raise exception 'Diese Anmeldung gibt es nicht mehr.'; end if;
  if not (_ist_schul_admin(v_school)
          or (_ist_schul_buero(v_school) and coalesce((select buero_bestaetigt_anmeldungen from schools where id = v_school), false))) then
    raise exception 'Online-Anmeldungen bestätigt der Fahrschul-Admin – oder das Büro, wenn der Admin es freigeschaltet hat.';
  end if;
  if coalesce(v_data->>'pending', 'false') <> 'true' or coalesce(v_data->>'archived', 'false') = 'true' then
    raise exception 'Diese Anmeldung ist schon erledigt.';
  end if;
  v_name := coalesce(nullif(btrim(concat_ws(' ', nullif(btrim(v_data->>'vorname'), ''), nullif(btrim(v_data->>'name'), ''))), ''), 'Neuer Schüler');

  -- Empfehlungsbonus wie die App: nur mit Code, nur einmal, nur wenn genau ein Schüler der Fahrschule diesen Code hat
  v_code := upper(btrim(coalesce(v_data->>'referredByCode', '')));
  if v_code <> '' and coalesce(v_data->>'referralRewardApplied', 'false') <> 'true' then
    select count(*) into v_anzahl from students s join profiles p on p.id = s.owner
     where p.school_id = v_school and s.id <> p_student_id and upper(btrim(coalesce(s.data->>'referralCode', ''))) = v_code;
    if v_anzahl = 1 then
      select s.id, s.data into v_ref_id, v_ref_data from students s join profiles p on p.id = s.owner
       where p.school_id = v_school and s.id <> p_student_id and upper(btrim(coalesce(s.data->>'referralCode', ''))) = v_code
       for update of s;
      v_bonus := coalesce((select referral_reward from schools where id = v_school), 20);
      v_ref_name := coalesce(nullif(btrim(concat_ws(' ', nullif(btrim(v_ref_data->>'vorname'), ''), nullif(btrim(v_ref_data->>'name'), ''))), ''), 'Neuer Schüler');
      -- Beim Werber nur einmal je geworbenem Schüler (wie referrals[].studentId in der App)
      if not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_ref_data->'referrals') = 'array' then v_ref_data->'referrals' else '[]'::jsonb end) r
                     where r->>'studentId' = p_student_id::text) then
        v_ref_data := _schul_aenderung(_schul_aenderung(v_ref_data, 'costItems'), 'referrals');
        v_ref_data := jsonb_set(v_ref_data, '{costItems}', coalesce(case when jsonb_typeof(v_ref_data->'costItems') = 'array' then v_ref_data->'costItems' end, '[]'::jsonb)
          || jsonb_build_object('id', 'ci' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14), 'label', 'Empfehlungsbonus: ' || v_name || ' geworben', 'amount', -v_bonus));
        v_ref_data := jsonb_set(v_ref_data, '{referrals}', coalesce(case when jsonb_typeof(v_ref_data->'referrals') = 'array' then v_ref_data->'referrals' end, '[]'::jsonb)
          || jsonb_build_object('studentId', p_student_id::text, 'name', v_name, 'date', v_tag));
        update students set data = v_ref_data, updated_at = now() where id = v_ref_id;
      end if;
      v_data := _schul_aenderung(_schul_aenderung(v_data, 'costItems'), 'referralRewardApplied');
      v_data := jsonb_set(v_data, '{costItems}', coalesce(case when jsonb_typeof(v_data->'costItems') = 'array' then v_data->'costItems' end, '[]'::jsonb)
        || jsonb_build_object('id', 'ci' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14), 'label', 'Empfehlungsbonus (geworben durch ' || v_ref_name || ')', 'amount', -v_bonus));
      v_data := jsonb_set(v_data, '{referralRewardApplied}', 'true'::jsonb);
      v_mit_bonus := true;
    end if;
  end if;

  v_data := jsonb_set(_schul_aenderung(v_data, 'pending'), '{pending}', 'false'::jsonb);
  update students set data = v_data, updated_at = now() where id = p_student_id;
  return jsonb_build_object('name', v_name, 'bonus', case when v_mit_bonus then v_bonus end, 'geworben_durch', case when v_mit_bonus then v_ref_name end);
end $function$;

revoke all on function public.school_anmeldung_bestaetigen(uuid) from public, anon;
grant execute on function public.school_anmeldung_bestaetigen(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
