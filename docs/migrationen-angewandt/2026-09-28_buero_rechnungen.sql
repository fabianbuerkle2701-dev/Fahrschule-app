-- 2026-09-28 · Rechnungen durch Admin und Büro (Produktplan Teil Q) · v2.43.0
--
-- create_invoice/cancel_invoice liefen als SECURITY INVOKER: nur Besitzer und Freigegebene
-- kamen per RLS an den Schüler. Jetzt SECURITY DEFINER mit denselben Prüfungen wie bisher plus
-- einem zweiten Weg: Admin/Büro (_darf_schulweit) für Schüler, deren Fahrlehrer zur Fahrschule
-- p_school_id gehört - nur mit deren eigenem Nummernkreis. Die Demo-Sperre kam bisher aus der
-- RLS-Policy und steht deshalb jetzt ausdrücklich in beiden Funktionen.
--
-- Was die Fahrlehrer-App nach dem RPC selbst nachträgt (invoicedCoveredUE/invoicedPrice je
-- Fahrstunde, faellig, Umbuchen von Zahlungen beim Storno), erledigt der Server auf dem Schul-Weg
-- in derselben Transaktion (neue Parameter p_lesson_extra, p_faellig, p_umbuchen - der Fahrlehrer-
-- Weg bleibt unverändert). Schul-Rechnungen werden über _schul_aenderung markiert ('invoices',
-- 'abrechnung', ggf. 'payments'), damit ein veralteter Gerätestand sie nicht überschreibt; die
-- Zusammenführung dafür steht in students_teacher_update.

drop function if exists public.create_invoice(uuid, uuid, jsonb, text[], integer[], text, text[]);
create function public.create_invoice(p_student_id uuid, p_school_id uuid, p_items jsonb, p_lesson_ids text[] default null,
  p_cost_idx integer[] default null, p_note text default '', p_cost_ids text[] default null,
  p_lesson_extra jsonb default null, p_faellig date default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_row      students%rowtype;
  v_number   text;
  v_total    numeric;
  v_invoice  jsonb;
  v_driven   jsonb;
  v_cost     jsonb;
  v_invoices jsonb;
  v_payments jsonb;
  v_data     jsonb;
  v_kunt     boolean;
  v_schon    text;
  v_schule   boolean := false;
  v_per_id   boolean := p_cost_ids is not null and array_length(p_cost_ids, 1) > 0;
begin
  if _ist_demo() then
    raise exception 'Im Demo-Modus werden keine Rechnungen erstellt.';
  end if;
  select * into v_row from students where id = p_student_id for update;
  if not found then
    raise exception 'Schüler nicht gefunden';
  end if;
  if not (auth.uid() = v_row.owner or (v_row.shared_with is not null and auth.uid() = any(v_row.shared_with))) then
    if not exists (select 1 from profiles where id = v_row.owner and school_id = p_school_id) or not _darf_schulweit(p_school_id) then
      raise exception 'Kein Zugriff auf diesen Schüler';
    end if;
    v_schule := true;
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
  if v_schule and p_faellig is not null then
    v_invoice := v_invoice || jsonb_build_object('faellig', p_faellig::text);
  end if;

  -- Auf dem Schul-Weg den Paket-/Preis-Schnappschuss je Fahrstunde gleich mitschreiben (die
  -- Fahrlehrer-App erledigt das nach dem RPC selbst, siehe confirmInvoice). Nur Zahlen.
  select coalesce(jsonb_agg(
    case when p_lesson_ids is not null and (elem->>'id') = any(p_lesson_ids)
      then elem || jsonb_build_object('invoiced', v_number)
           || case when v_schule and jsonb_typeof(p_lesson_extra->(elem->>'id')) = 'object' then jsonb_strip_nulls(jsonb_build_object(
                'invoicedCoveredUE', case when jsonb_typeof(p_lesson_extra->(elem->>'id')->'invoicedCoveredUE') = 'number' then p_lesson_extra->(elem->>'id')->'invoicedCoveredUE' end,
                'invoicedPrice', case when jsonb_typeof(p_lesson_extra->(elem->>'id')->'invoicedPrice') = 'number' then p_lesson_extra->(elem->>'id')->'invoicedPrice' end))
              else '{}'::jsonb end
      else elem end
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
  v_data := jsonb_set(jsonb_set(jsonb_set(v_row.data, '{drivenLessons}', v_driven, true), '{costItems}', v_cost, true), '{invoices}', v_invoices, true);

  if v_schule then
    -- Beim Storno vorgemerkte Zahlungen (umbuchenVon) gehören jetzt zu dieser Rechnung - wie confirmInvoice().
    if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_data->'payments') = 'array' then v_data->'payments' else '[]'::jsonb end) p
                where p ? 'umbuchenVon' and not (p ? 'invoiceId')) then
      select coalesce(jsonb_agg(case when p ? 'umbuchenVon' and not (p ? 'invoiceId')
               then (p - 'umbuchenVon') || jsonb_build_object('invoiceId', v_invoice->>'id', 'umgebuchtVon', p->'umbuchenVon') else p end order by nr), '[]'::jsonb)
        into v_payments from jsonb_array_elements(v_data->'payments') with ordinality t(p, nr);
      v_data := jsonb_set(_schul_aenderung(v_data, 'payments'), '{payments}', v_payments);
    end if;
    v_data := _schul_aenderung(_schul_aenderung(v_data, 'invoices'), 'abrechnung');
  end if;

  update students set data = v_data, updated_at = now() where id = p_student_id;

  return v_invoice;
