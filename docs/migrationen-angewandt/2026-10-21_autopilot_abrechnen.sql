-- Allindrive Autopilot · Rechnungen schreiben (21.10.2026)
--
-- 1) school_rechnungen liefert zusätzlich, was zum Abrechnen und Drucken gebraucht wird: je Schüler die
--    abrechnungsrelevanten Felder der Fahrstunden (id, Datum, Minuten, Preis, Abrechnungsmarken – keine
--    Notizen), Kostenposten, Pakete, Abrechnungsmodell, Anschrift und Firmenangaben. Dabei sind jetzt auch
--    aktive Schüler ohne Rechnung (für „Nicht abgerechnet“). Nur der Autopilot nutzt diese Funktion.
--
-- 2) create_invoice / cancel_invoice bekommen den optionalen Parameter p_schulweg (Standard false).
--    Hintergrund: Ist der Admin selbst Fahrlehrer des Schülers, lief seine Rechnung bisher immer über den
--    Fahrlehrer-Weg – ohne Fälligkeit, ohne Paket-/Preis-Schnappschuss je Fahrstunde, ohne Umbuchen beim
--    Storno und ohne die Markierungen, die eine Rechnung gegen einen veralteten Gerätestand schützen.
--    In der Fahrlehrer-App erledigt das Gerät diese Schritte selbst; der Autopilot ist aber kein Gerät des
--    Fahrlehrers. Mit p_schulweg = true nimmt der Aufruf den Schul-Weg (_darf_schulweit wird wie bisher
--    geprüft, ein reiner Fahrlehrer bekommt „Kein Zugriff“). Ohne den Parameter – also jeder Aufruf der
--    Fahrlehrer-App – ändert sich nichts.
--    Gezielte Ersetzung per DO-Block mit Anker-Prüfung (wie bei früheren Änderungen), danach dieselben Rechte
--    wie vorher (nur authenticated und service_role).

create or replace function public.school_rechnungen(p_school_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_school_id is null or not _darf_schulweit(p_school_id) then
    raise exception 'Kein Zugriff: nur Fahrschul-Admin oder Büro';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'student_id', s.id,
             'vorname', coalesce(s.data->>'vorname', ''),
             'name', coalesce(s.data->>'name', ''),
             'tel', coalesce(s.data->>'tel', ''),
             'eltern_tel', coalesce(s.data->>'elternTel', ''),
             'anschrift', coalesce(s.data->>'anschrift', ''),
             'firma', case when s.data->'istFirmenkunde' = 'true'::jsonb
                           then jsonb_build_object('name', coalesce(s.data->>'firmaName', ''), 'email', coalesce(s.data->>'firmaEmail', ''),
                                                   'strasse', coalesce(s.data->>'firmaStrasse', ''), 'plz_ort', coalesce(s.data->>'firmaPlzOrt', ''),
                                                   'ust_id', coalesce(s.data->>'firmaUstId', ''))
                           else null end,
             'archiviert', coalesce(s.data->'archived' = 'true'::jsonb, false),
             'lehrer', coalesce(nullif(p.display_name, ''), split_part(p.email, '@', 1)),
             'abrechnungs_modell', s.data->>'abrechnungsModell',
             'invoices', case when jsonb_typeof(s.data->'invoices') = 'array' then s.data->'invoices' else '[]'::jsonb end,
             'payments', case when jsonb_typeof(s.data->'payments') = 'array' then s.data->'payments' else '[]'::jsonb end,
             'reminders', case when jsonb_typeof(s.data->'reminders') = 'array' then s.data->'reminders' else '[]'::jsonb end,
             'lessons', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                           'id', e->'id', 'date', e->'date', 'minutes', e->'minutes', 'price', e->'price', 'invoiced', e->'invoiced',
                           'invoicedCoveredUE', e->'invoicedCoveredUE', 'invoicedPrice', e->'invoicedPrice', 'nichtBerechnen', e->'nichtBerechnen')))
                         from jsonb_array_elements(case when jsonb_typeof(s.data->'drivenLessons') = 'array' then s.data->'drivenLessons' else '[]'::jsonb end) e), '[]'::jsonb),
             'cost_items', case when jsonb_typeof(s.data->'costItems') = 'array' then s.data->'costItems' else '[]'::jsonb end,
             'packages', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('includedUE', pk->'includedUE', 'date', pk->'date', 'label', pk->'label')))
                         from jsonb_array_elements(case when jsonb_typeof(s.data->'packages') = 'array' then s.data->'packages' else '[]'::jsonb end) pk), '[]'::jsonb)
           ) order by lower(coalesce(s.data->>'name', '')), lower(coalesce(s.data->>'vorname', '')))
      from students s
      join profiles p on p.id = s.owner
     where p.school_id = p_school_id
       and ((jsonb_typeof(s.data->'invoices') = 'array' and jsonb_array_length(s.data->'invoices') > 0)
            or (coalesce(s.data->'archived' = 'true'::jsonb, false) = false and coalesce(s.data->>'dataDeletedAt', '') = ''
                and coalesce(s.data->>'pending', 'false') <> 'true'))
  ), '[]'::jsonb);
