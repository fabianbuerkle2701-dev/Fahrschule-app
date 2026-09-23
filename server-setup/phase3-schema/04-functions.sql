-- Teil 4/N: Alle Funktionen aus public-Schema (per pg_get_functiondef exakt rekonstruiert)

CREATE OR REPLACE FUNCTION public._can_review_theory_resource(p_proposed_by uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    auth.uid() = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid
    or exists (select 1 from profiles p where p.id = auth.uid() and p.app_moderator = true)
    or exists (
      select 1 from profiles reviewer, profiles submitter
      where reviewer.id = auth.uid()
        and submitter.id = p_proposed_by
        and reviewer.school_admin = true
        and reviewer.school_id is not null
        and reviewer.school_id = submitter.school_id
    );
$function$;

CREATE OR REPLACE FUNCTION public._guard_profile_privilege_flags()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_central_admin boolean;
  is_trusted_write boolean;
  old_app_moderator boolean := false;
  old_school_admin boolean := false;
  old_school_id uuid;
  old_subscription_active boolean := false;
  old_subscription_amount numeric;
  old_theory_addon_active boolean := false;
  old_subscription_lifetime boolean := false;
  old_subscription_last_paid date;
  old_subscription_accepted_at timestamptz;
begin
  is_central_admin := (auth.uid() = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid)
    or (auth.role() = 'service_role');

  if is_central_admin then
    return new;
  end if;

  is_trusted_write := coalesce(current_setting('app.trusted_profile_write', true), '') = 'on';

  if TG_OP = 'UPDATE' then
    old_app_moderator := coalesce(old.app_moderator, false);
    old_school_admin := coalesce(old.school_admin, false);
    old_school_id := old.school_id;
    old_subscription_active := old.subscription_active;
    old_subscription_amount := old.subscription_amount;
    old_theory_addon_active := coalesce(old.theory_addon_active, false);
    old_subscription_lifetime := coalesce(old.subscription_lifetime, false);
    old_subscription_last_paid := old.subscription_last_paid;
    old_subscription_accepted_at := old.subscription_accepted_at;
  end if;

  -- school_id: auf einen NEUEN Wert nur per trusted write (join_school_by_code /
  -- create_and_assign_school / admin_set_teacher_flags setzen das Flag selbst, direkt vor
  -- ihrem eigenen Update). Die eigene Schule verlassen (NULL) bleibt immer direkt erlaubt.
  if new.school_id is distinct from old_school_id and new.school_id is not null and not is_trusted_write then
    new.school_id := old_school_id;
  end if;

  if coalesce(new.app_moderator, false) and not old_app_moderator and not is_trusted_write then
    new.app_moderator := old_app_moderator;
  end if;

  -- Selbst-Befoerderung zum Admin: frueher durchgelassen, sobald die Zielschule (noch) keinen
  -- Admin hatte (existing_admin_count = 0). Jetzt ausschliesslich per trusted write moeglich
  -- (neue Schule gruenden, oder gezielte Vergabe durch einen echten Admin) - kein Zaehl-Schlupfloch mehr.
  if coalesce(new.school_admin, false) and not old_school_admin and not is_trusted_write then
    new.school_admin := old_school_admin;
  end if;

  if new.subscription_active is distinct from old_subscription_active then
    new.subscription_active := old_subscription_active;
  end if;
  if new.subscription_amount is distinct from old_subscription_amount then
    new.subscription_amount := old_subscription_amount;
  end if;
  if coalesce(new.theory_addon_active, false) <> old_theory_addon_active then
    new.theory_addon_active := old_theory_addon_active;
  end if;
  if coalesce(new.subscription_lifetime, false) <> old_subscription_lifetime then
    new.subscription_lifetime := old_subscription_lifetime;
  end if;

  if new.subscription_last_paid is distinct from old_subscription_last_paid then
    if new.subscription_last_paid is distinct from current_date then
      new.subscription_last_paid := old_subscription_last_paid;
    end if;
  end if;
  if new.subscription_accepted_at is distinct from old_subscription_accepted_at then
    if new.subscription_accepted_at is null or abs(extract(epoch from (new.subscription_accepted_at - now()))) > 300 then
      new.subscription_accepted_at := old_subscription_accepted_at;
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public._hash_student_pins()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_pin text;
  v_custom text;
begin
  v_pin := NEW.data->>'pin';
  if v_pin is not null and v_pin <> '' and v_pin !~ '^\$2[aby]\$' then
    NEW.data := jsonb_set(NEW.data, '{pin}', to_jsonb(crypt(v_pin, gen_salt('bf'))));
  end if;

  v_custom := NEW.data->>'pinCustom';
  if v_custom is not null and v_custom <> '' and v_custom !~ '^\$2[aby]\$' then
    NEW.data := jsonb_set(NEW.data, '{pinCustom}', to_jsonb(crypt(v_custom, gen_salt('bf'))));
  end if;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public._ist_demo()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select auth.uid() = '114d1f0a-9947-459d-8009-06282799ca44'::uuid;
$function$;

CREATE OR REPLACE FUNCTION public._open_invoiced_amount(v_data jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(sum(
    greatest(0, round(
      (case when jsonb_typeof(inv->'total') = 'number' then (inv->>'total')::numeric else 0 end)
      - coalesce((
          select sum(case when jsonb_typeof(p->'amount') = 'number' then (p->>'amount')::numeric else 0 end)
          from jsonb_array_elements(coalesce(v_data->'payments', '[]'::jsonb)) p
          where p->>'invoiceId' = inv->>'id'
        ), 0)
    , 2))
  ), 0)
  from jsonb_array_elements(coalesce(v_data->'invoices', '[]'::jsonb)) inv
  where inv->>'cancelledBy' is null and inv->>'stornoOf' is null;
$function$;

CREATE OR REPLACE FUNCTION public._owner_by_code(p_code text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Groß-/Kleinschreibung und Leerzeichen tolerieren: Codes werden immer klein generiert,
  -- aber iPhone-Tastaturen schreiben Eingaben gern automatisch groß (autoCapitalize).
  select id from profiles where booking_code = lower(btrim(p_code)) limit 1;
$function$;

CREATE OR REPLACE FUNCTION public._payer_lookup_allowed(max_per_minute integer DEFAULT 20)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count int;
begin
  update public.payer_lookup_throttle
  set window_start = case when window_start < now() - interval '1 minute' then now() else window_start end,
      count = case when window_start < now() - interval '1 minute' then 1 else count + 1 end
  where id = true
  returning count into v_count;
  return v_count <= max_per_minute;
end;
$function$;

CREATE OR REPLACE FUNCTION public._verify_student_login(v_owner uuid, p_name text, stored_pin text, input_pin text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_key text;
  v_row student_login_throttle%rowtype;
  v_ok boolean;
begin
  if v_owner is null or p_name is null then
    return false;
  end if;
  v_key := v_owner::text || '|' || regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g');

  select * into v_row from student_login_throttle where throttle_key = v_key;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return false;
  end if;

  v_ok := case
    when stored_pin is null or stored_pin = '' or input_pin is null or input_pin = '' then false
    when stored_pin ~ '^\$2[aby]\$' then crypt(input_pin, stored_pin) = stored_pin
    else stored_pin = input_pin
  end;

  if v_ok then
    delete from student_login_throttle where throttle_key = v_key;
    return true;
  end if;

  if v_row.throttle_key is null then
    insert into student_login_throttle (throttle_key, fail_count, updated_at)
    values (v_key, 1, now());
  elsif v_row.updated_at < now() - interval '1 hour' then
    update student_login_throttle set fail_count = 1, locked_until = null, updated_at = now()
      where throttle_key = v_key;
  else
    update student_login_throttle
      set fail_count = v_row.fail_count + 1,
          updated_at = now(),
          locked_until = case when v_row.fail_count + 1 >= 8 then now() + interval '15 minutes' else v_row.locked_until end
      where throttle_key = v_key;
  end if;

  return false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_school_stats()
 RETURNS TABLE(school_id uuid, teachers bigint, students bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() <> '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid then
    raise exception 'Nur der zentrale App-Admin darf diese Statistik abrufen.';
  end if;
  return query
    select p.school_id, count(distinct p.id) as teachers, count(distinct s.id) as students
    from public.profiles p
    left join public.students s on s.owner = p.id
    where p.school_id is not null
    group by p.school_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_school_teachers(p_school_id uuid)
 RETURNS TABLE(id uuid, email text, display_name text, school_admin boolean, app_moderator boolean, last_seen timestamp with time zone, students bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is distinct from '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid
     and not exists (select 1 from profiles pr where pr.id = auth.uid() and pr.school_id = p_school_id and pr.school_admin = true) then
    raise exception 'Kein Zugriff auf diese Fahrschule';
  end if;
  return query
    select p.id, p.email, p.display_name, coalesce(p.school_admin, false), coalesce(p.app_moderator, false), p.last_seen,
           count(s.id) as students
    from profiles p
    left join students s on s.owner = p.id
    where p.school_id = p_school_id
    group by p.id, p.email, p.display_name, p.school_admin, p.app_moderator, p.last_seen;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_teacher_flags(p_teacher_id uuid, p_school_admin boolean, p_app_moderator boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_school uuid;
  v_target_school uuid;
  v_is_central boolean;
begin
  v_is_central := auth.uid() = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid;

  select school_id into v_target_school from profiles where id = p_teacher_id;
  if not found then
    raise exception 'Fahrlehrer nicht gefunden';
  end if;

  if not v_is_central then
    select school_id into v_caller_school from profiles
    where id = auth.uid() and school_admin = true;
    if v_caller_school is null or v_caller_school is distinct from v_target_school then
      raise exception 'Kein Zugriff: nur Fahrschul-Admin der eigenen Fahrschule';
    end if;
    -- app_moderator (schulübergreifende Rechte) bleibt exklusiv dem zentralen App-Admin
    -- vorbehalten - ein normaler Fahrschul-Admin darf es weder für sich noch für Kollegen setzen.
    if p_app_moderator is not null then
      raise exception 'Kein Zugriff: app_moderator darf nur der zentrale App-Admin setzen';
    end if;
  end if;

  perform set_config('app.trusted_profile_write', 'on', true);
  update profiles
  set school_admin = coalesce(p_school_admin, school_admin),
      app_moderator = coalesce(p_app_moderator, app_moderator)
  where id = p_teacher_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cal_book(p_code text, p_vehicle_id text, p_teacher_name text, p_start timestamp with time zone, p_end timestamp with time zone, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_school uuid;
  v_id uuid;
begin
  select id into v_school from schools where cal_code = p_code;
  if v_school is null then
    raise exception 'Unbekannter Kalender';
  end if;
  if p_end <= p_start then
    raise exception 'Endzeit muss nach der Startzeit liegen';
  end if;
  if exists (
    select 1 from bookings b
    where b.school_id = v_school
      and b.vehicle_id = p_vehicle_id
      and b.start_at < p_end
      and b.end_at > p_start
  ) then
    raise exception 'Dieses Fahrzeug ist in diesem Zeitraum schon belegt';
  end if;
  insert into bookings(school_id, vehicle_id, teacher_name, start_at, end_at, note)
  values (v_school, p_vehicle_id, p_teacher_name, p_start, p_end, nullif(p_note,''))
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cal_book_update(p_code text, p_id uuid, p_vehicle_id text, p_teacher_name text, p_start timestamp with time zone, p_end timestamp with time zone, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_school uuid;
begin
  select id into v_school from schools where cal_code = p_code;
  if v_school is null then
    raise exception 'Unbekannter Kalender';
  end if;
  if p_end <= p_start then
    raise exception 'Endzeit muss nach der Startzeit liegen';
  end if;
  if not exists (select 1 from bookings where id = p_id and school_id = v_school) then
    raise exception 'Buchung nicht gefunden';
  end if;
  if exists (
    select 1 from bookings b
    where b.school_id = v_school
      and b.vehicle_id = p_vehicle_id
      and b.id != p_id
      and b.start_at < p_end
      and b.end_at > p_start
  ) then
    raise exception 'Dieses Fahrzeug ist in diesem Zeitraum schon belegt';
  end if;
  update bookings set vehicle_id = p_vehicle_id, teacher_name = p_teacher_name,
    start_at = p_start, end_at = p_end, note = nullif(p_note,'')
  where id = p_id and school_id = v_school;
  return p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cal_bookings(p_code text, von timestamp with time zone, bis timestamp with time zone)
 RETURNS TABLE(id uuid, vehicle_id text, teacher_name text, start_at timestamp with time zone, end_at timestamp with time zone, note text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select b.id, b.vehicle_id, b.teacher_name, b.start_at, b.end_at, b.note
  from bookings b
  join schools s on s.id = b.school_id
  where s.cal_code = p_code
    and b.start_at < bis
    and b.end_at > von
  order by b.start_at;
$function$;

CREATE OR REPLACE FUNCTION public.cal_delete(p_code text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_school uuid;
begin
  select id into v_school from schools where cal_code = p_code;
  if v_school is null then
    raise exception 'Unbekannter Kalender';
  end if;
  delete from bookings where id = p_id and school_id = v_school;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cal_info(p_code text)
 RETURNS TABLE(school_name text, color text, vehicles jsonb, school_id uuid, teacher_names text[])
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- school_id wird zusätzlich zurückgegeben, damit der Client sein Realtime-Abo auf
  -- postgres_changes(bookings) mit einem filter=school_id=eq.<id> auf die eigene Fahrschule
  -- eingrenzen kann - vorher löste jede Buchungsänderung JEDER Fahrschule bei jedem offenen
  -- Fahrzeug-Kalender einen Reload aus.
  -- teacher_names: Fahrlehrer-Dropdown im Fahrzeug-Kalender als Tippfehler-Schutz statt Freitext.
  select s.name, s.color, coalesce(s.vehicles,'[]'::jsonb), s.id,
    coalesce((select array_agg(p.display_name order by p.display_name) from profiles p where p.school_id = s.id and p.display_name is not null and p.display_name <> ''), '{}'::text[])
  from schools s
  where s.cal_code = p_code;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_invoice(p_student_id uuid, p_school_id uuid, p_invoice_id text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_row          students%rowtype;
  v_invoices     jsonb;
  v_target       jsonb;
  v_idx          int;
  v_number       text;
  v_storno       jsonb;
  v_storno_items jsonb;
  v_driven       jsonb;
  v_cost         jsonb;
begin
  select * into v_row from students where id = p_student_id for update;
  if not found then
    raise exception 'Schüler nicht gefunden';
  end if;
  if not (auth.uid() = v_row.owner or (v_row.shared_with is not null and auth.uid() = any(v_row.shared_with))) then
    raise exception 'Kein Zugriff auf diesen Schüler';
  end if;

  v_invoices := coalesce(v_row.data->'invoices', '[]'::jsonb);

  select ord - 1, elem into v_idx, v_target
  from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
  where elem->>'id' = p_invoice_id;

  if v_target is null then
    raise exception 'Rechnung nicht gefunden';
  end if;
  if v_target ? 'cancelledBy' then
    raise exception 'Diese Rechnung ist bereits storniert';
  end if;
  if v_target ? 'stornoOf' then
    raise exception 'Eine Stornorechnung kann nicht noch einmal storniert werden';
  end if;

  v_number := next_document_number(p_school_id, 'invoice');

  select coalesce(jsonb_agg(jsonb_build_object(
    'label', it->>'label', 'amount', -((it->>'amount')::numeric), 'date', it->>'date'
  )), '[]'::jsonb)
  into v_storno_items
  from jsonb_array_elements(coalesce(v_target->'items', '[]'::jsonb)) it;

  -- Die Stornorechnung übernimmt bewusst den Steuerstatus DER RECHNUNG, die sie storniert (nicht
  -- den heutigen Stand der Fahrschule) - ein Storno muss steuerlich zur Originalrechnung passen.
  v_storno := jsonb_build_object(
    'id', 'inv' || replace(gen_random_uuid()::text, '-', ''),
    'number', v_number,
    'date', to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD'),
    'items', v_storno_items,
    'total', -((v_target->>'total')::numeric),
    'note', coalesce(p_reason, ''),
    'stornoOf', v_target->>'number',
    'kleinunternehmer', coalesce((v_target->>'kleinunternehmer')::boolean, false)
  );

  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_target || jsonb_build_object('cancelledBy', v_number));
  v_invoices := v_invoices || jsonb_build_array(v_storno);

  select coalesce(jsonb_agg(
    case when elem->>'invoiced' = v_target->>'number' then elem - 'invoiced' else elem end
  ), '[]'::jsonb)
  into v_driven
  from jsonb_array_elements(coalesce(v_row.data->'drivenLessons', '[]'::jsonb)) elem;

  select coalesce(jsonb_agg(
    case when elem->>'invoiced' = v_target->>'number' then elem - 'invoiced' else elem end
    order by ord
  ), '[]'::jsonb)
  into v_cost
  from jsonb_array_elements(coalesce(v_row.data->'costItems', '[]'::jsonb)) with ordinality as t(elem, ord);

  update students
  set data = jsonb_set(jsonb_set(jsonb_set(data, '{invoices}', v_invoices, true), '{drivenLessons}', v_driven, true), '{costItems}', v_cost, true),
      updated_at = now()
  where id = p_student_id;

  return v_storno;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_and_assign_school(p_name text)
 RETURNS TABLE(school_id uuid, school_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_school schools%rowtype;
begin
  if _ist_demo() then
    raise exception 'Im Demo-Modus koennen keine Fahrschulen angelegt werden.';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Bitte einen Namen für die Fahrschule angeben';
  end if;

  insert into schools (name, subtitle, color)
  values (trim(p_name), 'Klasse B', '#2B7FFF')
  returning * into v_school;

  perform set_config('app.trusted_profile_write', 'on', true);

  insert into profiles (id, school_id, email, school_admin)
  values (auth.uid(), v_school.id, (select email from auth.users where id = auth.uid()), true)
  on conflict (id) do update set school_id = v_school.id, school_admin = true;

  return query select v_school.id, v_school.name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_invoice(p_student_id uuid, p_school_id uuid, p_items jsonb, p_lesson_ids text[] DEFAULT NULL::text[], p_cost_idx integer[] DEFAULT NULL::integer[], p_note text DEFAULT ''::text, p_cost_ids text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_row      students%rowtype;
  v_number   text;
  v_total    numeric;
  v_invoice  jsonb;
  v_driven   jsonb;
  v_cost     jsonb;
  v_invoices jsonb;
  v_kunt     boolean;
  v_schon    text;
  v_per_id   boolean := p_cost_ids is not null and array_length(p_cost_ids, 1) > 0;
begin
  select * into v_row from students where id = p_student_id for update;
  if not found then
    raise exception 'Schüler nicht gefunden';
  end if;
  if not (auth.uid() = v_row.owner or (v_row.shared_with is not null and auth.uid() = any(v_row.shared_with))) then
    raise exception 'Kein Zugriff auf diesen Schüler';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Keine Rechnungsposten übergeben';
  end if;

  -- Werden ids mitgeschickt, muessen sie auch alle existieren. Fehlt eine, ist die Liste des
  -- Aufrufers veraltet - dann lieber abbrechen als den falschen Posten abrechnen.
  if v_per_id and exists (
    select 1 from unnest(p_cost_ids) cid
    where not exists (
      select 1 from jsonb_array_elements(coalesce(v_row.data->'costItems', '[]'::jsonb)) e
      where e->>'id' = cid)
  ) then
    raise exception 'Ein ausgewählter Kostenposten existiert nicht mehr. Bitte die Liste neu laden.';
  end if;

  -- Schon abgerechnete Fahrstunden?
  select string_agg(distinct elem->>'invoiced', ', ') into v_schon
  from jsonb_array_elements(coalesce(v_row.data->'drivenLessons', '[]'::jsonb)) elem
  where p_lesson_ids is not null
    and (elem->>'id') = any(p_lesson_ids)
    and nullif(elem->>'invoiced', '') is not null;

  if v_schon is null then
    -- Schon abgerechnete Kostenposten?
    select string_agg(distinct elem->>'invoiced', ', ') into v_schon
    from jsonb_array_elements(coalesce(v_row.data->'costItems', '[]'::jsonb)) with ordinality as t(elem, ord)
    where nullif(elem->>'invoiced', '') is not null
      and (case when v_per_id then (elem->>'id') = any(p_cost_ids)
                else p_cost_idx is not null and (ord - 1) = any(p_cost_idx) end);
  end if;

  if v_schon is not null then
    raise exception 'Mindestens ein Posten steht schon auf Rechnung %. Bitte die Liste neu laden - vermutlich wurde die Rechnung inzwischen an anderer Stelle erstellt.', v_schon;
  end if;

  v_number := next_document_number(p_school_id, 'invoice');

  select coalesce(sum((it->>'amount')::numeric), 0) into v_total from jsonb_array_elements(p_items) it;
  v_total := round(v_total * 100) / 100;

  -- Kleinunternehmer-Status (§19 UStG) wird HIER, zum Zeitpunkt der Rechnungsstellung, an der
  -- Rechnung selbst festgehalten - nicht erst beim Drucken/Export vom dann aktuellen Stand der
  -- Fahrschule abgelesen.
  select coalesce((invoice_settings->>'kleinunternehmer')::boolean, false) into v_kunt
  from schools where id = p_school_id;

  v_invoice := jsonb_build_object(
    'id', 'inv' || replace(gen_random_uuid()::text, '-', ''),
    'number', v_number,
    'date', to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD'),
    'items', p_items,
    'total', v_total,
    'note', coalesce(p_note, ''),
    'kleinunternehmer', coalesce(v_kunt, false)
  );

  select coalesce(jsonb_agg(
    case when p_lesson_ids is not null and (elem->>'id') = any(p_lesson_ids)
      then elem || jsonb_build_object('invoiced', v_number) else elem end
  ), '[]'::jsonb)
  into v_driven
  from jsonb_array_elements(coalesce(v_row.data->'drivenLessons', '[]'::jsonb)) elem;

  select coalesce(jsonb_agg(
    case when (case when v_per_id then (elem->>'id') = any(p_cost_ids)
                    else p_cost_idx is not null and (ord - 1) = any(p_cost_idx) end)
      then elem || jsonb_build_object('invoiced', v_number) else elem end
    order by ord
  ), '[]'::jsonb)
  into v_cost
  from jsonb_array_elements(coalesce(v_row.data->'costItems', '[]'::jsonb)) with ordinality as t(elem, ord);

  v_invoices := coalesce(v_row.data->'invoices', '[]'::jsonb) || jsonb_build_array(v_invoice);

  update students
  set data = jsonb_set(jsonb_set(jsonb_set(data, '{drivenLessons}', v_driven, true), '{costItems}', v_cost, true), '{invoices}', v_invoices, true),
      updated_at = now()
  where id = p_student_id;

  return v_invoice;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_school_location(p_school_id uuid, p_location_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_authorized boolean;
  v_count integer;
begin
  if _ist_demo() then
    raise exception 'Im Demo-Modus ist das Loeschen deaktiviert.';
  end if;

  select (v_caller = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid or (p.school_id = p_school_id and p.school_admin = true))
    into v_authorized from profiles p where p.id = v_caller;
  if not coalesce(v_authorized, false) then
    raise exception 'Nicht berechtigt';
  end if;

  update students s
  set data = data - 'location_id'
  from profiles p
  where s.owner = p.id and p.school_id = p_school_id and s.data->>'location_id' = p_location_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  update profiles set default_location_id = null
  where school_id = p_school_id and default_location_id = p_location_id;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_widget_token()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into widget_tokens (owner) values (auth.uid())
  on conflict (owner) do nothing;

  select token into v_token from widget_tokens where owner = auth.uid();
  return v_token;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.join_school_by_code(p_code text)
 RETURNS TABLE(school_id uuid, school_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_school schools%rowtype;
begin
  if _ist_demo() then
    raise exception 'Im Demo-Modus kann die Fahrschule nicht gewechselt werden.';
  end if;

  if auth.uid() is null then
    raise exception 'Ungültiger Einladungscode';
  end if;

  select * into v_school from schools s where s.invite_code = p_code;
  if not found then
    raise exception 'Ungültiger Einladungscode';
  end if;

  perform set_config('app.trusted_profile_write', 'on', true);

  insert into profiles (id, school_id, email)
  values (auth.uid(), v_school.id, (select email from auth.users u where u.id = auth.uid()))
  on conflict (id) do update
    set school_id = v_school.id,
        school_admin = case
          when profiles.school_id is distinct from v_school.id then false
          else profiles.school_admin
        end;

  update videos v set school_id = v_school.id where v.owner = auth.uid() and v.school_id is null;

  return query select v_school.id, v_school.name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.jsonb_object_keys_count(j jsonb)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select count(*)::int from jsonb_object_keys(coalesce(j, '{}'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.my_school_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select school_id from public.profiles where id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.next_document_number(p_school_id uuid, p_kind text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_year int := extract(year from (now() at time zone 'Europe/Berlin'))::int;
  v_seq int;
  v_prefix text;
begin
  -- Ohne diese Sperre haette die Demo den echten Belegnummern-Zaehler der Demo-Fahrschule
  -- dauerhaft hochgezaehlt - jede Vorschau haette eine Nummer verbrannt.
  if _ist_demo() then
    raise exception 'Im Demo-Modus werden keine Belegnummern vergeben.';
  end if;

  if not exists (
    select 1 from profiles where id = auth.uid() and school_id = p_school_id
  ) then
    raise exception 'Kein Zugriff auf diese Fahrschule';
  end if;

  if p_kind not in ('invoice','receipt','contract') then
    raise exception 'Ungültige Belegart: %', p_kind;
  end if;

  insert into document_counters as dc (school_id, kind, year, next_seq)
  values (p_school_id, p_kind, v_year, 2)
  on conflict (school_id, kind, year)
  do update set next_seq = dc.next_seq + 1
  returning next_seq - 1 into v_seq;

  v_prefix := case p_kind
    when 'invoice' then 'RE'
    when 'receipt' then 'Q'
    when 'contract' then 'V'
  end;

  return v_prefix || '-' || v_year || '-' || lpad(v_seq::text, 4, '0');
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_appointment_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event text;
  v_secret text;
begin
  if TG_OP = 'INSERT' and NEW.status = 'pending' then
    v_event := 'new_request';
  elsif TG_OP = 'UPDATE' and NEW.status = 'cancel_requested' and OLD.status is distinct from NEW.status then
    v_event := 'cancel_requested';
  elsif TG_OP = 'UPDATE' and NEW.status = 'confirmed' and OLD.status = 'offered' then
    v_event := 'offer_claimed';
  else
    return NEW;
  end if;

  -- Ab hier gilt fuer diesen Termin: "eine Push-Benachrichtigung steht noch aus", bis die
  -- Netlify-Function nach erfolgreichem Versand push_pending_since wieder auf null setzt.
  update appointments set push_pending_since = now() where id = NEW.id;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_cron_secret';
  if v_secret is null then
    raise warning 'notify_appointment_push: push_cron_secret fehlt in Vault, Push fuer Termin % (%) uebersprungen', NEW.id, v_event;
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://allindrive.netlify.app/.netlify/functions/appointment-push-trigger',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('event', v_event, 'appointment_id', NEW.id, 'owner', NEW.owner)
  );

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_delete_students_with_invoices()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count int := jsonb_array_length(coalesce(OLD.data->'invoices', '[]'::jsonb));
  v_name text := trim(coalesce(OLD.data->>'vorname','') || ' ' || coalesce(OLD.data->>'name',''));
begin
  if v_count > 0 then
    raise exception 'Schüler "%" kann nicht gelöscht werden: % Rechnung(en) vorhanden. Bitte stattdessen archivieren.', v_name, v_count
      using errcode = 'P0001';
  end if;
  return OLD;
end;
$function$;

CREATE OR REPLACE FUNCTION public.profile_email_by_id(p_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select email from public.profiles where id = p_id
$function$;

CREATE OR REPLACE FUNCTION public.profile_id_by_email(p_email text)
 RETURNS TABLE(id uuid, email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.email from public.profiles p
  where p.email = lower(trim(p_email))
  limit 1
$function$;

CREATE OR REPLACE FUNCTION public.public_book_or_propose_appointment(code text, p_start timestamp with time zone, p_end timestamp with time zone, p_name text, p_note text, p_pin text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_owner uuid; v_id uuid; v_end timestamptz; v_conflicts int; v_minutes int;
  v_day_limit int; v_week_limit int; v_work_hours jsonb;
  v_row students%rowtype; v_eff text; v_ok boolean := false;
  v_day_start timestamptz; v_week_start timestamptz; v_used int;
  v_dow int; v_daykey text; v_day jsonb;
  v_start_local text; v_end_local text;
  v_within_hours boolean := true; v_instant boolean := false;
  v_name text; v_offen int;
begin
  select p.id, coalesce(p.student_day_limit,0), coalesce(p.student_week_limit,0), p.work_hours
    into v_owner, v_day_limit, v_week_limit, v_work_hours
  from profiles p where p.booking_code = lower(btrim(code));
  if v_owner is null then raise exception 'Ungültiger Code'; end if;

  v_name := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 80);
  if length(v_name) < 2 then raise exception 'NONAME'; end if;

  perform pg_advisory_xact_lock(hashtext('book_appt:' || v_owner::text));

  if p_start < now() then raise exception 'NOPAST'; end if;

  v_end := coalesce(p_end, p_start + interval '45 minutes');
  v_minutes := greatest(1, round(extract(epoch from (v_end - p_start)) / 60));

  select count(*) into v_conflicts from appointments a
  where a.owner = v_owner and a.start_at < v_end
    and coalesce(a.end_at, a.start_at + interval '45 minutes') > p_start;
  if v_conflicts > 0 then raise exception 'OVERLAP'; end if;

  select count(*) into v_offen from appointments a
  where a.owner = v_owner and a.student_id is null and a.status = 'pending'
    and a.created_at >= date_trunc('day', now());

  select * into v_row from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = lower(v_name)
  limit 1;

  if found then
    v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
    if v_eff is not null and v_eff <> '' then
      v_ok := _verify_student_login(v_owner, v_name, v_eff, p_pin);
    end if;
  end if;

  -- Nur fuer tatsaechlich verifizierte Aufrufer geprueft (v_ok = korrekte PIN bestaetigt) -
  -- sonst waere das ein Orakel, das ohne PIN verraet, ob ein Name existiert und eine offene
  -- Rechnung hat. Der echte Kontoinhaber sieht die Meldung weiterhin unveraendert.
  if v_ok and coalesce(v_row.data->>'guthabenModus', 'aus') = 'deckung'
     and _open_invoiced_amount(v_row.data) > 0.005 then
    raise exception 'UNPAID';
  end if;

  if v_day_limit > 0 then
    v_day_start := date_trunc('day', p_start);
    select coalesce(sum(extract(epoch from (coalesce(a.end_at, a.start_at + interval '45 minutes') - a.start_at)) / 60), 0)
      into v_used from appointments a
    where a.owner = v_owner
      and a.start_at >= v_day_start and a.start_at < v_day_start + interval '1 day'
      and ((a.student_id is null and a.status = 'pending' and lower(trim(a.title)) = lower(v_name))
           or (v_ok and v_row.id is not null and a.student_id::text = v_row.id::text and a.status in ('pending','confirmed')));
    if v_used + v_minutes > v_day_limit then raise exception 'DAYLIMIT'; end if;
  end if;

  if v_week_limit > 0 then
    v_week_start := date_trunc('week', p_start);
    select coalesce(sum(extract(epoch from (coalesce(a.end_at, a.start_at + interval '45 minutes') - a.start_at)) / 60), 0)
      into v_used from appointments a
    where a.owner = v_owner
      and a.start_at >= v_week_start and a.start_at < v_week_start + interval '7 days'
      and ((a.student_id is null and a.status = 'pending' and lower(trim(a.title)) = lower(v_name))
           or (v_ok and v_row.id is not null and a.student_id::text = v_row.id::text and a.status in ('pending','confirmed')));
    if v_used + v_minutes > v_week_limit then raise exception 'WEEKLIMIT'; end if;
  end if;

  if v_work_hours is not null and jsonb_typeof(v_work_hours) = 'object' then
    v_dow := extract(dow from p_start at time zone 'Europe/Berlin')::int;
    v_daykey := (array['so','mo','di','mi','do','fr','sa'])[v_dow + 1];
    if v_daykey = 'so' then
      v_within_hours := false;
    else
      v_day := v_work_hours -> v_daykey;
      if v_day is not null and v_day <> 'null'::jsonb then
        if coalesce((v_day->>'blocked')::boolean, false) then
          v_within_hours := false;
        elsif v_day->>'von' is not null and v_day->>'bis' is not null then
          v_start_local := to_char(p_start at time zone 'Europe/Berlin', 'HH24:MI');
          v_end_local := to_char(v_end at time zone 'Europe/Berlin', 'HH24:MI');
          if v_start_local < (v_day->>'von') or v_end_local > (v_day->>'bis') then
            v_within_hours := false;
          end if;
        end if;
      end if;
    end if;
  end if;

  v_instant := v_ok and v_row.id is not null
    and coalesce((v_row.data->>'instantBookOptIn')::boolean, false)
    and v_within_hours;

  if v_instant then
    insert into appointments(owner, student_id, title, start_at, end_at, status, note, art)
    values (v_owner, v_row.id, v_name, p_start, v_end, 'confirmed', left(coalesce(p_note,''), 500), 'ÜST')
    returning id into v_id;
    return jsonb_build_object('id', v_id, 'status', 'confirmed');
  end if;

  if v_offen >= 40 then raise exception 'TOOMANY'; end if;

  insert into appointments(owner, student_id, title, start_at, end_at, status, note)
  values (v_owner, null, v_name, p_start, v_end, 'pending', left(coalesce(p_note,''), 500))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending');
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_booking_info(code text)
 RETURNS TABLE(school_name text, subtitle text, color text, logo text, day_limit integer, week_limit integer, work_hours jsonb, theory_addon_active boolean, student_day_limit integer, student_week_limit integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.name, s.subtitle, s.color, s.logo,
    coalesce(p.day_limit, 0) as day_limit,
    coalesce(p.week_limit, 0) as week_limit,
    p.work_hours,
    coalesce(p.theory_addon_active, false) as theory_addon_active,
    coalesce(p.student_day_limit, 0) as student_day_limit,
    coalesce(p.student_week_limit, 0) as student_week_limit
  from profiles p
  join schools s on s.id = p.school_id
  where p.booking_code = code;
$function$;

-- Fund 23.9.2026: verglich den Code bisher direkt (case-sensitiv, ohne Trim) statt ueber die
-- dafuer vorgesehene _owner_by_code() zu gehen, die Gross-/Kleinschreibung und Leerzeichen bewusst
-- toleriert (iPhone-Autocapitalize). Jede andere Buchungslink-Funktion nutzte das schon - diese
-- eine wich ab und lieferte bei abweichender Schreibweise kommentarlos 0 Zeilen statt eines
-- Fehlers, was auf der Buchungsseite wie "nichts belegt" aussah.
CREATE OR REPLACE FUNCTION public.public_busy_times(code text, von timestamp with time zone, bis timestamp with time zone)
 RETURNS TABLE(start_at timestamp with time zone, end_at timestamp with time zone, status text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.start_at, a.end_at, a.status
  from appointments a
  where a.owner = _owner_by_code(code)
    and a.start_at >= von
    and a.start_at < bis
    and a.status in ('confirmed','pending')
  order by a.start_at;
$function$;

CREATE OR REPLACE FUNCTION public.public_chat_facts(code text)
 RETURNS TABLE(school_name text, subtitle text, city text, price_hour numeric, packages jsonb, klassen jsonb, arten jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.name, s.subtitle,
    nullif(btrim(p.city), ''),
    s.price_hour,
    coalesce(s.packages, '[]'::jsonb),
    coalesce(s.klassen, '[]'::jsonb),
    coalesce(s.arten, '[]'::jsonb)
  from profiles p
  join schools s on s.id = p.school_id
  where p.booking_code = lower(btrim(code));
$function$;

-- p_feature schluesselt den Tages-Zaehler zusaetzlich pro Feature (booking-chat,
-- explain-theory-question, morning-briefing...), damit intensive Nutzung EINES Features
-- nicht das Tageslimit der ANDEREN fuer denselben Buchungscode mit aufbraucht - vorher
-- teilten sich alle Aufrufer denselben (booking_code, day)-Zaehler.
CREATE OR REPLACE FUNCTION public.public_chat_rate_limit(code text, max_per_day integer DEFAULT 40, p_feature text DEFAULT 'default')
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_count int;
  v_code text;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then
    return false;
  end if;
  v_code := lower(btrim(code));

  insert into public.public_chat_usage (booking_code, day, feature, count)
  values (v_code, current_date, p_feature, 1)
  on conflict (booking_code, day, feature) do update set count = public_chat_usage.count + 1
  returning count into v_count;

  return v_count <= max_per_day;
end;
$function$;

-- Kompromiss statt vollem Abo-Gate (Fabian, 23.9.2026): alle KI-Functions teilen sich ein
-- gemeinsames Tageskontingent pro Konto, damit die Registrierung offen bleiben kann, ohne dass
-- ein einzelnes Konto unbegrenzt Anthropic-Kosten verursachen kann. Gleiche Bauart wie
-- public_chat_rate_limit() oben, nur ueber auth.uid() statt booking_code - kein p_uid-Parameter,
-- damit niemand das Kontingent eines fremden Kontos abfragen oder aufbrauchen kann. Aufgerufen
-- von netlify/functions/lib/ki-guard.js.
CREATE OR REPLACE FUNCTION public.ki_rate_limit(max_per_day integer DEFAULT 150, p_feature text DEFAULT 'default')
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    return false;
  end if;

  insert into public.ki_usage (uid, day, feature, count)
  values (v_uid, current_date, p_feature, 1)
  on conflict (uid, day, feature) do update set count = ki_usage.count + 1
  returning count into v_count;

  return v_count <= max_per_day;
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_claim_appointment_offer(code text, p_name text, p_pin text, p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_row students%rowtype;
  v_eff text;
  v_klasse text;
  v_appt appointments%rowtype;
  v_conflict int;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return 'error'; end if;

  select * into v_row from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then return 'error'; end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then
    return 'error';
  end if;

  v_klasse := coalesce(nullif(v_row.data->>'klasse',''), 'B');

  select * into v_appt from appointments
  where id = p_id and owner = v_owner and status = 'offered'
  limit 1;
  if not found then return 'taken'; end if;

  if v_appt.offer_klasse is distinct from v_klasse then
    return 'error';
  end if;

  select count(*) into v_conflict from appointments a
  where a.owner = v_owner and a.student_id = v_row.id::text
    and coalesce(a.status,'') in ('pending','confirmed')
    and a.start_at < v_appt.end_at and a.end_at > v_appt.start_at;
  if v_conflict > 0 then
    return 'conflict';
  end if;

  update appointments
  set student_id = v_row.id::text, status = 'confirmed', offer_klasse = null, offered_at = null
  where id = p_id and status = 'offered';

  if not found then
    return 'taken';
  end if;

  return 'ok';
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_enroll_student(code text, p_vorname text, p_name text, p_tel text, p_geb text, p_referral_code text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_new_id uuid;
  v_code text;
  v_count int;
  v_vorname text;
  v_name text;
  v_tel text;
  v_bestehend uuid;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then
    raise exception 'Ungültiger Anmeldelink';
  end if;

  if v_owner = '114d1f0a-9947-459d-8009-06282799ca44'::uuid then
    raise exception 'Das ist die Demo-Fahrschule. Für eine echte Anmeldung brauchst du den Link deiner eigenen Fahrschule.';
  end if;

  -- Laengen begrenzen, bevor irgendetwas gespeichert wird.
  v_vorname := left(btrim(coalesce(p_vorname, '')), 80);
  v_name    := left(btrim(coalesce(p_name, '')), 80);
  v_tel     := left(btrim(coalesce(p_tel, '')), 40);

  if v_vorname = '' or v_name = '' then
    raise exception 'Bitte Vor- und Nachname angeben';
  end if;

  -- Dieselbe Person innerhalb von 24 Stunden: bestehenden Datensatz zurueckgeben.
  -- Verglichen wird ohne Ruecksicht auf Gross-/Kleinschreibung und Mehrfach-Leerzeichen,
  -- und nur solange die Anmeldung noch nicht vom Fahrlehrer uebernommen wurde (pending).
  select s.id into v_bestehend
  from students s
  where s.owner = v_owner
    and coalesce(s.data->>'pending','false') = 'true'
    and s.created_at > now() - interval '24 hours'
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
        = regexp_replace(lower(v_vorname || ' ' || v_name), '\s+', ' ', 'g')
    and regexp_replace(coalesce(s.data->>'tel',''), '\D', '', 'g') = regexp_replace(v_tel, '\D', '', 'g')
  order by s.created_at desc
  limit 1;

  if v_bestehend is not null then
    return v_bestehend::text;
  end if;

  v_code := lower(btrim(code));
  insert into public.public_enroll_usage (booking_code, day, count)
  values (v_code, current_date, 1)
  on conflict (booking_code, day) do update set count = public_enroll_usage.count + 1
  returning count into v_count;

  if v_count > 25 then
    raise exception 'Für heute sind über diesen Link schon sehr viele Anmeldungen eingegangen. Bitte melde dich morgen erneut an oder ruf deine Fahrschule direkt an.';
  end if;

  insert into students (owner, data)
  values (
    v_owner,
    jsonb_build_object(
      'vorname', v_vorname,
      'name', v_name,
      'tel', v_tel,
      'geb', left(coalesce(btrim(p_geb), ''), 20),
      'pending', true,
      'referredByCode', nullif(upper(left(btrim(coalesce(p_referral_code, '')), 40)), ''),
      'enrolledAt', to_char(now(), 'YYYY-MM-DD')
    )
  )
  returning id into v_new_id;

  return v_new_id::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_lesson_reflection_submit(code text, p_name text, p_pin text, p_lesson_id text, p_ratings jsonb, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_owner uuid;
  v_row students%rowtype;
  v_eff text;
  v_lesson jsonb;
  v_id uuid;
begin
  select p.id into v_owner from profiles p where p.booking_code = lower(btrim(code));
  if v_owner is null then
    raise exception 'error';
  end if;

  select * into v_row from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then
    raise exception 'error';
  end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if v_eff is null or v_eff = '' or not _verify_student_login(v_owner, p_name, v_eff, p_pin) then
    raise exception 'error';
  end if;

  select l into v_lesson from jsonb_array_elements(coalesce(v_row.data->'lessons', '[]'::jsonb)) l where l->>'id' = p_lesson_id limit 1;
  if v_lesson is null then
    raise exception 'NOLESSON';
  end if;

  if p_ratings is not null then
    perform 1 from jsonb_each_text(p_ratings) e
      where e.key not in ('verkehr','position','tempo','komm','bedien') or e.value !~ '^[123]$';
    if found then
      raise exception 'BADRATING';
    end if;
  end if;

  insert into lesson_reflections(owner, student_id, lesson_id, ratings, note)
  values (v_owner, v_row.id, p_lesson_id, coalesce(p_ratings, '{}'::jsonb), nullif(trim(coalesce(p_note,'')), ''))
  on conflict (student_id, lesson_id) do nothing
  returning id into v_id;

  return jsonb_build_object('ok', true, 'already', v_id is null);
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_my_slots(code text, p_name text, von timestamp with time zone, bis timestamp with time zone, p_pin text DEFAULT NULL::text)
 RETURNS TABLE(start_at timestamp with time zone, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_row students%rowtype;
  v_eff text;
  v_ok boolean := false;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null or p_name is null or length(trim(p_name)) = 0 then
    return;
  end if;

  select * into v_row
  from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;

  if found then
    v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
    if v_eff is not null and v_eff <> '' then
      v_ok := _verify_student_login(v_owner, p_name, v_eff, p_pin);
    end if;
  end if;

  return query
  select a.start_at, a.status
  from appointments a
  where a.owner = v_owner
    and a.start_at >= von
    and a.start_at < bis
    and (
      (a.student_id is null and a.status = 'pending' and lower(trim(a.title)) = lower(trim(p_name)))
      or (v_ok and v_row.id is not null and a.student_id::text = v_row.id::text)
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_payer_overview(p_code text)
 RETURNS TABLE(vorname text, name text, invoices jsonb, payments jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row students%rowtype;
begin
  if p_code is null or length(p_code) < 8 then
    return; -- kurze/leere Codes gar nicht erst gegen die Tabelle pruefen
  end if;

  -- Globale Ratenbegrenzung zuerst: bei Ueberschreitung exakt dasselbe leere Ergebnis wie bei
  -- einem falschen Code, damit kein neues Unterscheidungsmerkmal entsteht.
  if not public._payer_lookup_allowed() then
    return;
  end if;

  select * into v_row from students s where s.data->>'payerCode' = p_code limit 1;
  if not found then
    return;
  end if;

  return query
  select
    v_row.data->>'vorname',
    v_row.data->>'name',
    coalesce((
      select jsonb_agg(elem)
      from jsonb_array_elements(coalesce(v_row.data->'invoices', '[]'::jsonb)) elem
      where (elem->>'cancelledBy') is null and (elem->>'stornoOf') is null
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', p->>'date', 'amount', p->'amount', 'invoiceId', p->>'invoiceId'))
      from jsonb_array_elements(coalesce(v_row.data->'payments','[]'::jsonb)) p
    ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_propose_appointment(code text, p_start timestamp with time zone, p_end timestamp with time zone, p_name text, p_note text, p_pin text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid; v_id uuid; v_end timestamptz; v_conflicts int; v_minutes int;
  v_day_limit int; v_week_limit int;
  v_row students%rowtype; v_eff text; v_ok boolean := false;
  v_day_start timestamptz; v_week_start timestamptz; v_used int;
  v_name text; v_offen int;
begin
  select p.id, coalesce(p.student_day_limit,0), coalesce(p.student_week_limit,0)
    into v_owner, v_day_limit, v_week_limit
  from profiles p where p.booking_code = lower(btrim(code));
  if v_owner is null then raise exception 'Ungültiger Code'; end if;

  v_name := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 80);
  if length(v_name) < 2 then raise exception 'NONAME'; end if;

  if p_start < now() then raise exception 'NOPAST'; end if;

  v_end := coalesce(p_end, p_start + interval '45 minutes');
  v_minutes := greatest(1, round(extract(epoch from (v_end - p_start)) / 60));

  select count(*) into v_conflicts from appointments a
  where a.owner = v_owner and a.start_at < v_end
    and coalesce(a.end_at, a.start_at + interval '45 minutes') > p_start;
  if v_conflicts > 0 then raise exception 'OVERLAP'; end if;

  select count(*) into v_offen from appointments a
  where a.owner = v_owner and a.student_id is null and a.status = 'pending'
    and a.created_at >= date_trunc('day', now());
  if v_offen >= 40 then raise exception 'TOOMANY'; end if;

  select * into v_row from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = lower(v_name)
  limit 1;

  if found then
    v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
    if v_eff is not null and v_eff <> '' then
      v_ok := _verify_student_login(v_owner, v_name, v_eff, p_pin);
    end if;
  end if;

  if v_ok and coalesce(v_row.data->>'guthabenModus', 'aus') = 'deckung'
     and _open_invoiced_amount(v_row.data) > 0.005 then
    raise exception 'UNPAID';
  end if;

  if v_day_limit > 0 or v_week_limit > 0 then
    if v_day_limit > 0 then
      v_day_start := date_trunc('day', p_start);
      select coalesce(sum(extract(epoch from (coalesce(a.end_at, a.start_at + interval '45 minutes') - a.start_at)) / 60), 0)
        into v_used from appointments a
      where a.owner = v_owner
        and a.start_at >= v_day_start and a.start_at < v_day_start + interval '1 day'
        and ((a.student_id is null and a.status = 'pending' and lower(trim(a.title)) = lower(v_name))
             or (v_ok and v_row.id is not null and a.student_id::text = v_row.id::text and a.status in ('pending','confirmed')));
      if v_used + v_minutes > v_day_limit then raise exception 'DAYLIMIT'; end if;
    end if;

    if v_week_limit > 0 then
      v_week_start := date_trunc('week', p_start);
      select coalesce(sum(extract(epoch from (coalesce(a.end_at, a.start_at + interval '45 minutes') - a.start_at)) / 60), 0)
        into v_used from appointments a
      where a.owner = v_owner
        and a.start_at >= v_week_start and a.start_at < v_week_start + interval '7 days'
        and ((a.student_id is null and a.status = 'pending' and lower(trim(a.title)) = lower(v_name))
             or (v_ok and v_row.id is not null and a.student_id::text = v_row.id::text and a.status in ('pending','confirmed')));
      if v_used + v_minutes > v_week_limit then raise exception 'WEEKLIMIT'; end if;
    end if;
  end if;

  insert into appointments(owner, student_id, title, start_at, end_at, status, note)
  values (v_owner, null, v_name, p_start, v_end, 'pending', left(coalesce(p_note,''), 500))
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_student_cancel_appt(code text, p_name text, p_pin text, p_appt uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_row   students%rowtype;
  v_eff   text;
  v_appt  appointments%rowtype;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return 'error'; end if;

  select * into v_row
  from students s
  where s.owner = v_owner
    and lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))) = lower(btrim(p_name))
  limit 1;
  if not found then return 'error'; end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then
    return 'error';
  end if;

  select * into v_appt from appointments a where a.id = p_appt and a.owner = v_owner;
  if not found then return 'error'; end if;

  if v_appt.student_id is null or v_appt.student_id::text <> v_row.id::text then return 'error'; end if;

  if v_appt.status = 'pending' then
    delete from appointments where id = p_appt;
    return 'deleted';
  else
    update appointments set status = 'cancel_requested' where id = p_appt;
    return 'requested';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_student_drive_delete(code text, p_name text, p_pin text, p_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_row   students%rowtype;
  v_eff   text;
  v_list  jsonb;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return 'error'; end if;

  select * into v_row
  from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then return 'error'; end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then
    return 'error';
  end if;

  v_list := coalesce(v_row.data->'begleitfahrten', '[]'::jsonb);
  if jsonb_typeof(v_list) <> 'array' then v_list := '[]'::jsonb; end if;

  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_list
  from jsonb_array_elements(v_list) e
  where e->>'id' is distinct from coalesce(nullif(p_id,''), '__none__');

  update students
  set data = jsonb_set(data, '{begleitfahrten}', v_list, true)
  where id = v_row.id;

  return 'ok';
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_student_drive_save(code text, p_name text, p_pin text, p_entry jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_row   students%rowtype;
  v_eff   text;
  v_list  jsonb;
  v_id    text;
  v_pts   jsonb;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return 'error'; end if;

  select * into v_row
  from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then return 'error'; end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then
    return 'error';
  end if;

  v_id := nullif(p_entry->>'id','');
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' or v_id is null then
    return 'error';
  end if;
  if length(coalesce(p_entry->>'notiz','')) > 2000 then
    return 'error';
  end if;

  -- Streckenpunkte: hoechstens 2000 (der Client liefert 1500), und der gesamte Eintrag
  -- darf 250 KB nicht ueberschreiten.
  v_pts := p_entry->'route'->'pts';
  if v_pts is not null and jsonb_typeof(v_pts) = 'array' and jsonb_array_length(v_pts) > 2000 then
    return 'error';
  end if;
  if length(p_entry::text) > 250000 then
    return 'error';
  end if;

  v_list := coalesce(v_row.data->'begleitfahrten', '[]'::jsonb);
  if jsonb_typeof(v_list) <> 'array' then v_list := '[]'::jsonb; end if;

  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_list
  from jsonb_array_elements(v_list) e
  where e->>'id' is distinct from v_id;

  -- Mit Strecken ist die alte Grenze von 2000 Fahrten zu grosszuegig: 500 Fahrten mit je
  -- 60 KB sind bereits 30 MB in einer einzigen jsonb-Spalte.
  if jsonb_array_length(v_list) >= 500 then
    return 'error';
  end if;

  update students
  set data = jsonb_set(data, '{begleitfahrten}', v_list || jsonb_build_array(p_entry), true)
  where id = v_row.id;

  return 'ok';
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_student_drive_skill(code text, p_name text, p_pin text, p_key text, p_stand text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_row   students%rowtype;
  v_eff   text;
  v_plan  jsonb;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return 'error'; end if;

  select * into v_row
  from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then return 'error'; end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then
    return 'error';
  end if;

  -- Schluessel kommen aus einer festen Liste im Client; hier reicht eine Laengen- und
  -- Zeichenpruefung, damit ueber die oeffentliche RPC nichts Beliebiges hineinwandert.
  if p_key is null or p_key !~ '^[a-z0-9_]{2,40}$' then
    return 'error';
  end if;
  if p_stand is not null and p_stand not in ('geuebt', 'sitzt', 'offen') then
    return 'error';
  end if;

  v_plan := coalesce(v_row.data->'begleitplan', '{}'::jsonb);
  if jsonb_typeof(v_plan) <> 'object' then v_plan := '{}'::jsonb; end if;

  if p_stand is null or p_stand = 'offen' then
    v_plan := v_plan - p_key;
  else
    if v_plan ? p_key or jsonb_object_keys_count(v_plan) < 200 then
      v_plan := jsonb_set(v_plan, array[p_key],
        jsonb_build_object('stand', p_stand, 'datum', to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD')), true);
    end if;
  end if;

  update students set data = jsonb_set(data, '{begleitplan}', v_plan, true) where id = v_row.id;
  return 'ok';
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_student_lessons(code text, p_name text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_row   students%rowtype;
  v_eff   text;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then
    return '[]'::jsonb;
  end if;

  select * into v_row
  from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then
    return '[]'::jsonb;
  end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'id',               l->>'id',
               'date',             l->>'date',
               'thema',            l->>'thema',
               'hinweis',          l->>'hinweis',
               'dist',             (l->'route'->>'dist'),
               'dur',              (l->'route'->>'dur'),
               'pts',              coalesce(l->'route'->'pts', '[]'::jsonb),
               'hasTeacherRatings', (l->'ratings' is not null and l->'ratings' <> '{}'::jsonb),
               'reflected',        r.id is not null,
               'myRatings',        r.ratings,
               'myNote',           r.note,
               'teacherRatings',   case when r.id is not null then l->'ratings' else null end
             )
             order by (l->>'date')
           )
    from jsonb_array_elements(coalesce(v_row.data->'lessons', '[]'::jsonb)) as l
    left join lesson_reflections r on r.student_id = v_row.id and r.lesson_id = (l->>'id')
  ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_student_overview(code text, p_name text, p_pin text)
 RETURNS TABLE(student jsonb, adk jsonb, strecken jsonb, adk_titel text, strecken_titel text, appointments jsonb, pin_ist_start boolean, location jsonb, offers jsonb, storno_frist_stunden integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid; v_row students%rowtype; v_eff text; v_start boolean; v_tpl record;
  v_school uuid; v_locid text; v_loc jsonb; v_klasse text; v_adk jsonb; v_strecken jsonb;
  v_owner_city text; v_storno_frist integer;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return; end if;
  select * into v_row from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then return; end if;
  v_eff   := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  v_start := (nullif(v_row.data->>'pinCustom','') is null);
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then return; end if;
  v_klasse := coalesce(nullif(v_row.data->>'klasse',''), 'B');
  select t.adk, t.strecken, t.adk_titel, t.strecken_titel into v_tpl from templates t where t.owner = v_owner limit 1;
  if v_tpl.adk is not null and jsonb_typeof(v_tpl.adk) = 'array' then
    v_adk := v_tpl.adk; v_strecken := coalesce(v_tpl.strecken, '[]'::jsonb);
  else
    v_adk := coalesce(v_tpl.adk -> v_klasse, '[]'::jsonb);
    v_strecken := coalesce(v_tpl.strecken -> v_klasse, '[]'::jsonb);
  end if;
  select p.school_id into v_school from profiles p where p.id = v_owner;
  v_locid := nullif(v_row.data->>'location_id','');
  if v_locid is not null and v_school is not null then
    select loc into v_loc from schools sc, jsonb_array_elements(coalesce(sc.locations,'[]'::jsonb)) loc
    where sc.id = v_school and loc->>'id' = v_locid limit 1;
  end if;
  if v_loc is null then
    select nullif(btrim(p.city), '') into v_owner_city from profiles p where p.id = v_owner;
    if v_owner_city is not null then v_loc := jsonb_build_object('city', v_owner_city); end if;
  end if;
  if v_school is not null then
    select sc.storno_frist_stunden into v_storno_frist from schools sc where sc.id = v_school;
  end if;
  return query
  select
    jsonb_build_object(
      'vorname', v_row.data->>'vorname',
      'name', v_row.data->>'name',
      'klasse', v_klasse,
      -- Ersterwerb (true) / Erweiterung (false). Leerer String und fehlendes Feld bedeuten
      -- BEIDE "keine Angabe" und damit Ersterwerb - der haeufigere Fall und die strengere
      -- Uebung. Kein ::boolean-Cast: ein leerer String wuerde damit die gesamte Anmeldung
      -- abbrechen (siehe fix_theorie_boolean_cast).
      'ersterwerb', (coalesce(nullif(v_row.data->>'ersterwerb', ''), 'true') <> 'false'),
      'items', coalesce(v_row.data->'items','{}'::jsonb),
      'strecken', coalesce(v_row.data->'strecken','{}'::jsonb),
      'adkDates', coalesce(v_row.data->'adkDates','{}'::jsonb),
      'customCounts', coalesce(v_row.data->'customCounts','{}'::jsonb),
      'referralCode', v_row.data->>'referralCode',
      'messages', coalesce(v_row.data->'messages','[]'::jsonb),
      'theorie', (coalesce(v_row.data->>'theorie','') not in ('', 'false')),
      'avatarUrl', nullif(v_row.data->>'avatarUrl', ''),
      'begleitfahrten', coalesce(v_row.data->'begleitfahrten','[]'::jsonb),
      'begleitplan', coalesce(v_row.data->'begleitplan','{}'::jsonb),
      'wunschliste', coalesce(v_row.data->'wunschliste','{}'::jsonb)
    ) as student,
    coalesce(v_adk, '[]'::jsonb), coalesce(v_strecken, '[]'::jsonb),
    coalesce(nullif(v_tpl.adk_titel, '{}'), ''), coalesce(nullif(v_tpl.strecken_titel, '{}'), ''),
    coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'start_at', a.start_at,
               'end_at', a.end_at, 'title', a.title, 'status', a.status, 'art', a.art) order by a.start_at)
      from appointments a where a.owner = v_owner and coalesce(a.status,'') <> 'cancelled'
        and a.student_id::text = v_row.id::text), '[]'::jsonb),
    v_start, v_loc,
    coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'start_at', a.start_at,
               'end_at', a.end_at, 'art', a.art) order by a.start_at)
      from appointments a where a.owner = v_owner and a.status = 'offered'
        and a.offer_klasse = v_klasse and a.start_at > now()), '[]'::jsonb),
    v_storno_frist;
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_student_payment_status(code text, p_name text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_owner uuid;
  v_row students%rowtype;
  v_eff text;
  v_offen numeric;
  v_iv jsonb;
  v_schulname text;
begin
  select p.id into v_owner from profiles p where p.booking_code = lower(btrim(code));
  if v_owner is null or p_name is null then return null; end if;

  select * into v_row from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then return null; end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if v_eff is null or v_eff = '' or not _verify_student_login(v_owner, p_name, v_eff, p_pin) then
    return null;
  end if;

  v_offen := _open_invoiced_amount(v_row.data);

  -- Empfaengerdaten fuer den Girocode nur herausgeben, wenn tatsaechlich etwas offen ist.
  -- Sie stehen zwar ohnehin auf jeder Rechnung des Schuelers, aber es gibt keinen Grund,
  -- die IBAN bei jedem Portal-Aufruf mitzuliefern.
  if v_offen > 0.005 then
    select s.invoice_settings, s.name into v_iv, v_schulname
    from profiles p join schools s on s.id = p.school_id
    where p.id = v_owner;
  end if;

  return jsonb_build_object(
    'modus',      coalesce(v_row.data->>'guthabenModus', 'aus'),
    'offen',      v_offen,
    'iban',       nullif(coalesce(v_iv->>'iban', ''), ''),
    'empfaenger', nullif(coalesce(v_iv->>'firma', v_schulname, ''), '')
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_student_send_message(code text, p_name text, p_pin text, p_text text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_row   students%rowtype;
  v_eff   text;
  v_msg   jsonb;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return 'error'; end if;

  select * into v_row
  from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then return 'error'; end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then
    return 'error';
  end if;

  if coalesce(trim(p_text), '') = '' then
    return 'error';
  end if;

  v_msg := jsonb_build_object('id', gen_random_uuid()::text, 'from', 'student', 'text', trim(p_text), 'at', now()::text);

  update students
  set data = jsonb_set(data, '{messages}', coalesce(data->'messages', '[]'::jsonb) || v_msg, true)
  where id = v_row.id;

  return 'ok';
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_student_set_avatar(code text, p_name text, p_pin text, p_avatar text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_row   students%rowtype;
  v_eff   text;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return 'error'; end if;

  select * into v_row
  from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then return 'error'; end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then
    return 'error';
  end if;

  if p_avatar is not null and length(p_avatar) > 400000 then
    return 'error';
  end if;

  update students
  set data = jsonb_set(data, '{avatarUrl}', to_jsonb(coalesce(p_avatar, '')), true)
  where id = v_row.id;

  return 'ok';
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_student_set_pin(code text, p_name text, p_old text, p_new text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_row   students%rowtype;
  v_eff   text;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return false; end if;

  select * into v_row
  from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then return false; end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_old) then
    return false;
  end if;

  if p_new is null or length(btrim(p_new)) < 4 then
    return false;
  end if;

  -- Klartext hier ist unkritisch: der trg_hash_student_pins-Trigger auf der
  -- students-Tabelle hasht data.pinCustom automatisch, bevor die Zeile
  -- tatsächlich gespeichert wird.
  update students
  set data = jsonb_set(data, '{pinCustom}', to_jsonb(btrim(p_new)))
  where id = v_row.id;

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_student_set_wunschliste(code text, p_name text, p_pin text, p_active boolean, p_weekdays jsonb, p_von text, p_bis text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_row students%rowtype;
  v_eff text;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return 'error'; end if;

  select * into v_row from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then return 'error'; end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then
    return 'error';
  end if;

  update students set data = jsonb_set(data, '{wunschliste}',
    jsonb_build_object('active', coalesce(p_active,false), 'weekdays', coalesce(p_weekdays,'[]'::jsonb),
      'von', coalesce(p_von,''), 'bis', coalesce(p_bis,''), 'updatedAt', now()::text),
    true)
  where id = v_row.id;

  return 'ok';
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_theory_answer_submit(code text, p_name text, p_pin text, p_question_id uuid, p_correct boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_row   students%rowtype;
  v_eff   text;
  v_qkey  text;
  v_alt   jsonb;
  v_box   int;
  v_tage  int;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return 'error'; end if;

  select * into v_row from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then return 'error'; end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then return 'error'; end if;
  if not exists (select 1 from theory_questions q where q.id = p_question_id and q.active = true) then
    return 'error';
  end if;

  v_qkey := p_question_id::text;
  v_alt  := coalesce(v_row.data->'theoryProgress'->v_qkey, '{}'::jsonb);

  -- Fach neu bestimmen: richtig = aufsteigen (max 5), falsch = zurueck auf 1.
  v_box := coalesce((v_alt->>'box')::int, 1);
  if p_correct then v_box := least(v_box + 1, 5); else v_box := 1; end if;
  v_tage := (array[0, 1, 3, 7, 21])[v_box];

  update students
  set data = jsonb_set(
    jsonb_set(data, '{theoryProgress}', coalesce(data->'theoryProgress', '{}'::jsonb), true),
    array['theoryProgress', v_qkey],
    v_alt || jsonb_build_object(
      'correct',  p_correct,
      'attempts', coalesce((v_alt->>'attempts')::int, 0) + 1,
      'richtig',  coalesce((v_alt->>'richtig')::int, 0) + (case when p_correct then 1 else 0 end),
      'falsch',   coalesce((v_alt->>'falsch')::int, 0) + (case when p_correct then 0 else 1 end),
      'box',      v_box,
      'due',      to_char((now() + make_interval(days => v_tage)) at time zone 'Europe/Berlin', 'YYYY-MM-DD'),
      'lastAt',   now()::text
    ), true)
  where id = v_row.id;

  return 'ok';
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_theory_checkin(code text, p_name text, p_pin text, p_checkin_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_owner uuid;
  v_row students%rowtype;
  v_eff text;
  v_ok boolean := false;
  v_appt appointments%rowtype;
  v_already boolean;
begin
  select p.id into v_owner from profiles p where p.booking_code = lower(btrim(code));
  if v_owner is null then
    raise exception 'error';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'error';
  end if;

  select * into v_row from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then
    raise exception 'error';
  end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if v_eff is null or v_eff = '' then
    raise exception 'error';
  end if;
  v_ok := _verify_student_login(v_owner, p_name, v_eff, p_pin);
  if not v_ok then
    raise exception 'error';
  end if;

  select * into v_appt from appointments a
  where a.owner = v_owner and a.checkin_code = p_checkin_code and a.checkin_expires_at > now()
  limit 1;
  if not found then
    raise exception 'EXPIRED';
  end if;

  select exists(select 1 from theory_attendance where appt_id = v_appt.id and student_id = v_row.id) into v_already;

  insert into theory_attendance(owner, appt_id, student_id, thema)
  values (v_owner, v_appt.id, v_row.id, v_appt.checkin_thema)
  on conflict (appt_id, student_id) do nothing;

  return jsonb_build_object('ok', true, 'thema', v_appt.checkin_thema, 'already', v_already);
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_theory_exam_history(code text, p_name text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_row   students%rowtype;
  v_eff   text;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return '[]'::jsonb; end if;

  select * into v_row
  from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then return '[]'::jsonb; end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then
    return '[]'::jsonb;
  end if;

  if jsonb_typeof(v_row.data->'theoryMockExams') <> 'array' then
    return '[]'::jsonb;
  end if;

  -- Nur echte Eintraege herausgeben - ein einzelner kaputter Wert darf nicht den ganzen
  -- Theoriebereich lahmlegen.
  return coalesce((
    select jsonb_agg(e order by ord)
    from jsonb_array_elements(v_row.data->'theoryMockExams') with ordinality t(e, ord)
    where jsonb_typeof(e) = 'object'
  ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_theory_exam_submit(code text, p_name text, p_pin text, p_result jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_row   students%rowtype;
  v_eff   text;
  v_bisher jsonb;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return 'error'; end if;

  select * into v_row
  from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then return 'error'; end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then
    return 'error';
  end if;

  -- NUR an eine echte Liste anhaengen. Steht dort ein JSON-null, ein Objekt oder sonst etwas,
  -- wird bei null angefangen - sonst haengt Postgres den Skalar als erstes Listenelement davor.
  if jsonb_typeof(v_row.data->'theoryMockExams') = 'array' then
    v_bisher := v_row.data->'theoryMockExams';
  else
    v_bisher := '[]'::jsonb;
  end if;

  -- Nur ein begrenztes, serverseitig geprüftes Feld-Set aus dem Client übernehmen, damit
  -- der Client nicht beliebiges JSON in die Schülerdaten schreiben kann.
  update students
  set data = jsonb_set(data, '{theoryMockExams}',
    v_bisher || jsonb_build_array(jsonb_build_object(
      'date', now()::text,
      'total', (p_result->>'total')::int,
      'errorPoints', (p_result->>'errorPoints')::int,
      'passed', (p_result->>'passed')::boolean,
      'richtig', (p_result->>'richtig')::int
    )), true)
  where id = v_row.id;

  return 'ok';
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_theory_mark_toggle(code text, p_name text, p_pin text, p_question_id uuid, p_marked boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_row   students%rowtype;
  v_eff   text;
  v_qkey  text;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return 'error'; end if;

  select * into v_row
  from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then return 'error'; end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then
    return 'error';
  end if;

  if not exists (select 1 from theory_questions q where q.id = p_question_id and q.active = true) then
    return 'error';
  end if;

  v_qkey := p_question_id::text;

  update students
  set data = jsonb_set(
    jsonb_set(data, '{theoryProgress}', coalesce(data->'theoryProgress', '{}'::jsonb), true),
    array['theoryProgress', v_qkey],
    coalesce(data->'theoryProgress'->v_qkey, '{}'::jsonb) || jsonb_build_object('marked', p_marked),
    true)
  where id = v_row.id;

  return 'ok';
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_theory_progress(code text, p_name text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_row   students%rowtype;
  v_eff   text;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return null; end if;

  select * into v_row
  from students s
  where s.owner = v_owner
    and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
  limit 1;
  if not found then return null; end if;

  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if not _verify_student_login(v_owner, p_name, v_eff, p_pin) then
    return null;
  end if;

  return coalesce(v_row.data->'theoryProgress', '{}'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_theory_questions(code text, p_klasse text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', q.id, 'topic_key', q.topic_key, 'klasse', q.klasse, 'points', q.points,
      'question', q.question, 'answer_stem', q.answer_stem,
      'image_url', q.image_url, 'options', q.options, 'explanation', q.explanation,
      'amtlich', (coalesce(q.quelle, '') = 'vkbl')
    ) order by q.topic_key, q.created_at)
    from theory_questions q
    where q.active = true
      and (q.klasse = 'ALL' or p_klasse is null or q.klasse = p_klasse)
  ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_videos(code text)
 RETURNS TABLE(id uuid, title text, category text, storage_path text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_school uuid;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return; end if;

  select p.school_id into v_school from profiles p where p.id = v_owner;

  if v_school is not null then
    return query
      select v.id, v.title, v.category, v.storage_path, v.created_at
      from videos v
      where v.school_id = v_school
      order by v.category, v.created_at desc;
  else
    return query
      select v.id, v.title, v.category, v.storage_path, v.created_at
      from videos v
      where v.owner = v_owner
      order by v.category, v.created_at desc;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.school_exam_stats(p_school_id uuid)
 RETURNS TABLE(student_id uuid, klasse text, teacher_email text, exams jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and school_id = p_school_id and school_admin = true
  ) and not exists (
    select 1 from profiles
    where id = auth.uid() and email = 'buerkle.fabian.p@web.de'
  ) then
    raise exception 'Kein Zugriff: nur Fahrschul-Admin oder zentraler Admin';
  end if;

  return query
  select
    s.id as student_id,
    coalesce(nullif(s.data->>'klasse',''), 'B') as klasse,
    p.email as teacher_email,
    coalesce(s.data->'exams', '[]'::jsonb) as exams
  from students s
  join profiles p on p.id = s.owner
  where p.school_id = p_school_id;
end;
$function$;

-- Zaehlt schulweit (ueber ALLE Fahrlehrer der Fahrschule, nicht nur den aufrufenden), wie viele
-- aktive Schueler einer bestimmten Fuehrerscheinklasse zugeordnet sind - fuer die
-- Sicherheitsabfrage beim Entfernen einer Klasse in den Einstellungen. Gleiches Zugriffs- und
-- Aggregationsmuster wie school_exam_stats()/delete_school_location().
CREATE OR REPLACE FUNCTION public.school_students_klasse_count(p_school_id uuid, p_klasse text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and school_id = p_school_id and school_admin = true
  ) and not exists (
    select 1 from profiles
    where id = auth.uid() and email = 'buerkle.fabian.p@web.de'
  ) then
    raise exception 'Kein Zugriff: nur Fahrschul-Admin oder zentraler Admin';
  end if;

  select count(*) into v_count
  from students s
  join profiles p on p.id = s.owner
  where p.school_id = p_school_id
    and coalesce(s.data->>'archived','false') != 'true'
    and s.data->>'klasse' = p_klasse;

  return coalesce(v_count, 0);
end;
$function$;

CREATE OR REPLACE FUNCTION public.school_leistungen(p_school_id uuid)
 RETURNS TABLE(leistung_id text, student_id uuid, student_name text, teacher_email text, date text, "time" text, art text, klasse text, stufe text, vehicle_name text, minutes integer, price numeric, note text, signed_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and school_id = p_school_id and school_admin = true
  ) and not exists (
    select 1 from profiles
    where id = auth.uid() and email = 'buerkle.fabian.p@web.de'
  ) then
    raise exception 'Kein Zugriff: nur Fahrschul-Admin oder zentraler Admin';
  end if;

  return query
  select
    l->>'id'                                              as leistung_id,
    s.id                                                  as student_id,
    regexp_replace(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name','')), '\s+', ' ', 'g') as student_name,
    p.email                                               as teacher_email,
    l->>'date'                                            as "date",
    l->>'time'                                            as "time",
    l->>'art'                                             as art,
    nullif(l->>'klasse','')                               as klasse,
    nullif(l->>'stufe','')                                as stufe,
    nullif(l->>'vehicleName','')                          as vehicle_name,
    nullif(l->>'minutes','')::integer                     as minutes,
    -- price steht im Datensatz PRO Unterrichtseinheit (45 Minuten), wie bei allen anderen
    -- Fahrtenbucheintraegen. Das Modal zeigt einen einzelnen Betrag je Leistung, und der
    -- Fahrlehrer hat im Formular den GESAMTpreis eingegeben - deshalb hier zurueckrechnen,
    -- sonst stuende bei einer Doppelstunde die Haelfte des tatsaechlichen Betrags.
    case
      when nullif(l->>'price','') is null then null
      else round((l->>'price')::numeric * (coalesce(nullif(l->>'minutes','')::numeric, 45) / 45.0), 2)
    end                                                   as price,
    nullif(l->>'note','')                                 as note,
    nullif(l->>'signedAt','')::timestamptz                as signed_at
  from students s
  join profiles p on p.id = s.owner
  cross join lateral jsonb_array_elements(coalesce(s.data->'drivenLessons','[]'::jsonb)) l
  where p.school_id = p_school_id
    and coalesce(l->>'leistung','false') = 'true'
    and nullif(l->>'signedAt','') is not null
  order by nullif(l->>'signedAt','')::timestamptz desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.school_offene_posten(p_school_id uuid)
 RETURNS TABLE(student_id uuid, student_name text, student_tel text, teacher_email text, driven_lessons jsonb, cost_items jsonb, payments jsonb, packages jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and school_id = p_school_id and school_admin = true
  ) and not exists (
    select 1 from profiles
    where id = auth.uid() and email = 'buerkle.fabian.p@web.de'
  ) then
    raise exception 'Kein Zugriff: nur Fahrschul-Admin oder zentraler Admin';
  end if;

  return query
  select
    s.id as student_id,
    coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name','') as student_name,
    s.data->>'tel' as student_tel,
    p.email as teacher_email,
    coalesce(s.data->'drivenLessons','[]'::jsonb) as driven_lessons,
    coalesce(s.data->'costItems','[]'::jsonb)     as cost_items,
    coalesce(s.data->'payments','[]'::jsonb)      as payments,
    coalesce(s.data->'packages','[]'::jsonb)      as packages
  from students s
  join profiles p on p.id = s.owner
  where p.school_id = p_school_id
    and coalesce(s.data->>'archived','false') != 'true';
end;
$function$;

CREATE OR REPLACE FUNCTION public.school_teacher_hours(p_school_id uuid)
 RETURNS TABLE(student_id uuid, teacher_id uuid, teacher_name text, driven_lessons jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and school_id = p_school_id and school_admin = true
  ) and not exists (
    select 1 from profiles
    where id = auth.uid() and email = 'buerkle.fabian.p@web.de'
  ) then
    raise exception 'Kein Zugriff: nur Fahrschul-Admin oder zentraler Admin';
  end if;

  return query
  select
    s.id as student_id,
    p.id as teacher_id,
    coalesce(nullif(p.display_name,''), split_part(p.email,'@',1)) as teacher_name,
    coalesce(s.data->'drivenLessons', '[]'::jsonb) as driven_lessons
  from students s
  join profiles p on p.id = s.owner
  where p.school_id = p_school_id
    and coalesce(s.data->>'archived','false') != 'true';
end;
$function$;

CREATE OR REPLACE FUNCTION public.school_teacher_month(p_school_id uuid, p_jahr integer, p_monat integer)
 RETURNS TABLE(teacher_id uuid, teacher_name text, student_name text, datum date, minutes integer, price numeric, art text, zuordnung text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin boolean;
  v_mitglied boolean;
begin
  select exists (
    select 1 from profiles
    where id = auth.uid() and school_id = p_school_id and school_admin = true
  ) or exists (
    select 1 from profiles where id = auth.uid() and email = 'buerkle.fabian.p@web.de'
  ) into v_admin;

  select exists (
    select 1 from profiles where id = auth.uid() and school_id = p_school_id
  ) into v_mitglied;

  -- Admin sieht alle Fahrlehrer der Schule, ein angestellter Fahrlehrer nur sich selbst.
  -- Wer gar nicht zur Schule gehoert, sieht nichts.
  if not v_admin and not v_mitglied then
    raise exception 'Kein Zugriff';
  end if;

  return query
  select
    coalesce(a.owner, s.owner) as teacher_id,
    coalesce(nullif(tp.display_name, ''), split_part(tp.email, '@', 1)) as teacher_name,
    btrim(coalesce(s.data->>'vorname', '') || ' ' || coalesce(s.data->>'name', '')) as student_name,
    (l->>'date')::date as datum,
    coalesce(nullif(l->>'minutes', '')::int, 0) as minutes,
    case when jsonb_typeof(l->'price') = 'number' then (l->>'price')::numeric else null end as price,
    nullif(l->>'art', '') as art,
    case when a.id is not null then 'termin' else 'schueler' end as zuordnung
  from students s
  join profiles op on op.id = s.owner and op.school_id = p_school_id
  cross join lateral jsonb_array_elements(coalesce(s.data->'drivenLessons', '[]'::jsonb)) l
  left join appointments a on a.id::text = l->>'apptId'
  left join profiles tp on tp.id = coalesce(a.owner, s.owner)
  where l->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
    and extract(year  from (l->>'date')::date) = p_jahr
    and extract(month from (l->>'date')::date) = p_monat
    and coalesce(tp.school_id, op.school_id) = p_school_id
    and (v_admin or coalesce(a.owner, s.owner) = auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.school_verguetung_list(p_school_id uuid)
 RETURNS TABLE(teacher_id uuid, verguetung jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and school_id = p_school_id and school_admin = true
  ) and not exists (
    select 1 from profiles where id = auth.uid() and email = 'buerkle.fabian.p@web.de'
  ) then
    raise exception 'Kein Zugriff: nur Fahrschul-Admin';
  end if;
  return query
  select p.id, coalesce(p.verguetung, '{}'::jsonb) from profiles p where p.school_id = p_school_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.school_verguetung_set(p_teacher_id uuid, p_modell text, p_satz numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_school uuid;
begin
  if _ist_demo() then
    raise exception 'Im Demo-Modus werden Einstellungen nicht gespeichert.';
  end if;
  select school_id into v_school from profiles where id = p_teacher_id;
  if v_school is null
     or (not exists (select 1 from profiles where id = auth.uid() and school_id = v_school and school_admin = true)
         and not exists (select 1 from profiles where id = auth.uid() and email = 'buerkle.fabian.p@web.de')) then
    raise exception 'Kein Zugriff: nur Fahrschul-Admin';
  end if;
  if p_modell is null or p_modell = '' then
    update profiles set verguetung = '{}'::jsonb where id = p_teacher_id;
  elsif p_modell not in ('fest_ue','prozent') then
    raise exception 'Unbekanntes Verguetungsmodell';
  else
    update profiles set verguetung = jsonb_build_object('modell', p_modell, 'satz', coalesce(p_satz,0))
      where id = p_teacher_id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.student_data_delete(p_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_school uuid; v_row students%rowtype; v_name text; v_dateien int := 0;
  v_kat text[] := array['ADK-Staende','Streckenfahrten','Fahrstunden und Bewertungen','Pruefungen',
    'Begleitete Fahrten','Theorie-Uebungsstand','Notizen','Nachrichten','Profilbild','Kontaktdaten',
    'Zugangsdaten','Hochgeladene Dateien'];
  v_felder text[] := array['adkDates','adkLog','adkNotes','items','customCounts','strecken',
    'streckenLog','streckenNotes','routes','drivenLessons','lessons','manualHours','noShows','exams',
    'schaltkompetenzTests','examSims','licenseSteps','begleitfahrten','begleitplan','begleitEinweisung',
    'elternTel','theorie','theoryProgress',
    'theoryMockExams','bemerkungen','lastNote','messages','avatarUrl','geb','tel','festnetz','sehhilfe',
    'kopfstuetze','lenkrad','pin','pinCustom','pinChanged','pins','referralCode','referredByCode',
    'referralRewardApplied','referrals','wunschliste',
    'dismissedAppts','termin','terminLabel','klasse','location_id'];
  f text; v_neu jsonb;
begin
  if _ist_demo() then
    raise exception 'Im Demo-Modus ist das Loeschen deaktiviert.';
  end if;
  select school_id into v_school from profiles where id = auth.uid();
  select * into v_row from students where id = p_student_id;
  if v_row.id is null then raise exception 'Schueler nicht gefunden'; end if;
  if v_row.owner <> auth.uid() and not (auth.uid() = any(coalesce(v_row.shared_with,'{}'::uuid[]))) then
    raise exception 'Kein Zugriff auf diesen Schueler';
  end if;
  v_name := btrim(coalesce(v_row.data->>'vorname','') || ' ' || coalesce(v_row.data->>'name',''));
  v_neu := v_row.data;
  foreach f in array v_felder loop v_neu := v_neu - f; end loop;
  v_neu := v_neu || jsonb_build_object('dataDeletedAt', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SSOF'));
  update students set data = v_neu, updated_at = now() where id = p_student_id;
  delete from student_files where student_id = p_student_id;
  get diagnostics v_dateien = row_count;
  delete from theory_attendance where student_id = p_student_id;
  insert into deletion_log (school_id, deleted_by, student_id, student_name, kategorien, dateien_geloescht)
  values (v_school, auth.uid(), p_student_id, v_name, v_kat, v_dateien);
  return jsonb_build_object('ok', true, 'name', v_name, 'dateien', v_dateien, 'kategorien', to_jsonb(v_kat));
end;
$function$;

CREATE OR REPLACE FUNCTION public.students_teacher_update(p_id uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_current jsonb;
begin
  select data into v_current from students where id = p_id;
  if not found then
    raise exception 'Schüler nicht gefunden';
  end if;

  update students
  set data = p_data || jsonb_build_object(
        'pinCustom', v_current->'pinCustom',
        'theoryProgress', v_current->'theoryProgress',
        'theoryMockExams', v_current->'theoryMockExams',
        'begleitfahrten', v_current->'begleitfahrten',
        'begleitplan', v_current->'begleitplan',
        'avatarUrl', v_current->'avatarUrl',
        'messages', v_current->'messages',
        'wunschliste', v_current->'wunschliste'
      ),
      updated_at = now()
  where id = p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.voucher_redeem(p_code text, p_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_school uuid; v_row vouchers%rowtype; v_zahlung jsonb;
begin
  -- Siehe _ist_demo(): RLS greift in SECURITY DEFINER-Funktionen nicht.
  if _ist_demo() then
    raise exception 'Im Demo-Modus werden Gutscheine nicht eingeloest.';
  end if;
  select school_id into v_school from profiles where id = auth.uid();
  if v_school is null then raise exception 'Keine Fahrschule zugeordnet'; end if;
  if not exists (
    select 1 from students s
    join profiles owner_p on owner_p.id = s.owner
    where s.id = p_student_id
      and (s.owner = auth.uid() or auth.uid() = any(coalesce(s.shared_with,'{}'::uuid[])))
      and owner_p.school_id = v_school
  ) then
    raise exception 'Kein Zugriff auf diesen Schueler';
  end if;

  update vouchers set status='eingeloest', redeemed_student_id=p_student_id, redeemed_at=now()
   where upper(btrim(code)) = upper(btrim(p_code)) and school_id = v_school and status = 'offen'
  returning * into v_row;

  if v_row.id is null then
    if exists (select 1 from vouchers where upper(btrim(code))=upper(btrim(p_code)) and school_id=v_school) then
      return jsonb_build_object('ok', false, 'grund', 'schon_eingeloest');
    end if;
    return jsonb_build_object('ok', false, 'grund', 'unbekannt');
  end if;

  v_zahlung := jsonb_build_object(
    'date', to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD'),
    'amount', v_row.betrag,
    'method', 'Gutschein ' || v_row.code);
  update students set data = jsonb_set(data, '{payments}',
           coalesce(data->'payments','[]'::jsonb) || jsonb_build_array(v_zahlung)),
         updated_at = now()
   where id = p_student_id;

  return jsonb_build_object('ok', true, 'betrag', v_row.betrag, 'code', v_row.code,
                            'empfaenger', v_row.empfaenger, 'zahlung', v_zahlung);
end;
$function$;

CREATE OR REPLACE FUNCTION public.widget_today_appointments(p_token text)
 RETURNS TABLE(student_name text, start_at timestamp with time zone, end_at timestamp with time zone, art text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
begin
  select owner into v_owner from widget_tokens where token = p_token;
  if v_owner is null then
    return;
  end if;

  return query
    select
      trim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name','')) as student_name,
      a.start_at,
      a.end_at,
      a.art
    from appointments a
    left join students s on s.id::text = a.student_id
    where a.owner = v_owner
      and a.status = 'confirmed'
      and (a.start_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date
      and coalesce(a.note,'') not like '§SONST§%'
      and coalesce(a.note,'') not like '§URLAUB§%'
    order by a.start_at;
end;
$function$;

