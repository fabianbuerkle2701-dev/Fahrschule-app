-- Vorschläge über das Tageslimit (v2.106.0), angewandt 2026-10-07.
-- Fahrlehrer entscheidet in Einstellungen → Arbeit & Ausbildung, ob Schüler über sein Tageslimit
-- (z. B. 495 Min., § 12 FahrlG) hinaus Termine vorschlagen dürfen.
--  * vorschlaege_ueber_limit = true (Standard, = bisheriges Verhalten): offene Vorschläge zählen
--    nicht zum Fahrlehrer-Tageslimit; die Buchungsseite sperrt einen Tag erst, wenn die
--    bestätigten Termine das Limit erreichen.
--  * false: jeder Termin des Tages zählt (bestätigt, offen, Absage angefragt). Ein Vorschlag, der
--    den Tag über das Limit bringt, wird mit TEACHER_FULL abgelehnt.
-- Die Prüfung steht bewusst VOR der PIN-Prüfung (_verify_student_login): ein raise danach würde
-- den Fehlversuch-Zähler zurückrollen (siehe 2026-10-02 pin_bruteforce).

alter table public.profiles add column if not exists vorschlaege_ueber_limit boolean not null default true;

-- public_booking_info liefert die Einstellung an die Buchungsseite (neue Spalte → neu anlegen)
drop function if exists public.public_booking_info(text);
create function public.public_booking_info(code text)
 returns table(school_name text, subtitle text, color text, logo text, day_limit integer, week_limit integer, work_hours jsonb,
   theory_addon_active boolean, student_day_limit integer, student_week_limit integer, vorschlaege_ueber_limit boolean)
 language sql security definer set search_path to 'public'
as $function$
  select s.name, s.subtitle, s.color, s.logo,
    coalesce(p.day_limit, 0) as day_limit,
    coalesce(p.week_limit, 0) as week_limit,
    p.work_hours,
    coalesce(p.theory_addon_active, false) as theory_addon_active,
    coalesce(p.student_day_limit, 0) as student_day_limit,
    coalesce(p.student_week_limit, 0) as student_week_limit,
    coalesce(p.vorschlaege_ueber_limit, true) as vorschlaege_ueber_limit
  from profiles p
  join schools s on s.id = p.school_id
  where p.id = _owner_by_code(code);
