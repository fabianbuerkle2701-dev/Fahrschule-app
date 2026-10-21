-- Fabian 21.10.2026: Vollautonom „Sicher gelesene Belege buchen“ (Schalter belege_buchen). Die KI übernimmt einen
-- eindeutig gelesenen Beleg selbst in die Ausgaben – nur über diese Funktion, nur mit dem Service-Schlüssel (Zeitjob
-- buchhaltung-ki bzw. beleg-lesen; Paket, Schalter und KI prüfen die Functions). Werte kommen aus dem Vorschlag selbst.
-- Sieht der Beleg wie ein schon gebuchter aus (gleicher Betrag und gleiche Rechnungsnummer, oder gleicher Lieferant am
-- selben Tag), bucht sie nicht und gibt null zurück – dann entscheidet der Mensch.

alter table public.ausgaben add column if not exists von_ki boolean not null default false; -- von der KI gebucht (Vollautonom)

create or replace function public.beleg_vorschlag_ki_buchen(p_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v beleg_vorschlaege%rowtype; v_aus uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Kein Zugriff'; end if;
  select * into v from beleg_vorschlaege where id = p_id for update;
  if v.id is null or v.status <> 'bereit' then return null; end if;
  if v.datum is null or v.datum < current_date - 400 or v.datum > current_date then return null; end if;
  if v.betrag is null or v.betrag <= 0 or v.betrag >= 1000000 then return null; end if;
  if v.ust_satz is null or v.ust_satz not in (0, 7, 19) then return null; end if;
  if length(btrim(v.kategorie)) < 1 or length(v.kategorie) > 60 then return null; end if;
  -- Doppelt? Dann lieber den Menschen fragen
  if exists (select 1 from ausgaben a where a.school_id = v.school_id and a.betrag = v.betrag and (
         (btrim(v.rechnungsnummer) <> '' and position(lower(btrim(v.rechnungsnummer)) in lower(coalesce(a.beschreibung, ''))) > 0)
      or (a.datum = v.datum and btrim(v.lieferant) <> '' and position(lower(btrim(v.lieferant)) in lower(coalesce(a.beschreibung, ''))) = 1)))
     or exists (select 1 from beleg_vorschlaege b where b.school_id = v.school_id and b.id <> v.id and b.status in ('bereit', 'uebernommen') and b.betrag = v.betrag and (
         (btrim(v.rechnungsnummer) <> '' and lower(btrim(b.rechnungsnummer)) = lower(btrim(v.rechnungsnummer)))
      or (b.datum = v.datum and lower(btrim(b.lieferant)) = lower(btrim(v.lieferant)) and btrim(v.lieferant) <> ''))) then
    return null;
  end if;
  insert into ausgaben (school_id, erfasst_von, datum, betrag, kategorie, beschreibung, ust_satz, zahlart, beleg_pfad, von_ki, updated_at)
  values (v.school_id, null, v.datum, round(v.betrag, 2), btrim(v.kategorie), nullif(left(btrim(v.beschreibung), 200), ''), v.ust_satz,
          nullif(left(btrim(v.zahlart), 30), ''), v.beleg_pfad, true, now())
  returning id into v_aus;
  update beleg_vorschlaege set status = 'uebernommen', ausgabe_id = v_aus, grund = 'Von der KI gebucht', updated_at = now() where id = p_id;
  return v_aus;
end $function$;
revoke all on function public.beleg_vorschlag_ki_buchen(uuid) from public, anon, authenticated;
grant execute on function public.beleg_vorschlag_ki_buchen(uuid) to service_role;

notify pgrst, 'reload schema';