end $$;
revoke all on function public.school_rechnungen(uuid) from public, anon;
grant execute on function public.school_rechnungen(uuid) to authenticated;

do $mig$
declare alt text; neu text;
begin
  -- create_invoice
  alt := pg_get_functiondef('public.create_invoice(uuid, uuid, jsonb, text[], integer[], text, text[], jsonb, date)'::regprocedure);
  neu := replace(alt, 'p_faellig date DEFAULT NULL::date)', 'p_faellig date DEFAULT NULL::date, p_schulweg boolean DEFAULT false)');
  if neu = alt then raise exception 'Anker fehlt (create_invoice Kopf)'; end if;
  if (length(neu) - length(replace(neu, 'if not (auth.uid() = v_row.owner or', ''))) / length('if not (auth.uid() = v_row.owner or') <> 1 then
    raise exception 'Anker fehlt oder mehrdeutig (create_invoice Zugriff)';
  end if;
  neu := replace(neu, 'if not (auth.uid() = v_row.owner or', 'if coalesce(p_schulweg, false) or not (auth.uid() = v_row.owner or');
  execute 'drop function public.create_invoice(uuid, uuid, jsonb, text[], integer[], text, text[], jsonb, date)';
  execute neu;
  execute 'revoke all on function public.create_invoice(uuid, uuid, jsonb, text[], integer[], text, text[], jsonb, date, boolean) from public, anon';
  execute 'grant execute on function public.create_invoice(uuid, uuid, jsonb, text[], integer[], text, text[], jsonb, date, boolean) to authenticated, service_role';

  -- cancel_invoice
  alt := pg_get_functiondef('public.cancel_invoice(uuid, uuid, text, text, boolean)'::regprocedure);
  neu := replace(alt, 'p_umbuchen boolean DEFAULT false)', 'p_umbuchen boolean DEFAULT false, p_schulweg boolean DEFAULT false)');
  if neu = alt then raise exception 'Anker fehlt (cancel_invoice Kopf)'; end if;
  if (length(neu) - length(replace(neu, 'if not (auth.uid() = v_row.owner or', ''))) / length('if not (auth.uid() = v_row.owner or') <> 1 then
    raise exception 'Anker fehlt oder mehrdeutig (cancel_invoice Zugriff)';
  end if;
  neu := replace(neu, 'if not (auth.uid() = v_row.owner or', 'if coalesce(p_schulweg, false) or not (auth.uid() = v_row.owner or');
  execute 'drop function public.cancel_invoice(uuid, uuid, text, text, boolean)';
  execute neu;
  execute 'revoke all on function public.cancel_invoice(uuid, uuid, text, text, boolean, boolean) from public, anon';
  execute 'grant execute on function public.cancel_invoice(uuid, uuid, text, text, boolean, boolean) to authenticated, service_role';
end $mig$;

notify pgrst, 'reload schema';

-- Proben (21.10.2026): Probelauf der ganzen Migration in einer verworfenen Transaktion, danach eingespielt und
-- erneut geprüft (verworfen, 0 Reste). Fahrlehrer-Weg ohne p_schulweg unverändert (keine Fälligkeit, kein
-- Schnappschuss) · Admin als Besitzer mit p_schulweg: Fälligkeit, invoicedPrice-Schnappschuss, Markierungen
-- abrechnung+invoices · Storno mit p_schulweg gibt die Fahrstunde frei · reiner Fahrlehrer mit p_schulweg
-- gesperrt · anon darf create_invoice/cancel_invoice nicht ausführen · alte 9-Parameter-Signatur entfernt ·
-- school_rechnungen liefert lessons ohne Notizen, cost_items, packages, anschrift, abrechnungs_modell.
