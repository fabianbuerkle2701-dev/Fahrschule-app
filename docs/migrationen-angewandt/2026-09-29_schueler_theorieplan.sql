-- 2026-09-29 · Schüler-App: kommende Theoriestunden der Fahrschule + eigene besuchte Themen · v2.65.0
-- Neue, eigene Funktion (public_student_overview bleibt unverändert). Gleiche Anmeldung wie dort:
-- Code + Name + PIN über _verify_student_login (inkl. Sperre nach Fehlversuchen).
-- Liefert NUR Zeit, Thema (appointments.ziel) und Ort (appointments.abholort) der Theoriestunden
-- (art = 'TH', bestätigt, nächste 60 Tage, höchstens 20) aller Fahrlehrer derselben Fahrschule -
-- keine Namen, keine anderen Schüler - und die Themen, bei denen DIESER Schüler eingecheckt ist.
create or replace function public.public_student_theorie(code text, p_name text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner uuid; v_row students%rowtype; v_eff text; v_school uuid; v_termine jsonb; v_besucht jsonb;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return null; end if;
  select * into v_row from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  order by _student_pin_matches(coalesce(nullif(s.data->>'pinCustom',''), s.data->>'pin'), p_pin) desc, s.created_at
  limit 1;
  if not found then return null; end if;
  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then return null; end if;
  select p.school_id into v_school from profiles p where p.id = v_owner;
  select coalesce(jsonb_agg(jsonb_build_object('start_at', x.start_at, 'end_at', x.end_at,
           'thema', nullif(btrim(coalesce(x.ziel, '')), ''), 'ort', nullif(btrim(coalesce(x.abholort, '')), '')) order by x.start_at), '[]'::jsonb)
    into v_termine
    from (select a.start_at, a.end_at, a.ziel, a.abholort from appointments a
           where a.art = 'TH' and a.status = 'confirmed'
             and a.start_at > now() and a.start_at < now() + interval '60 days'
             and (a.owner = v_owner or (v_school is not null and a.owner in (select p.id from profiles p where p.school_id = v_school)))
           order by a.start_at limit 20) x;
  select coalesce(jsonb_agg(distinct btrim(t.thema)), '[]'::jsonb) into v_besucht
    from theory_attendance t where t.student_id = v_row.id and coalesce(btrim(t.thema), '') <> '';
  return jsonb_build_object('termine', v_termine, 'besucht', v_besucht);
end;
$function$;
revoke all on function public.public_student_theorie(text, text, text) from public;
grant execute on function public.public_student_theorie(text, text, text) to anon, authenticated;
