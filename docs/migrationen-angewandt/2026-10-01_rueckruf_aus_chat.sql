-- Rückruf-Wunsch aus dem Chat der Buchungsseite (v2.81.0, Produktplan #9 "Chat -> Interessent"),
-- angewandt 2026-10-01 (zwei Migrationen: rueckruf_aus_chat + rueckruf_aus_chat_telnorm).
-- Legt einen Interessenten (quelle 'chat', status 'offen') beim Fahrlehrer des Buchungscodes an.
-- Schutz: Einwilligung Pflicht, Längen begrenzt, dieselbe Telefonnummer (normalisiert, +49/0049 = 0)
-- binnen 24 h = kein neuer Eintrag, höchstens 20 Chat-Rückrufe pro Konto und Tag, Demo ausgenommen.
-- Geprüft per Rollback-Test als anon: ok | Dublette (+49-Schreibweise) | ohne Einwilligung | Demo | zu kurze Nummer.
create or replace function public._tel_norm(p text)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when d like '0049%' then '0' || substr(d, 5)
    when d like '49%' and length(d) >= 11 then '0' || substr(d, 3)
    else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;
revoke all on function public._tel_norm(text) from public, anon, authenticated;

create or replace function public.public_rueckruf_aus_chat(code text, p_vorname text, p_tel text, p_klasse text, p_fragen text, p_einwilligung boolean)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_owner uuid; v_vorname text; v_tel text; v_ziffern text; v_n int; v_notiz text;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null then return 'code'; end if;
  if v_owner = '114d1f0a-9947-459d-8009-06282799ca44'::uuid then return 'demo'; end if;
  if not coalesce(p_einwilligung, false) then return 'einwilligung'; end if;
  v_vorname := left(btrim(coalesce(p_vorname, '')), 80);
  v_tel := left(btrim(coalesce(p_tel, '')), 40);
  v_ziffern := _tel_norm(v_tel);
  if v_vorname = '' then return 'name'; end if;
  if length(v_ziffern) < 6 then return 'tel'; end if;
  if exists (select 1 from interessenten i where i.owner = v_owner and i.created_at > now() - interval '24 hours'
              and _tel_norm(i.tel) = v_ziffern) then
    return 'ok';
  end if;
  select count(*) into v_n from interessenten i where i.owner = v_owner and i.quelle = 'chat' and i.created_at > now() - interval '24 hours';
  if v_n >= 20 then return 'zuviele'; end if;
  v_notiz := 'Rückruf-Wunsch aus dem Chat der Buchungsseite.';
  if coalesce(btrim(p_fragen), '') <> '' then
    v_notiz := v_notiz || E'\nGefragt: ' || left(btrim(p_fragen), 500);
  end if;
  insert into interessenten(owner, vorname, name, tel, klasse, notiz, status, quelle)
  values (v_owner, v_vorname, '', v_tel, nullif(left(btrim(coalesce(p_klasse, '')), 10), ''), v_notiz, 'offen', 'chat');
  return 'ok';
end; $$;
revoke all on function public.public_rueckruf_aus_chat(text, text, text, text, text, boolean) from public;
grant execute on function public.public_rueckruf_aus_chat(text, text, text, text, text, boolean) to anon, authenticated;
