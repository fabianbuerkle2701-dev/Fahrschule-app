-- KI-Verwaltung · Posteingang (v2.126.0): Interessenten, die per E-Mail anfragen, legt die KI mit
-- der Herkunft "email" an. Die Prüfbedingung kannte diesen Wert bisher nicht.
alter table public.interessenten drop constraint if exists interessenten_quelle_werte;
alter table public.interessenten add constraint interessenten_quelle_werte check (
  quelle is null or quelle = any (array['telefon', 'persoenlich', 'website', 'empfehlung', 'foto', 'chat', 'email', 'sonstiges']));
