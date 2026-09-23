-- ══ Phase 3: Schema-Export aus Supabase Cloud (Projekt oavuftlfnknucxuortar) ══════════════
-- Per read-only SQL-Introspektion rekonstruiert (kein pg_dump, kein DB-Passwort noetig).
-- Teil 1/N: CREATE TABLE Statements (Spalten, Defaults, NOT NULL) -- ohne PK/FK/UNIQUE/CHECK,
-- die kommen als separate ALTER TABLE Statements in Teil 2.

CREATE TABLE public.app_settings (
  id integer DEFAULT 1 NOT NULL,
  paypal_link text,
  -- Berliner Kalenderdatum des letzten erfolgreich verschickten 18-Uhr-Tageserinnerungslaufs
  -- (daily-appointment-reminders.js) - atomar per bedingtem PATCH geclaimt, damit ein zweiter
  -- fast gleichzeitiger Aufruf keine doppelten Pushes verschickt.
  last_daily_reminder_sent date
);
CREATE TABLE public.appointments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner uuid NOT NULL,
  student_id text,
  title text DEFAULT ''::text,
  start_at timestamp with time zone NOT NULL,
  end_at timestamp with time zone,
  status text DEFAULT 'confirmed'::text NOT NULL,
  note text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  art text DEFAULT 'ÜST'::text NOT NULL,
  reminded_at timestamp with time zone,
  offer_klasse text,
  offered_at timestamp with time zone,
  push_pending_since timestamp with time zone,
  checkin_code text,
  checkin_expires_at timestamp with time zone,
  checkin_thema text
);
CREATE TABLE public.bookings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  school_id uuid NOT NULL,
  vehicle_id text NOT NULL,
  teacher_name text NOT NULL,
  teacher_id uuid,
  start_at timestamp with time zone NOT NULL,
  end_at timestamp with time zone NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.calendar_feeds (
  owner uuid NOT NULL,
  token text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.deletion_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  school_id uuid,
  deleted_by uuid NOT NULL,
  student_id uuid,
  student_name text NOT NULL,
  kategorien text[] NOT NULL,
  dateien_geloescht integer DEFAULT 0 NOT NULL,
  deleted_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.device_tokens (
  owner uuid NOT NULL,
  token text NOT NULL,
  platform text DEFAULT 'ios'::text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.document_counters (
  school_id uuid NOT NULL,
  kind text NOT NULL,
  year integer NOT NULL,
  next_seq integer DEFAULT 1 NOT NULL
);
CREATE TABLE public.exam_slots (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner uuid NOT NULL,
  art text NOT NULL,
  datum date NOT NULL,
  zeit text,
  ort text,
  student_id uuid,
  status text DEFAULT 'frei'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
COMMENT ON TABLE public.exam_slots IS 'Von TÜV/DEKRA zugeteilte Prüfplatz-Kontingente einer Fahrschule (Praxis/Theorie) - der Fahrlehrer weist sie einzeln Prüfreifen Schülern zu und kann bei Ausfall einen Nachrücker vorschlagen. Bewusst eine eigene Tabelle statt appointments/students.data, um Kalender-, Erinnerungs- und Abrechnungslogik nicht mit einer fremden Terminart zu vermischen.';
CREATE TABLE public.interessenten (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner uuid NOT NULL,
  vorname text,
  name text,
  tel text,
  klasse text,
  notiz text,
  status text DEFAULT 'offen'::text NOT NULL,
  follow_up_am date,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.lesson_reflections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner uuid NOT NULL,
  student_id uuid NOT NULL,
  lesson_id text NOT NULL,
  ratings jsonb DEFAULT '{}'::jsonb NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
COMMENT ON TABLE public.lesson_reflections IS 'Schüler-Selbsteinschätzung je Fahrtenbuch-Eintrag (students.data.lessons[].id), vor Einsicht der Fahrlehrer-Bewertung abgegeben (siehe public_student_lessons: teacherRatings wird erst nach reflected=true zurückgegeben). Eigene Tabelle statt students.data, u.a. weil Schreibzugriff nur über die anonyme RPC laufen soll, nie direkt vom Fahrlehrer-Client.';
CREATE TABLE public.payer_lookup_throttle (
  id boolean DEFAULT true NOT NULL,
  window_start timestamp with time zone DEFAULT now() NOT NULL,
  count integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text NOT NULL,
  school_id uuid,
  booking_code text,
  school_admin boolean DEFAULT false NOT NULL,
  last_seen timestamp with time zone,
  day_limit integer DEFAULT 495 NOT NULL,
  week_limit integer DEFAULT 0 NOT NULL,
  display_name text,
  work_hours jsonb,
  subscription_active boolean DEFAULT false,
  subscription_amount numeric,
  subscription_last_paid date,
  subscription_accepted_at timestamp with time zone,
  address text,
  phone text,
  birthdate date,
  street text,
  house_no text,
  zip text,
  city text,
  booking_message text,
  default_location_id text,
  app_moderator boolean DEFAULT false NOT NULL,
  practice_log_enabled boolean DEFAULT false NOT NULL,
  theory_addon_active boolean DEFAULT false NOT NULL,
  avatar_url text,
  review_url text,
  review_message text,
  reminder_message text,
  student_day_limit integer,
  student_week_limit integer,
  verguetung jsonb DEFAULT '{}'::jsonb NOT NULL,
  subscription_lifetime boolean DEFAULT false NOT NULL
);
CREATE TABLE public.public_chat_usage (
  booking_code text NOT NULL,
  day date NOT NULL,
  count integer DEFAULT 0 NOT NULL,
  feature text DEFAULT 'default'::text NOT NULL
);
-- Gemeinsames KI-Tageslimit pro Konto (Kompromiss statt Abo-Gate, 23.9.2026) - siehe
-- ki_rate_limit() in 04-functions.sql und netlify/functions/lib/ki-guard.js.
CREATE TABLE public.ki_usage (
  uid uuid NOT NULL,
  day date NOT NULL,
  feature text NOT NULL DEFAULT 'default',
  count integer NOT NULL DEFAULT 0
);
CREATE TABLE public.public_enroll_usage (
  booking_code text NOT NULL,
  day date NOT NULL,
  count integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.route_templates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  city text NOT NULL,
  title text NOT NULL,
  strecken jsonb DEFAULT '[]'::jsonb NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  proposed_by uuid,
  proposed_by_name text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  reviewed_at timestamp with time zone
);
CREATE TABLE public.schools (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  subtitle text DEFAULT 'Automatik · Klasse B'::text,
  color text DEFAULT '#FF9300'::text,
  logo text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  price_hour numeric,
  packages jsonb DEFAULT '[]'::jsonb NOT NULL,
  vehicles jsonb DEFAULT '[]'::jsonb,
  klassen jsonb DEFAULT '[]'::jsonb NOT NULL,
  arten jsonb DEFAULT '[]'::jsonb NOT NULL,
  cal_code text,
  invite_code text,
  locations jsonb DEFAULT '[]'::jsonb NOT NULL,
  referral_reward numeric DEFAULT 20 NOT NULL,
  invoice_settings jsonb DEFAULT '{}'::jsonb,
  sonderfahrten_soll jsonb DEFAULT '{}'::jsonb NOT NULL,
  no_show_fee_default numeric,
  reform_stichtag date,
  price_grundgebuehr numeric,
  price_lehrmaterial numeric,
  price_sonderfahrt numeric,
  price_pruefungsvorstellung numeric,
  preismeldung_letzte date,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  storno_frist_stunden integer,
  zahlungsziel_tage integer,
  planung_puffer_wochen integer,
  datev_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  bundesland text
);
CREATE TABLE public.staff_files (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  school_id uuid NOT NULL,
  instructor_uid uuid NOT NULL,
  uploaded_by uuid,
  category text DEFAULT 'sonstiges'::text NOT NULL,
  filename text NOT NULL,
  storage_path text NOT NULL,
  size_bytes bigint,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.student_files (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  student_id uuid NOT NULL,
  owner uuid NOT NULL,
  category text DEFAULT 'sonstiges'::text NOT NULL,
  filename text NOT NULL,
  storage_path text NOT NULL,
  size_bytes bigint,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.student_login_throttle (
  throttle_key text NOT NULL,
  fail_count integer DEFAULT 0 NOT NULL,
  locked_until timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.students (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner uuid NOT NULL,
  data jsonb DEFAULT '{}'::jsonb NOT NULL,
  shared_with uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.templates (
  owner uuid NOT NULL,
  adk jsonb DEFAULT '[]'::jsonb NOT NULL,
  strecken jsonb DEFAULT '[]'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  adk_titel text,
  strecken_titel text
);
CREATE TABLE public.theory_attendance (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner uuid NOT NULL,
  appt_id uuid NOT NULL,
  student_id uuid NOT NULL,
  thema text,
  checked_at timestamp with time zone DEFAULT now() NOT NULL
);
COMMENT ON TABLE public.theory_attendance IS 'Anwesenheitsnachweis je Theorieunterricht-Termin (QR-Check-in durch den Schüler, oder manuell durch den Fahrlehrer). Eigene Tabelle statt appointments/students.data zu überladen.';
CREATE TABLE public.theory_questions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  topic_key text NOT NULL,
  klasse text DEFAULT 'ALL'::text NOT NULL,
  points integer NOT NULL,
  question text NOT NULL,
  image_url text,
  options jsonb NOT NULL,
  explanation text,
  active boolean DEFAULT true NOT NULL,
  is_sample boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  amtl_nr text,
  quelle text,
  answer_stem text
);
CREATE TABLE public.theory_resources (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  klasse text NOT NULL,
  topic_key text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  content text,
  status text DEFAULT 'pending'::text NOT NULL,
  proposed_by uuid NOT NULL,
  proposed_by_name text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  reviewed_at timestamp with time zone,
  file_path text,
  file_name text,
  link text
);
CREATE TABLE public.videos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner uuid NOT NULL,
  school_id uuid,
  title text NOT NULL,
  category text NOT NULL,
  storage_path text NOT NULL,
  size_bytes bigint,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.vouchers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  school_id uuid NOT NULL,
  created_by uuid NOT NULL,
  code text NOT NULL,
  betrag numeric NOT NULL,
  empfaenger text,
  von text,
  status text DEFAULT 'offen'::text NOT NULL,
  redeemed_student_id uuid,
  redeemed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
COMMENT ON TABLE public.vouchers IS 'Geschenkgutscheine einer Fahrschule. status offen = verkauft und noch nicht eingeloest (bilanziell eine Verbindlichkeit), eingeloest = einem Schueler als Zahlung gutgeschrieben. Die Einloesung laeuft ausschliesslich ueber voucher_redeem() - ein Client-seitiges Update koennte denselben Gutschein doppelt einloesen.';
CREATE TABLE public.widget_tokens (
  owner uuid NOT NULL,
  token text DEFAULT encode(gen_random_bytes(24), 'hex'::text) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
COMMENT ON TABLE public.deletion_log IS 'Protokoll ausgefuehrter Loeschungen von Ausbildungsdaten (Paragraf 31 FahrlG). Der Schuelerdatensatz selbst bleibt bestehen, weil Rechnungen und Zahlungen der steuerlichen Aufbewahrung unterliegen - geloescht werden nur die Ausbildungsdaten. Das Protokoll ist der Nachweis gegenueber Aufsicht und Datenschutzbehoerde und wird bewusst nicht loeschbar gemacht.';
