-- 2026-09-30 · Übergabe-Faktenblatt · v2.70.0
-- Der Fahrlehrer, dem ein Schüler zugeteilt wurde, erfährt davon (Protokoll student_assignment_log
-- ist sonst nur für den Inhaber lesbar). Nur die EIGENEN Übergaben der letzten 90 Tage, nur Schüler,
-- die ihm weiterhin gehören. Rein lesend, additiv.
create or replace function public.meine_uebergaben()
returns table(student_id uuid, von_name text, am timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select distinct on (l.student_id) l.student_id, coalesce(l.von_name, ''), l.created_at
  from student_assignment_log l
  join students s on s.id = l.student_id and s.owner = auth.uid()
  where l.nach_teacher = auth.uid() and l.aktion = 'umgehaengt'
    and l.created_at > now() - interval '90 days'
  order by l.student_id, l.created_at desc;
$$;
revoke all on function public.meine_uebergaben() from public, anon;
grant execute on function public.meine_uebergaben() to authenticated;
