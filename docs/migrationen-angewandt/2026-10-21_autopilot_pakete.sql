-- Fabian 21.10.2026: KI im Autopilot in Paketen – Teilautonom und Vollautonom. Die Verwaltung bleibt kostenlos.
-- Gebucht wird über Stripe (Function paket-buchen, Abgleich über stripe-webhook); Preise legt der zentrale Admin in
-- app_settings fest. Was die KI in Vollautonom selbst erledigt, schaltet der Fahrschul-Admin einzeln ein (ki_autonomie,
-- nach dem Buchen ist alles aus). Rein additiv.

alter table public.schools add column if not exists autopilot_paket text check (autopilot_paket in ('teilautonom', 'vollautonom'));
alter table public.schools add column if not exists autopilot_paket_bis timestamptz;   -- bezahlt bis (Stripe); null = ohne Ende (vom zentralen Admin vergeben)
alter table public.schools add column if not exists stripe_customer_id text;
alter table public.schools add column if not exists stripe_subscription_id text;
alter table public.schools add column if not exists ki_autonomie jsonb not null default '{}'::jsonb; -- Schalter des Admins: {"mails_alle":true,…}

alter table public.app_settings add column if not exists autopilot_preise jsonb not null default '{}'::jsonb; -- {"teilautonom":29,"vollautonom":59} in Euro je Monat

-- Wächter: Paket und Stripe-Kennungen setzen nur der Stripe-Abgleich (Service-Schlüssel) und der zentrale Admin –
-- nie die Fahrschule selbst (sonst könnte sich ein Admin Vollautonom ohne Bezahlung eintragen)
create or replace function public._guard_school_paket()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Direkt in der Datenbank (Supabase-Dashboard, Migration) ist session_user nicht der Zugang der Schnittstelle
  if auth.uid() = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid or auth.role() = 'service_role' or session_user <> 'authenticator' then
    return new;
  end if;
  if TG_OP = 'INSERT' then
    new.autopilot_paket := null; new.autopilot_paket_bis := null; new.stripe_customer_id := null; new.stripe_subscription_id := null;
  else
    new.autopilot_paket := old.autopilot_paket; new.autopilot_paket_bis := old.autopilot_paket_bis;
    new.stripe_customer_id := old.stripe_customer_id; new.stripe_subscription_id := old.stripe_subscription_id;
  end if;
  return new;
end $function$;

drop trigger if exists guard_school_paket on public.schools;
create trigger guard_school_paket before insert or update on public.schools for each row execute function public._guard_school_paket();

-- Welches Paket gilt gerade? (abgelaufen = keins) – für die Functions und die App
create or replace function public.autopilot_paket_aktiv(p_school uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select case when s.autopilot_paket is not null and (s.autopilot_paket_bis is null or s.autopilot_paket_bis > now()) then s.autopilot_paket end
    from schools s
   where s.id = p_school
     and (p_school = my_school_id() or auth.uid() = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid or auth.role() = 'service_role');
$function$;
revoke all on function public.autopilot_paket_aktiv(uuid) from public, anon;
grant execute on function public.autopilot_paket_aktiv(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