$function$;
grant execute on function public.public_booking_info(text) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_book_or_propose_appointment(code text, p_start timestamp with time zone, p_end timestamp with time zone, p_name text, p_note text, p_pin text DEFAULT NULL::text, p_art text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_owner uuid; v_id uuid; v_end timestamptz; v_conflicts int; v_minutes int;
  v_day_limit int; v_week_limit int; v_work_hours jsonb;
  v_teacher_day_limit int; v_teacher_week_limit int; v_ueber_limit boolean;
  v_row students%rowtype; v_eff text; v_ok boolean := false;
  v_day_start timestamptz; v_week_start timestamptz; v_used int;
  v_dow int; v_daykey text; v_day jsonb;
  v_start_local text; v_end_local text;
  v_within_hours boolean := true; v_instant boolean := false;
  v_name text; v_offen int; v_offen_name int; v_konflikt_anfragen int;
  v_tz constant text := 'Europe/Berlin';
begin
  if p_art is not null and p_art not in ('ÜL','AB','NF') then
    raise exception 'INVALID_ART';
  end if;

  select p.id, coalesce(p.student_day_limit,0), coalesce(p.student_week_limit,0), p.work_hours,
         coalesce(p.day_limit,0), coalesce(p.week_limit,0), coalesce(p.vorschlaege_ueber_limit, true)
    into v_owner, v_day_limit, v_week_limit, v_work_hours, v_teacher_day_limit, v_teacher_week_limit, v_ueber_limit
  from profiles p where p.booking_code = lower(btrim(code));
  if v_owner is null then raise exception 'Ungültiger Code'; end if;

  v_name := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 80);
  if length(v_name) < 2 then raise exception 'NONAME'; end if;

  if p_start is null then raise exception 'INVALID_TIME'; end if;
  v_end := coalesce(p_end, p_start + interval '45 minutes');
  if v_end <= p_start then raise exception 'INVALID_TIME'; end if;
  -- Höchstens 240 Minuten - dieselbe Grenze wie die Bis-Auswahl im Buchungsformular (3 FS = 135
  -- Min); alles darüber ist kein Fahrstundenwunsch, sondern blockiert nur den Kalender.
  if v_end - p_start > interval '240 minutes' then raise exception 'TOOLONG'; end if;
  v_minutes := greatest(1, round(extract(epoch from (v_end - p_start)) / 60));

  perform pg_advisory_xact_lock(hashtext('book_appt:' || v_owner::text));

  if p_start < now() then raise exception 'NOPAST'; end if;

  -- Arbeitszeit gilt jetzt für JEDE Anfrage (vorher nur für die Sofortbuchung). Gleiche Regeln
  -- wie withinWorkHours() im Client: Sonntag immer gesperrt, kein Eintrag/keine Zeiten =
  -- ganztägig, blocked = Tag gesperrt, sonst nur innerhalb von/bis. Termine über Mitternacht
  -- liegen nie innerhalb einer Tages-Arbeitszeit.
  v_dow := extract(dow from p_start at time zone v_tz)::int;
  v_daykey := (array['so','mo','di','mi','do','fr','sa'])[v_dow + 1];
  if v_daykey = 'so' then
    v_within_hours := false;
  elsif (v_end at time zone v_tz)::date <> (p_start at time zone v_tz)::date then
    v_within_hours := false;
  elsif v_work_hours is not null and jsonb_typeof(v_work_hours) = 'object' then
    v_day := v_work_hours -> v_daykey;
    if v_day is not null and v_day <> 'null'::jsonb then
      if coalesce((v_day->>'blocked')::boolean, false) then
        v_within_hours := false;
      elsif nullif(v_day->>'von','') is not null and nullif(v_day->>'bis','') is not null then
        v_start_local := to_char(p_start at time zone v_tz, 'HH24:MI');
        v_end_local := to_char(v_end at time zone v_tz, 'HH24:MI');
        if v_start_local < (v_day->>'von') or v_end_local > (v_day->>'bis') then
          v_within_hours := false;
        end if;
      end if;
    end if;
  end if;
  if not v_within_hours then raise exception 'OUTSIDE_HOURS'; end if;

  -- K-H1 (Abschluss-Audit): offene Anfragen ANDERER Absender (pending, noch keinem Schüler
  -- zugeordnet) blockieren nicht mehr. Sonst konnte jemand ohne PIN mit wechselnden Namen
  -- (40 Anfragen x 240 Min. pro Tag) wochenlang jeden Slot mit OVERLAP sperren - auch für echte
  -- Schüler. Eine Anfrage ist noch kein Termin: bei zwei Anfragen auf denselben Slot entscheidet
  -- der Fahrlehrer. Eigene offene Anfragen (gleicher Name) und alle bestätigten Termine zählen
  -- weiter. Eine Sofortbuchung über eine fremde offene Anfrage hinweg wird zur normalen Anfrage
  -- (siehe v_instant unten), damit sie die ältere Anfrage nicht still überholt.
  -- 2026-09-27: jede Überlappung zählt, auch fremde offene Anfragen (Vorgabe Fabian).
  select count(*), 0
    into v_conflicts, v_konflikt_anfragen
  from appointments a
  where a.owner = v_owner and a.start_at < v_end
    and coalesce(a.end_at, a.start_at + interval '45 minutes') > p_start;
  if v_conflicts > 0 then raise exception 'OVERLAP'; end if;

  -- 2026-10-07: Fahrlehrer hat "Vorschläge über das Tageslimit zulassen" ausgeschaltet - dann
  -- zählt jeder Termin des Tages (auch offene Vorschläge) zum Limit. Vor der PIN-Prüfung, damit
  -- ein raise hier keinen Fehlversuch zurückrollt.
  if not v_ueber_limit and v_teacher_day_limit > 0 then
    v_day_start := date_trunc('day', p_start at time zone v_tz) at time zone v_tz;
    select coalesce(sum(extract(epoch from (coalesce(a.end_at, a.start_at + interval '45 minutes') - a.start_at)) / 60), 0)
      into v_used from appointments a
    where a.owner = v_owner
      and a.start_at >= v_day_start and a.start_at < v_day_start + interval '1 day';
    if v_used + v_minutes > v_teacher_day_limit then raise exception 'TEACHER_FULL'; end if;
  end if;

  select count(*), count(*) filter (where lower(trim(a.title)) = lower(v_name))
    into v_offen, v_offen_name
  from appointments a
  where a.owner = v_owner and a.student_id is null and a.status = 'pending'
    and a.created_at >= (date_trunc('day', now() at time zone v_tz) at time zone v_tz);

  -- Gleichnamige Schüler: der Schüler, dessen PIN passt, zuerst (J-Nebenbefund) - sonst hing es
  -- vom Zufall ab, welcher der beiden sich anmelden kann.
  select * into v_row from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = lower(v_name)
  order by _student_pin_matches(coalesce(nullif(s.data->>'pinCustom',''), s.data->>'pin'), p_pin) desc, s.created_at
  limit 1;

  if found then
    v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
    if v_eff is not null and v_eff <> '' and nullif(btrim(coalesce(p_pin, '')), '') is not null then
      v_ok := _verify_student_login(v_owner, v_name, v_eff, p_pin);
    end if;
  end if;

  if v_ok and coalesce(v_row.data->>'guthabenModus', 'aus') = 'deckung'
     and _open_invoiced_amount(v_row.data) > 0.005 then
    raise exception 'UNPAID';
  end if;

  if v_day_limit > 0 then
    v_day_start := date_trunc('day', p_start at time zone v_tz) at time zone v_tz;
    select coalesce(sum(extract(epoch from (coalesce(a.end_at, a.start_at + interval '45 minutes') - a.start_at)) / 60), 0)
      into v_used from appointments a
    where a.owner = v_owner
      and a.start_at >= v_day_start and a.start_at < v_day_start + interval '1 day'
      and ((a.student_id is null and a.status = 'pending' and lower(trim(a.title)) = lower(v_name))
           or (v_ok and v_row.id is not null and a.student_id::text = v_row.id::text and a.status in ('pending','confirmed')));
    if v_used + v_minutes > v_day_limit then raise exception 'DAYLIMIT'; end if;
  end if;

  if v_week_limit > 0 then
    v_week_start := date_trunc('week', p_start at time zone v_tz) at time zone v_tz;
    select coalesce(sum(extract(epoch from (coalesce(a.end_at, a.start_at + interval '45 minutes') - a.start_at)) / 60), 0)
      into v_used from appointments a
    where a.owner = v_owner
      and a.start_at >= v_week_start and a.start_at < v_week_start + interval '7 days'
      and ((a.student_id is null and a.status = 'pending' and lower(trim(a.title)) = lower(v_name))
           or (v_ok and v_row.id is not null and a.student_id::text = v_row.id::text and a.status in ('pending','confirmed')));
    if v_used + v_minutes > v_week_limit then raise exception 'WEEKLIMIT'; end if;
  end if;

  v_instant := v_ok and v_row.id is not null
    and coalesce((v_row.data->>'instantBookOptIn')::boolean, false)
    and p_art is null
    and p_start >= now() + interval '2 hours'
    and v_konflikt_anfragen = 0;

  -- Fahrlehrer-Limit in Minuten, gezählt wie in der Anzeige des Buchungslinks: alles außer
  -- offenen Anfragen. Ist es erreicht, wird aus der Sofortbuchung eine normale Anfrage.
  if v_instant and v_teacher_day_limit > 0 then
    v_day_start := date_trunc('day', p_start at time zone v_tz) at time zone v_tz;
    select coalesce(sum(extract(epoch from (coalesce(a.end_at, a.start_at + interval '45 minutes') - a.start_at)) / 60), 0)
      into v_used from appointments a
    where a.owner = v_owner and a.status <> 'pending'
      and a.start_at >= v_day_start and a.start_at < v_day_start + interval '1 day';
    if v_used + v_minutes > v_teacher_day_limit then v_instant := false; end if;
  end if;
  if v_instant and v_teacher_week_limit > 0 then
    v_week_start := date_trunc('week', p_start at time zone v_tz) at time zone v_tz;
    select coalesce(sum(extract(epoch from (coalesce(a.end_at, a.start_at + interval '45 minutes') - a.start_at)) / 60), 0)
      into v_used from appointments a
    where a.owner = v_owner and a.status <> 'pending'
      and a.start_at >= v_week_start and a.start_at < v_week_start + interval '7 days';
    if v_used + v_minutes > v_teacher_week_limit then v_instant := false; end if;
  end if;

  if v_instant then
    insert into appointments(owner, student_id, title, start_at, end_at, status, note, art)
    values (v_owner, v_row.id, v_name, p_start, v_end, 'confirmed', left(coalesce(p_note,''), 500), 'ÜST')
    returning id into v_id;
    return jsonb_build_object('id', v_id, 'status', 'confirmed');
  end if;

  -- Anfrage-Sperre pro Absender (Name) statt schulweit: 10 offene Anfragen pro Name und Tag.
  -- Die schulweite Obergrenze bleibt nur als Schutz gegen Massenanfragen OHNE PIN - per PIN
  -- angemeldete Schüler kann ein Fremder damit nicht mehr aussperren.
  if v_offen_name >= 10 then raise exception 'TOOMANY'; end if;
  if not v_ok and v_offen >= 40 then raise exception 'TOOMANY'; end if;

  insert into appointments(owner, student_id, title, start_at, end_at, status, note, art)
  values (v_owner, null, v_name, p_start, v_end, 'pending', left(coalesce(p_note,''), 500), coalesce(p_art, 'ÜST'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending');
end;
$function$;