end;
$function$;
revoke all on function public.create_invoice(uuid, uuid, jsonb, text[], integer[], text, text[], jsonb, date) from public, anon;
grant execute on function public.create_invoice(uuid, uuid, jsonb, text[], integer[], text, text[], jsonb, date) to authenticated;

drop function if exists public.cancel_invoice(uuid, uuid, text, text);
create function public.cancel_invoice(p_student_id uuid, p_school_id uuid, p_invoice_id text, p_reason text, p_umbuchen boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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
  v_payments     jsonb;
  v_data         jsonb;
  v_schule       boolean := false;
begin
  if _ist_demo() then
    raise exception 'Im Demo-Modus werden keine Rechnungen storniert.';
  end if;
  select * into v_row from students where id = p_student_id for update;
  if not found then
    raise exception 'Schüler nicht gefunden';
  end if;
  if not (auth.uid() = v_row.owner or (v_row.shared_with is not null and auth.uid() = any(v_row.shared_with))) then
    if not exists (select 1 from profiles where id = v_row.owner and school_id = p_school_id) or not _darf_schulweit(p_school_id) then
      raise exception 'Kein Zugriff auf diesen Schüler';
    end if;
    v_schule := true;
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

  -- Wieder offen: auch die Schnappschüsse dieser Abrechnung entfernen (wie die Fahrlehrer-App).
  select coalesce(jsonb_agg(
    case when elem->>'invoiced' = v_target->>'number' then elem - 'invoiced' - 'invoicedCoveredUE' - 'invoicedPrice' else elem end
  ), '[]'::jsonb)
  into v_driven
  from jsonb_array_elements(coalesce(v_row.data->'drivenLessons', '[]'::jsonb)) elem;

  select coalesce(jsonb_agg(
    case when elem->>'invoiced' = v_target->>'number' then elem - 'invoiced' else elem end
    order by ord
  ), '[]'::jsonb)
  into v_cost
  from jsonb_array_elements(coalesce(v_row.data->'costItems', '[]'::jsonb)) with ordinality as t(elem, ord);

  v_data := jsonb_set(jsonb_set(jsonb_set(v_row.data, '{invoices}', v_invoices, true), '{drivenLessons}', v_driven, true), '{costItems}', v_cost, true);

  if v_schule then
    -- Schon eingegangene Zahlungen der Ersatzrechnung vormerken (wie cancelInvoice() mit "umbuchen").
    if p_umbuchen and jsonb_typeof(v_data->'payments') = 'array' then
      select coalesce(jsonb_agg(case when p->>'invoiceId' = v_target->>'id'
               then (p - 'invoiceId') || jsonb_build_object('umbuchenVon', v_target->>'number') else p end order by nr), '[]'::jsonb)
        into v_payments from jsonb_array_elements(v_data->'payments') with ordinality t(p, nr);
      v_data := jsonb_set(_schul_aenderung(v_data, 'payments'), '{payments}', v_payments);
    end if;
    v_data := _schul_aenderung(_schul_aenderung(v_data, 'invoices'), 'abrechnung');
  end if;

  update students set data = v_data, updated_at = now() where id = p_student_id;

  return v_storno;
end;
$function$;
revoke all on function public.cancel_invoice(uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.cancel_invoice(uuid, uuid, text, text, boolean) to authenticated;

-- Fahrlehrer-Speichern: Schul-Rechnungen und ihre Markierungen an Fahrstunden/Posten/Zahlungen
-- gegen einen veralteten Gerätestand schützen (Erweiterung der v2.41.0-Zusammenführung).
create or replace function public.students_teacher_update(p_id uuid, p_data jsonb)
returns void language plpgsql set search_path to 'public' as $function$
declare
  v_current jsonb; v_neu jsonb; v_marken jsonb; v_k text; v_ts text; v_teile text[]; v_liste text;
begin
  select data into v_current from students where id = p_id;
  if not found then
    raise exception 'Schüler nicht gefunden';
  end if;
  v_neu := p_data;
  -- Schul-Änderungen (Büro/Admin, siehe _schul_aenderung), die dieses Gerät noch nicht geladen hatte, gewinnen.
  v_marken := case when jsonb_typeof(v_current->'schulAenderungen') = 'object' then v_current->'schulAenderungen' else '{}'::jsonb end;
  for v_k, v_ts in select key, value #>> '{}' from jsonb_each(v_marken) loop
    if (p_data->'schulAenderungen'->>v_k) is distinct from v_ts then
      if v_k = 'payments' then
        -- Geräte-Zahlungen bleiben; ihre Rechnungszuordnung kommt vom Server (Umbuchen beim Storno),
        -- vom Büro erfasste Zahlungen, die das Gerät nicht kennt, kommen dazu.
        v_neu := jsonb_set(v_neu, '{payments}', coalesce((
          select jsonb_agg(x.e order by x.quelle, x.nr) from (
            select 1 as quelle, c.nr,
                   case when s.e is null then c.e
                        else (c.e - 'invoiceId' - 'umbuchenVon' - 'umgebuchtVon')
                             || jsonb_strip_nulls(jsonb_build_object('invoiceId', s.e->'invoiceId', 'umbuchenVon', s.e->'umbuchenVon', 'umgebuchtVon', s.e->'umgebuchtVon')) end as e
              from jsonb_array_elements(case when jsonb_typeof(p_data->'payments') = 'array' then p_data->'payments' else '[]'::jsonb end) with ordinality c(e, nr)
              left join lateral (select s1.e from jsonb_array_elements(case when jsonb_typeof(v_current->'payments') = 'array' then v_current->'payments' else '[]'::jsonb end) s1(e)
                                  where c.e ? 'id' and s1.e->>'id' = c.e->>'id' limit 1) s on true
            union all
            select 2, s.nr, s.e from jsonb_array_elements(case when jsonb_typeof(v_current->'payments') = 'array' then v_current->'payments' else '[]'::jsonb end) with ordinality s(e, nr)
             where s.e->>'erfasstVon' = 'buero' and s.e ? 'id'
               and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_data->'payments') = 'array' then p_data->'payments' else '[]'::jsonb end) c2(e2)
                                where c2.e2->>'id' = s.e->>'id')) x), '[]'::jsonb));
      elsif v_k = 'invoices' then
        -- Rechnungen entstehen nur auf dem Server: dessen Stand plus evtl. nur lokal bekannte.
        v_neu := jsonb_set(v_neu, '{invoices}', coalesce((
          select jsonb_agg(x.e order by x.quelle, x.nr) from (
            select 1 as quelle, s.nr, s.e from jsonb_array_elements(case when jsonb_typeof(v_current->'invoices') = 'array' then v_current->'invoices' else '[]'::jsonb end) with ordinality s(e, nr)
            union all
            select 2, c.nr, c.e from jsonb_array_elements(case when jsonb_typeof(p_data->'invoices') = 'array' then p_data->'invoices' else '[]'::jsonb end) with ordinality c(e, nr)
             where not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_current->'invoices') = 'array' then v_current->'invoices' else '[]'::jsonb end) s2(e2)
                                where s2.e2->>'id' = c.e->>'id')) x), '[]'::jsonb));
      elsif v_k = 'abrechnung' then
        -- Abrechnungsmarken an Fahrstunden und Kostenposten vom Server übernehmen.
        foreach v_liste in array array['drivenLessons', 'costItems'] loop
          if jsonb_typeof(v_neu->v_liste) = 'array' then
            v_neu := jsonb_set(v_neu, array[v_liste], coalesce((
              select jsonb_agg(case when s.e is null then c.e
                        else (c.e - 'invoiced' - 'invoicedCoveredUE' - 'invoicedPrice')
                             || jsonb_strip_nulls(jsonb_build_object('invoiced', s.e->'invoiced', 'invoicedCoveredUE', s.e->'invoicedCoveredUE', 'invoicedPrice', s.e->'invoicedPrice')) end
                     order by c.nr)
                from jsonb_array_elements(v_neu->v_liste) with ordinality c(e, nr)
                left join lateral (select s1.e from jsonb_array_elements(case when jsonb_typeof(v_current->v_liste) = 'array' then v_current->v_liste else '[]'::jsonb end) s1(e)
                                    where c.e ? 'id' and s1.e->>'id' = c.e->>'id' limit 1) s on true), '[]'::jsonb));
          end if;
        end loop;
      elsif position('.' in v_k) > 0 then
        v_teile := string_to_array(v_k, '.');
        if jsonb_typeof(v_neu->v_teile[1]) is distinct from 'object' then v_neu := jsonb_set(v_neu, array[v_teile[1]], '{}'::jsonb); end if;
        if v_current #> v_teile is null then v_neu := v_neu #- v_teile; else v_neu := jsonb_set(v_neu, v_teile, v_current #> v_teile); end if;
      else
        if v_current ? v_k then v_neu := jsonb_set(v_neu, array[v_k], v_current->v_k); else v_neu := v_neu - v_k; end if;
      end if;
    end if;
  end loop;
  -- Markierungen verwaltet nur der Server (ein Gerät kann sie weder setzen noch löschen).
  v_neu := case when v_marken = '{}'::jsonb then v_neu - 'schulAenderungen' else v_neu || jsonb_build_object('schulAenderungen', v_marken) end;

  update students
  set data = v_neu || jsonb_build_object(
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
