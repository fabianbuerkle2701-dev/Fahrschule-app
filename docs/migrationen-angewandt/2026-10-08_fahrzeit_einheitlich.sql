-- Fahrzeit einheitlich zählen (v2.112.2), angewandt 2026-10-08.
-- Anlass: viele Fahrlehrer meldeten, der UE-Zähler zeige zu viel oder zu wenig. App und Server zählten
-- nach unterschiedlichen Regeln; die Buchungsseite kannte Urlaub/Privates gar nicht (bekam nur Zeiten).
-- Regel (identisch mit zaehltAlsFahrzeit/artCounts in index.html, ohne Status):
--   kein Urlaub-/Krank-Marker (§URLAUB§), keine sonstige Tätigkeit (§SONST§), und die Terminart zählt:
--   eigene Einstellung der Fahrschule (schools.arten[].countsAsLesson) geht vor, sonst zählen
--   PRIVAT, ST, STI, VS, TH, SASF, VT nicht (wie NUR_ARBEITSZEIT_ARTEN im Arbeitszeitnachweis).

create or replace function public._termin_zaehlt(p_note text, p_art text, p_arten jsonb)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(p_note, '') not like '§URLAUB§%'
     and coalesce(p_note, '') not like '§SONST§%'
     and coalesce(
           (select (x->>'countsAsLesson')::boolean
              from jsonb_array_elements(case when jsonb_typeof(p_arten) = 'array' then p_arten else '[]'::jsonb end) x
             where x->>'code' = coalesce(nullif(p_art, ''), 'ÜST') and jsonb_typeof(x->'countsAsLesson') = 'boolean'
             limit 1),
           coalesce(nullif(p_art, ''), 'ÜST') <> all (array['PRIVAT','ST','STI','VS','TH','SASF','VT']));
$$;
revoke all on function public._termin_zaehlt(text, text, jsonb) from public, anon, authenticated;

-- Buchungsseite: zusätzlich "zaehlt" je Termin (Art/Notiz selbst bleiben verborgen)
drop function if exists public.public_busy_times(text, timestamptz, timestamptz);
create function public.public_busy_times(code text, von timestamptz, bis timestamptz)
 returns table(start_at timestamptz, end_at timestamptz, status text, zaehlt boolean)
 language sql security definer set search_path to 'public'
as $function$
  select a.start_at, a.end_at, a.status, public._termin_zaehlt(a.note, a.art, s.arten)
  from appointments a
  left join profiles p on p.id = a.owner
  left join schools s on s.id = p.school_id
  where a.owner = _owner_by_code(code)
    and a.start_at >= von
    and a.start_at < bis
  order by a.start_at;
$function$;
grant execute on function public.public_busy_times(text, timestamptz, timestamptz) to anon, authenticated;

-- Buchen/Vorschlagen: Fahrlehrer-Limits zählen nur noch, was wirklich Fahrzeit ist
do $$
declare d text;
begin
  d := pg_get_functiondef('public.public_book_or_propose_appointment(text,timestamptz,timestamptz,text,text,text,text)'::regprocedure);
  d := replace(d, 'v_ueber_limit boolean;', 'v_ueber_limit boolean; v_arten jsonb;');
  d := replace(d, $x$if v_owner is null then raise exception 'Ungültiger Code'; end if;$x$,
    $x$if v_owner is null then raise exception 'Ungültiger Code'; end if;
  select s.arten into v_arten from profiles p join schools s on s.id = p.school_id where p.id = v_owner;$x$);
  -- Sofortbuchung: Tages-/Wochenlimit
  d := replace(d, $x$where a.owner = v_owner and a.status <> 'pending'$x$,
                  $x$where a.owner = v_owner and a.status <> 'pending' and public._termin_zaehlt(a.note, a.art, v_arten)$x$);
  -- "Vorschläge über das Tageslimit" aus: offene Vorschläge zählen mit, aber nur echte Fahrzeit
  d := replace(d, $x$    where a.owner = v_owner
      and a.start_at >= v_day_start and a.start_at < v_day_start + interval '1 day';
    if v_used + v_minutes > v_teacher_day_limit then raise exception 'TEACHER_FULL';$x$,
    $x$    where a.owner = v_owner and public._termin_zaehlt(a.note, a.art, v_arten)
      and a.start_at >= v_day_start and a.start_at < v_day_start + interval '1 day';
    if v_used + v_minutes > v_teacher_day_limit then raise exception 'TEACHER_FULL';$x$);
  if position('_termin_zaehlt' in d) = 0 or position('v_arten jsonb' in d) = 0 then
    raise exception 'Ersetzung fehlgeschlagen';
  end if;
  execute d;
end $$;
