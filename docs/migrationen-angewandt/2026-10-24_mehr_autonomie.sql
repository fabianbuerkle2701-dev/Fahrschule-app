-- Allindrive Autopilot · mehr KI-Autonomie (Fabian 23.10.2026: „Zudem soll die KI noch viel mehr übernehmen und autonom
-- erledigen“). Drei neue Schalter für Vollautonom (Start: aus, der Admin schaltet einzeln ein):
--   · interessenten_nachfassen – Interessenten mit fälliger Wiedervorlage bzw. 48 h ohne Kontakt bekommen den Nachfass-Text
--   · anmeldungen_uebernehmen  – Online-Anmeldungen über den Buchungslink werden als Schüler übernommen
--   · unterlagen_erinnern      – Schüler mit einer Prüfung in den nächsten drei Wochen werden an fehlende Unterlagen erinnert
-- Dazu: die Zeitjobs (feuern nur, wenn eine Fahrschule mit Vollautonom den Schalter hat), die Ausgangs-Art „unterlagen“,
-- Bestätigen und Prüfungs-Überblick auch für den Server (service_role) und die Büro-Kennung am Empfehlungsbonus (damit das
-- Zusammenführen in students_teacher_update ihn gegen ein veraltetes Fahrlehrer-Gerät behält).

alter table public.schools drop constraint if exists schools_ki_autonomie_form;
alter table public.schools add constraint schools_ki_autonomie_form check (
  jsonb_typeof(ki_autonomie) = 'object'
  and (ki_autonomie - array['mails_alle', 'erinnerungen', 'zahlungen_buchen', 'belege_buchen', 'abrechnen', 'werkstatt_termine',
                            'interessenten_nachfassen', 'anmeldungen_uebernehmen', 'unterlagen_erinnern']) = '{}'::jsonb
  and not jsonb_path_exists(ki_autonomie, '$.*?(@.type() != "boolean")'));

alter table public.nachrichten_ausgang drop constraint if exists nachrichten_ausgang_art;
alter table public.nachrichten_ausgang add constraint nachrichten_ausgang_art check (art = any (array['erinnerung', 'nachfassen', 'rechnung', 'unterlagen']));

-- Bestätigen: auch der Zeitjob (service_role); Empfehlungsbonus mit Büro-Kennung
do $do$
declare
  v_def text := pg_get_functiondef('public.school_anmeldung_bestaetigen(uuid)'::regprocedure);
  v_recht constant text := $a$if not (_ist_schul_admin(v_school)$a$;
  v_bonus constant text := $a$'amount', -v_bonus));$a$;
begin
  if position('service_role' in v_def) > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, v_recht, ''))) / length(v_recht) <> 1
     or (length(v_def) - length(replace(v_def, v_bonus, ''))) / length(v_bonus) <> 2 then
    raise exception 'school_anmeldung_bestaetigen hat sich verändert – Ersetzung abgebrochen';
  end if;
  execute replace(replace(v_def, v_recht, $a$if not (coalesce(auth.role(), '') = 'service_role' or _ist_schul_admin(v_school)$a$),
                  v_bonus, $a$'amount', -v_bonus, 'erfasstVon', 'buero', 'erfasstAm', clock_timestamp()::text));$a$);
end $do$;

-- Prüfungs-Überblick: auch der Zeitjob (service_role), dazu die E-Mail des Schülers (für die Erinnerung an Unterlagen)
do $do$
declare
  v_def text := pg_get_functiondef('public.school_pruefungen(uuid)'::regprocedure);
  v_recht constant text := $a$if p_school_id is null or not _darf_schulweit(p_school_id) then$a$;
  v_tel constant text := $a$'tel', coalesce(s.data->>'tel', ''),$a$;
begin
  if position('service_role' in v_def) > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, v_recht, ''))) / length(v_recht) <> 1
     or (length(v_def) - length(replace(v_def, v_tel, ''))) / length(v_tel) <> 1 then
    raise exception 'school_pruefungen hat sich verändert – Ersetzung abgebrochen';
  end if;
  execute replace(replace(v_def, v_recht, $a$if p_school_id is null or not (coalesce(auth.role(), '') = 'service_role' or _darf_schulweit(p_school_id)) then$a$),
                  v_tel, $a$'tel', coalesce(s.data->>'tel', ''), 'email', coalesce(s.data->>'email', ''),$a$);
end $do$;

-- Zeitjobs: stündlich, nur wenn eine Fahrschule mit Vollautonom den Schalter hat (wie vollautonom-erinnerungen)
do $do$
declare j record;
begin
  for j in select * from (values ('vollautonom-nachfassen', '47 * * * *', 'interessenten_nachfassen'),
                                 ('vollautonom-anmeldungen', '52 * * * *', 'anmeldungen_uebernehmen'),
                                 ('vollautonom-unterlagen', '57 * * * *', 'unterlagen_erinnern')) as t(name, plan, schalter) loop
    perform cron.unschedule(j.name) where exists (select 1 from cron.job where jobname = j.name);
    perform cron.schedule(j.name, j.plan, format($c$
  select net.http_post(
    url := 'https://allindrive.netlify.app/.netlify/functions/%s',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')),
    body := '{}'::jsonb)
  where exists (select 1 from public.schools where autopilot_paket = 'vollautonom' and ki_autonomie->>'%s' = 'true');
$c$, j.name, j.schalter));
  end loop;
end $do$;
