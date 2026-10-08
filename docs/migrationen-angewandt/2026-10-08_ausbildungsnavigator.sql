-- Ausbildungsnavigator (v2.113.0, Pilot), angewandt 2026-10-08 als Migration "ausbildungsnavigator".
-- Plan, Verlauf und Feedback des Navigators liegen im Schülerdatensatz (students.data.navigator) und
-- gehen über students_teacher_update wie alle anderen Ausbildungsdaten. Neu sind nur:
--   1) training_tips: Praxistipps je ADK-Punkt - "Nur für mich" oder "Mit Fahrschule teilen".
--      Kein soziales Netzwerk: nur Text, Sichtbarkeit und "hilfreich" von Kollegen derselben Fahrschule.
--   2) Büro-Ansicht der Akte (school_student_akte): Navigator-Daten wie die Fahrstunden-Notizen ausblenden.
--   3) Datenlöschung (student_data_delete): Navigator-Daten mit löschen.
-- Die Schüler-App sieht nichts davon (public_student_overview baut eine feste Feldliste).

create table public.training_tips (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  author uuid not null default auth.uid() references auth.users(id) on delete cascade,
  adk_key text not null check (char_length(adk_key) between 1 and 80),
  adk_label text not null default '' check (char_length(adk_label) <= 120),
  text text not null check (char_length(btrim(text)) between 1 and 600),
  geteilt boolean not null default false,
  hilfreich uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint training_tips_geteilt_schule check (not geteilt or school_id is not null)
);
create index training_tips_schule_idx on public.training_tips (school_id) where geteilt;
create index training_tips_autor_idx on public.training_tips (author);
alter table public.training_tips enable row level security;

-- Lesen: eigene Tipps und die geteilten der eigenen Fahrschule
create policy training_tips_lesen on public.training_tips for select to authenticated
  using (author = auth.uid() or (geteilt and school_id is not null and school_id = public.my_school_id()));
-- Anlegen: nur als man selbst, nur für die eigene Fahrschule, ohne vorgefüllte "hilfreich"-Stimmen, nicht in der Demo
create policy training_tips_anlegen on public.training_tips for insert to authenticated
  with check (author = auth.uid() and (school_id is null or school_id = public.my_school_id())
              and hilfreich = '{}' and not public._ist_demo());
-- Ändern (nur Text und Sichtbarkeit, siehe Spalten-Rechte) und Löschen: nur eigene
create policy training_tips_aendern on public.training_tips for update to authenticated
  using (author = auth.uid()) with check (author = auth.uid() and (school_id is null or school_id = public.my_school_id()));
create policy training_tips_loeschen on public.training_tips for delete to authenticated
  using (author = auth.uid());

revoke all on public.training_tips from anon, authenticated;
grant select, insert, delete on public.training_tips to authenticated;
grant update (text, geteilt) on public.training_tips to authenticated;

-- "Hilfreich" an- und abwählen: nur bei geteilten Tipps der eigenen Fahrschule, nicht beim eigenen
create or replace function public.training_tip_hilfreich(p_id uuid)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_anz integer;
begin
  if v_uid is null or _ist_demo() then
    raise exception 'Nicht erlaubt';
  end if;
  update training_tips t
     set hilfreich = case when v_uid = any(t.hilfreich) then array_remove(t.hilfreich, v_uid) else t.hilfreich || v_uid end
   where t.id = p_id and t.geteilt and t.school_id is not null and t.school_id = my_school_id() and t.author <> v_uid
   returning cardinality(t.hilfreich) into v_anz;
  if not found then
    raise exception 'Tipp nicht gefunden';
  end if;
  return v_anz;
end $$;
revoke all on function public.training_tip_hilfreich(uuid) from public, anon;
grant execute on function public.training_tip_hilfreich(uuid) to authenticated;

-- Büro (nicht Admin) sieht in der Akte keine Navigator-Daten - wie bei Fahrstunden und Notizen.
-- Datenlöschung nimmt die Navigator-Daten mit.
do $mig$
declare alt text; neu text;
begin
  alt := pg_get_functiondef('public.school_student_akte(uuid)'::regprocedure);
  neu := replace(alt, $x$'pins','pin','pinCustom'])$x$, $x$'pins','pin','pinCustom','navigator'])$x$);
  if neu = alt or position('''navigator''' in neu) = 0 then
    raise exception 'Anker fehlt in school_student_akte';
  end if;
  execute neu;

  alt := pg_get_functiondef('public.student_data_delete(uuid)'::regprocedure);
  neu := replace(alt, $x$'dismissedAppts',$x$, $x$'dismissedAppts','navigator',$x$);
  if neu = alt or position('''navigator''' in neu) = 0 then
    raise exception 'Anker fehlt in student_data_delete';
  end if;
  execute neu;
end $mig$;
