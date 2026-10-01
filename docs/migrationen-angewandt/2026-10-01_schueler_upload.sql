-- Schüler laden Unterlagen selbst hoch (v2.80.0, Top-10 #7), angewandt 2026-10-01.
-- Schüler haben kein Supabase-Konto (Zugang = Buchungscode + Name + PIN). Deshalb:
--  1. public_student_upload_ticket(): prüft den Login und gibt ein Einmal-Ticket (15 Min) aus.
--  2. Storage-Regel "schueler_upload_insert": anon darf GENAU eine Datei je Ticket und Endung
--     in den Ordner <owner>/<student_id>/ von student-files legen (u-<ticket>.jpg|png|pdf).
--     Lesen/Löschen bleibt wie bisher nur für Fahrlehrer, die den Schüler sehen.
--  3. public_student_upload_fertig(): prüft Login + Ticket + dass die Datei existiert (≤ 10 MB),
--     legt die Zeile in student_files an (von_schueler = true) und entwertet das Ticket.
-- _schueler_login/public_student_uploads sind volatile: _verify_student_login zählt Fehlversuche (schreibt).
-- Geprüft 2026-10-01 mit Test-Schüler (danach entfernt): falsche PIN, ohne Ticket, fremder Ordner,
-- anderer Dateiname, Ticket zweimal - alles abgelehnt; anon kann die Datei nicht lesen.
-- Grenzen: höchstens 12 Tickets pro Schüler und Stunde, höchstens 30 Schüler-Dateien insgesamt.

alter table public.student_files add column if not exists von_schueler boolean not null default false;
alter table public.student_files add column if not exists geprueft_at timestamptz;

create table if not exists public.schueler_upload_tickets (
  token uuid primary key default gen_random_uuid(),
  owner uuid not null,
  student_id uuid not null,
  category text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  used_at timestamptz
);
alter table public.schueler_upload_tickets enable row level security;
-- keine Policies: nur die SECURITY-DEFINER-Funktionen und die Storage-Regel (über eine Hilfsfunktion) lesen sie
revoke all on public.schueler_upload_tickets from anon, authenticated;
create index if not exists schueler_upload_tickets_student on public.schueler_upload_tickets (student_id, created_at);

create or replace function public._schueler_login(code text, p_name text, p_pin text)
returns table(owner uuid, student_id uuid)
language plpgsql volatile security definer set search_path to 'public' as $$
declare v_owner uuid; v_row students%rowtype; v_eff text;
begin
  v_owner := _owner_by_code(code);
  if v_owner is null or p_name is null or length(btrim(p_name)) = 0 then return; end if;
  select * into v_row from students s
   where s.owner = v_owner
     and regexp_replace(lower(btrim(coalesce(s.data->>'vorname','') || ' ' || coalesce(s.data->>'name',''))), '\s+', ' ', 'g')
       = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
   order by _student_pin_matches(coalesce(nullif(s.data->>'pinCustom',''), s.data->>'pin'), p_pin) desc, s.created_at
   limit 1;
  if not found then return; end if;
  v_eff := coalesce(nullif(v_row.data->>'pinCustom',''), v_row.data->>'pin');
  if v_eff is null or v_eff = '' or not _verify_student_login(v_owner, p_name, v_eff, p_pin) then return; end if;
  return query select v_owner, v_row.id;
end; $$;
revoke all on function public._schueler_login(text, text, text) from public, anon, authenticated;

create or replace function public.public_student_upload_ticket(code text, p_name text, p_pin text, p_category text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_owner uuid; v_sid uuid; v_token uuid; v_n int;
begin
  if p_category not in ('sehtest','erstehilfe','passfoto','antrag') then return jsonb_build_object('fehler','kategorie'); end if;
  select l.owner, l.student_id into v_owner, v_sid from _schueler_login(code, p_name, p_pin) l;
  if v_owner is null then return jsonb_build_object('fehler','login'); end if;
  select count(*) into v_n from schueler_upload_tickets t where t.student_id = v_sid and t.created_at > now() - interval '1 hour';
  if v_n >= 12 then return jsonb_build_object('fehler','zuviele'); end if;
  select count(*) into v_n from student_files f where f.student_id = v_sid and f.von_schueler;
  if v_n >= 30 then return jsonb_build_object('fehler','voll'); end if;
  insert into schueler_upload_tickets(owner, student_id, category) values (v_owner, v_sid, p_category) returning token into v_token;
  return jsonb_build_object('ordner', v_owner::text || '/' || v_sid::text, 'token', v_token);
end; $$;
revoke all on function public.public_student_upload_ticket(text, text, text, text) from public;
grant execute on function public.public_student_upload_ticket(text, text, text, text) to anon, authenticated;

-- Hilfsfunktion für die Storage-Regel: gültiges, unbenutztes Ticket zu Ordner + Dateiname?
create or replace function public._schueler_upload_erlaubt(p_name text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from schueler_upload_tickets t
     where t.used_at is null and t.expires_at > now()
       and (storage.foldername(p_name))[1] = t.owner::text
       and (storage.foldername(p_name))[2] = t.student_id::text
       and array_length(storage.foldername(p_name), 1) = 2
       and storage.filename(p_name) in ('u-' || t.token::text || '.jpg', 'u-' || t.token::text || '.png', 'u-' || t.token::text || '.pdf'));
$$;
revoke all on function public._schueler_upload_erlaubt(text) from public;
grant execute on function public._schueler_upload_erlaubt(text) to anon, authenticated;

drop policy if exists schueler_upload_insert on storage.objects;
create policy schueler_upload_insert on storage.objects for insert to anon
  with check (bucket_id = 'student-files' and public._schueler_upload_erlaubt(name));

create or replace function public.public_student_upload_fertig(code text, p_name text, p_pin text, p_token uuid, p_dateiname text)
returns text language plpgsql security definer set search_path to 'public', 'storage' as $$
declare v_owner uuid; v_sid uuid; v_t schueler_upload_tickets%rowtype; v_obj record;
begin
  select l.owner, l.student_id into v_owner, v_sid from _schueler_login(code, p_name, p_pin) l;
  if v_owner is null then return 'login'; end if;
  select * into v_t from schueler_upload_tickets t where t.token = p_token and t.student_id = v_sid and t.owner = v_owner for update;
  if not found or v_t.used_at is not null then return 'ticket'; end if;
  select o.name, coalesce((o.metadata->>'size')::bigint, 0) as groesse into v_obj
    from storage.objects o
   where o.bucket_id = 'student-files'
     and o.name in (v_owner::text || '/' || v_sid::text || '/u-' || p_token::text || '.jpg',
                    v_owner::text || '/' || v_sid::text || '/u-' || p_token::text || '.png',
                    v_owner::text || '/' || v_sid::text || '/u-' || p_token::text || '.pdf')
   order by o.created_at desc limit 1;
  if v_obj.name is null then return 'datei'; end if;
  update schueler_upload_tickets set used_at = now() where token = p_token;
  if v_obj.groesse > 10 * 1024 * 1024 then return 'gross'; end if;
  insert into student_files(student_id, owner, category, filename, storage_path, size_bytes, von_schueler)
  values (v_sid, v_owner, v_t.category, left(coalesce(nullif(btrim(p_dateiname), ''), 'Foto'), 120), v_obj.name, nullif(v_obj.groesse, 0), true);
  return 'ok';
end; $$;
revoke all on function public.public_student_upload_fertig(text, text, text, uuid, text) from public;
grant execute on function public.public_student_upload_fertig(text, text, text, uuid, text) to anon, authenticated;

-- Was hat der Schüler schon hochgeladen? (nur Kategorie + Zeitpunkt + ob geprüft)
create or replace function public.public_student_uploads(code text, p_name text, p_pin text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare v_owner uuid; v_sid uuid;
begin
  select l.owner, l.student_id into v_owner, v_sid from _schueler_login(code, p_name, p_pin) l;
  if v_owner is null then return null; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('category', f.category, 'am', f.created_at, 'geprueft', f.geprueft_at is not null) order by f.created_at desc)
    from student_files f where f.student_id = v_sid and f.von_schueler), '[]'::jsonb);
end; $$;
revoke all on function public.public_student_uploads(text, text, text) from public;
grant execute on function public.public_student_uploads(text, text, text) to anon, authenticated;

-- Fahrlehrer markiert ein Schüler-Dokument als geprüft (wer den Schüler sieht)
create or replace function public.student_file_geprueft(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public' as $$
begin
  update student_files f set geprueft_at = now()
   where f.id = p_id and f.geprueft_at is null
     and exists (select 1 from students s where s.id = f.student_id and (s.owner = auth.uid() or auth.uid() = any (s.shared_with)));
  return found;
end; $$;
revoke all on function public.student_file_geprueft(uuid) from public, anon;
grant execute on function public.student_file_geprueft(uuid) to authenticated;
