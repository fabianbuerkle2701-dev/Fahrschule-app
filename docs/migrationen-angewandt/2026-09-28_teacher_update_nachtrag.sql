-- 2026-09-28 · Nachtrag Pre-Push-Review (v2.44.1): students_teacher_update verfeinert
-- - Zahlungen: Rechnungszuordnung nur dann vom Server, wenn er eine Umbuchung kennt, die das Gerät
--   noch nicht hat (Büro-Storno/Ersatzrechnung). Vorher überschrieb ein veralteter Stand auch eigene
--   Zuordnungen des Fahrlehrers.
-- - Abrechnungsmarken: nur bei abweichender Rechnungsnummer vom Server. Vorher gingen die
--   Schnappschüsse (invoicedCoveredUE/invoicedPrice) verloren, die die Fahrlehrer-App nach dem
--   eigenen create_invoice setzt.
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
                   -- Zuordnung nur dann vom Server, wenn er eine Umbuchung kennt, die das Gerät nicht hat
                   -- (Büro-Storno bzw. Ersatzrechnung); eigene Zuordnungen des Fahrlehrers bleiben.
                   case when s.e is not null and ((s.e ? 'umgebuchtVon' and not (c.e ? 'umgebuchtVon'))
                                                  or (s.e ? 'umbuchenVon' and not (c.e ? 'umbuchenVon' or c.e ? 'umgebuchtVon')))
                        then (c.e - 'invoiceId' - 'umbuchenVon' - 'umgebuchtVon')
                             || jsonb_strip_nulls(jsonb_build_object('invoiceId', s.e->'invoiceId', 'umbuchenVon', s.e->'umbuchenVon', 'umgebuchtVon', s.e->'umgebuchtVon'))
                        else c.e end as e
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
              -- Nur bei abweichender Rechnungsnummer (Büro-Rechnung/-Storno) vom Server; zur selben Rechnung
              -- bleiben die Schnappschüsse, die die Fahrlehrer-App nach create_invoice selbst setzt.
              select jsonb_agg(case when s.e is null or (s.e->>'invoiced') is not distinct from (c.e->>'invoiced') then c.e
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
