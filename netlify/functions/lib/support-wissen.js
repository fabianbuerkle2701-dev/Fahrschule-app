// Wissen über die App für den KI-Support (netlify/functions/support.js). Wird bei Anthropic
// zwischengespeichert - Änderungen hier wirken mit dem nächsten Deploy. Bei neuen Funktionen,
// geänderten Menüs oder Bezeichnungen hier nachziehen, sonst erklärt der Support alte Wege
// (siehe Obsidian „KI-Support“). Die Navigationsziele müssen zu befehlsZiele() in index.html passen.
// Stand: v2.125.2, zusammengestellt aus dem Code am 19.10.2026. Keine personenbezogenen Daten.

const WISSEN = `# Allindrive – Wissensbuch für den Support

Stand: App-Version 2.125.2 (Oktober 2026). Alle Menüpfade, Reiter und Knöpfe sind so geschrieben, wie sie in der App stehen. „›“ trennt die Schritte eines Pfads.

Grundregeln für Antworten:
- Viele Bereiche lassen sich abschalten (Einstellungen › Funktionen ein/aus). Findet jemand etwas nicht, ist eine ausgeschaltete Funktion der häufigste Grund – persönlich oder für die ganze Fahrschule.
- Manche Bereiche sieht nur der Fahrschul-Admin (Inhaber) oder das Büro. Pilotfunktionen wie Ally gibt es nur in Fahrschulen, für die Allindrive sie freigeschaltet hat.
- Fast alles, was mit Schülern zu tun hat, hängt am gerade gewählten Schüler. Ohne gewählten Schüler zeigen Übersicht, ADK, Strecken und Fahrstunden „Kein Schüler ausgewählt“ mit dem Knopf „Zur Schülerliste“.

---

## 1. Aufbau der App

### 1.1 Zwei Seiten einer App
- **Fahrlehrer-App**: Anmeldung mit E-Mail und Passwort. Läuft als iPhone-App oder im Browser (gleicher Inhalt, gleiche Daten). Für Fahrlehrer, Fahrschul-Admin und Büro.
- **Fahrschüler-Seite**: Buchungsseite (Link vom Fahrlehrer) und die App „Allindrive für Fahrschüler“. Schüler haben kein Konto, sie melden sich mit Fahrschul-Code und PIN an (siehe Abschnitt 4).

### 1.2 Navigation am Handy (untere Leiste)
Die Leiste hat fünf Plätze: **Schüler · Ausbildung · + · Kalender · Mehr**.
- **Schüler**: Schülerliste („Meine Schüler“).
- **Ausbildung**: öffnet ein Blatt mit Navigator, ADK, Strecken, Fahrstunden, Prüfungssimulation, Schaltkompetenz (jeweils nur, wenn die Funktion an ist). Alles bezieht sich auf den gewählten Schüler.
- **+** (Mitte): heißt „Neuer Termin“. Steht man in einer Ausbildungsansicht mit gewähltem Schüler, heißt er „Neue Fahrstunde“ und legt einen Fahrtenbuch-Eintrag an.
- **Kalender**: eine rote Zahl am Reiter zeigt offene Terminvorschläge und Storno-Anfragen.
- **Mehr**: Blatt mit drei aufklappbaren Gruppen und einem Direkteintrag:
  - Fahrschule: Fahrschul-Dashboard und Team-Kalender (nur Fahrschul-Admin und Büro), Auswertung, Fuhrpark, Ausgaben & Gewinn (nur Fahrschul-Admin), Tagesgeschäft, Interessenten, Autopilot (nur Fahrschul-Admin und Büro, öffnet den Allindrive Autopilot, mit Zahl der E-Mails, die warten)
  - Schüler: Übersicht, Schülerdaten
  - Lernen: Videos, Theoriepilot
  - Einstellungen
- **Startseite**: Am Handy gibt es keinen eigenen Reiter. Auf das Logo bzw. den Fahrschulnamen oben links tippen.
- Zurück: Wisch vom linken Rand führt in den vorherigen Bereich (auch an dieselbe Stelle der Liste). Zurück-Knöpfe sind orange.

### 1.3 Navigation am Computer und iPad quer (ab ca. 900 Pixel Breite)
Statt der unteren Leiste gibt es links eine feste Seitenleiste:
- Logo/Fahrschulname (führt zur Startseite), darunter der Knopf „Neuer Termin“ (in Ausbildungsansichten „Neue Fahrstunde“)
- Startseite, Schüler
- Ausbildung ▾: Navigator, ADK, Strecken, Fahrstunden, Prüfungssim., Schaltkompetenz
- Fahrlehrer ▾: Theoriepilot (nur wenn der Theoriepilot an ist)
- Übersicht (Schülerakte des gewählten Schülers)
- Kalender (mit Zähler für offene Anfragen)
- Mehr ▾: Fahrschul-Dashboard, Team-Kalender (beide nur Fahrschul-Admin/Büro), Schülerdaten, Fuhrpark, Ausgaben & Gewinn (nur Fahrschul-Admin), Auswertung, Tagesgeschäft, Interessenten, Autopilot (nur Fahrschul-Admin/Büro, öffnet den Allindrive Autopilot), Einstellungen, Videos

Kopfzeile (alle Geräte, am Computer ausführlicher): Suchfeld „Schüler, Termin oder Einstellung suchen…“ (⌘K bzw. Strg+K), Tageszeile „Heute · N Fahrstunden · nächster …“ (führt zum Kalender), Wetter (abschaltbar) und die Speicheranzeige (siehe 6.3).

### 1.4 Schnellsuche (⌘K / Strg+K oder Suchfeld)
Findet:
- Schüler nach Name oder Telefonnummer (ab 4 Ziffern, auch mit 0 statt +49). Treffer öffnet die ADK des Schülers.
- Rechnungen nach Nummer (öffnet die Kosten des Schülers).
- Interessenten nach Name oder Telefon.
- Seiten und Einstellungen nach Name und Stichworten, z. B. „Kosten“, „Schülercode“, „Dashboard“ (Liste aller Ziele: Abschnitt 7).
Archivierte Schüler findet die Schnellsuche nicht – dafür Schülerliste › „Archiv (bestanden)“ aufklappen. Am Handy: Eintrag antippen, zum Schließen daneben tippen; am Computer ↑↓, Enter, Esc.

### 1.5 Startseite
Begrüßung mit Datum, darunter (jede Karte einzeln abschaltbar unter Funktionen ein/aus › Startseite):
- **Tages-Briefing erstellen** (KI, nur wenn KI an).
- **Prüfungstag**: Steht heute eine Prüfung im Kalender, oben eine Checkliste (Ausweis, Brille, Ausbildungsnachweis, Fahrzeug), danach „Bestanden“ / „Nicht bestanden“.
- **Nächster Termin**: große Karte mit Uhrzeit, Klasse, Abholort, „Ziel: …“ und „Zum Termin →“. Gibt es heute keinen mehr, zeigt sie den nächsten künftigen Termin.
- **Offene Terminvorschläge** / Storno-Anfragen („Von deinen Schülern, warten auf Antwort“).
- **Kennzahlen**: „Aktive Schüler“ und „Offene Beträge“ (Anzahl Schüler mit offenem Betrag).
- **Heute**: deine Termine von heute, mit „Navigation ›“ bzw. „Route (…)“ zu den Abholorten in Google Maps.
- **Dringend** (Abbruch-Risiko, ablaufende Fristen) und **Diese Woche**: Hinweise mit Direktsprung, z. B. überfällige Rechnungen, Lastschrift einziehbar, Wiedervorlagen, Paket-Guthaben knapp, „Schüler ohne nächsten Termin“, „bereit für die Testfahrt zur Prüfungsreife“, Unterlagen fehlen, „Fahrstunden morgen erinnern“, Prüfungen in 7 Tagen, prüfungsreif ohne Prüfplatz, Schlussrechnung fehlt, Rückruf-Wünsche, Anfragen seit über 2 Tagen ohne Antwort, neue Unterlagen vom Schüler. „Später“ blendet einen Hinweis 7 Tage aus; ändert sich etwas daran, ist er sofort zurück.
- Neue Konten sehen die Karte „Einrichtung: x von y“ (Schritt-für-Schritt-Einrichtung, „Überspringen“, „Karte ausblenden“).
- Ein reines Büro-Konto (ohne Admin-Rechte) sieht als Startseite die Fahrschul-Übersicht (Cockpit) statt „Mein Tag“.

### 1.6 Schülerliste („Meine Schüler“)
- Oben: Megafon-Symbol (Nachricht an Schüler, siehe Rundnachricht), Bild-Symbol („Schüler aus Screenshot“, nur mit KI und Import), Datei-Symbol („Bestand aus alter Software übernehmen“, Import) und „+ Schüler“.
- Neue Online-Anmeldungen über den Buchungslink erscheinen oben („1 neue Anmeldung“) mit „✓ Übernehmen“ / „Ablehnen“.
- Suchfeld, Filter „Alle“, „Aktiv“, „Prüfungsreif“, „Offener Betrag“, ab zwei Standorten zusätzlich Standort-Filter („Alle Standorte“, „Ohne Standort“).
- Gruppen nach Ampel: Prüfungsreif (grün), Fast so weit (gelb), In Ausbildung (rot).
- Karte antippen öffnet die Übersicht des Schülers. Karte nach links wischen: Anruf und WhatsApp. Grauer × auf der Karte: Schüler löschen.
- Unten: „Aufräumen“-Vorschlag, „Archiv (bestanden) · N“, „Papierkorb“ (30 Tage wiederherstellbar).
- Was auf den Karten steht (Beträge, nächster Termin, Stand, Ring, Ampel-Punkt, Klasse, Wischen), lässt sich unter Funktionen ein/aus › Schülerliste ausblenden.

### 1.7 Die Schülerakte
Alle Schüleransichten haben denselben Kopf: Fortschrittsring, Name, Zeile mit Klasse, Stunden, Stand und „Theorie bestanden“/„Theorie offen“, „Nächster Schritt: …“ und das ⋮-Menü („Aktionen zum Schüler“):
- Anderen Schüler wählen
- Als PDF drucken
- Als bestanden archivieren / Aus Archiv zurückholen (wieder aktiv) – nur eigene Schüler
- KI-Übergabe-Einschätzung erstellen (nur eigene Schüler, KI an)
- Fahrschulwechsel: Übergabecode
- Datenauskunft (DSGVO) – nur eigene Schüler
- Übergabe-Faktenblatt

Reiter unter dem Kopf: **Übersicht · Navigator · ADK · Strecken · Fahrstunden · Kosten** (Navigator, ADK, Strecken, Fahrstunden und Kosten nur, wenn die jeweilige Funktion an ist; „Kosten“ hängt an „Rechnungen & Kasse“).
- **Übersicht**: Ausbildungsstand, nächste Fahrstunde, offener Betrag, Karte „Zuverlässigkeit“, Sonderfahrten, Prüfungsreife mit „Voraussetzungen zur Prüfungsanmeldung“, Prüfungsakte-Verlauf, KI-Knöpfe, „ADK-Karte per Foto übertragen“.
- **Schülerdaten** (Mehr › Schüler › Schülerdaten oder Reiter „Kosten“): oben „🏕️ Basislager“ (Stammdaten · Zugänge · Termin) mit den Abschnitten Stammdaten, Ausbildung, Zugänge & Teilen. Darunter Stationen: Theorie, Kasse, Begleitf., Führersch., Prüfung. Die geöffneten Stationen heißen „Fahrten & Kosten“, „Führerschein“, „Begleitfahrten“, „Theorie“ und „Prüfungsakte“.

### 1.8 Kalender
- Kopf: Pfeile vor/zurück, „KW …“, „Heute“ (springt zu heute/aktueller Woche/aktuellem Monat), Umschalter **Woche · Tag · Monat**. In Woche und Tag zwei runde Knöpfe: „Als Karten anzeigen“ (Liste) und „Als Zeitstrahl anzeigen“.
- UE-Zeile: UE dieser Woche und dieses Monats; mit Wochenlimit ein Balken „x von y“. Daneben „Planen“ (nur ohne Ally).
- Offene Anfragen stehen als eigene farbige Fläche oben (z. B. „1 Stornierung · 2 offene Terminvorschläge“, „Ansehen“/„Einklappen“); Bearbeitung siehe Abschnitt 2, Anfragen von Schülern.
- Die Woche zeigt Montag bis Samstag. Freie Tage sind nur eine schmale Zeile, Feiertage werden angezeigt (bundesweit, mit Bundesland unter Meine Fahrschule auch landesweite). Sonntag erscheint nur, wenn du ihn in den Arbeitszeiten einblendest.
- Kennzeichen an Terminen: „Abschluss offen“ (vergangene, nicht abgeschlossene Fahrstunde), „Warteliste-Angebot“, „Krank“, „🌴 Urlaub“.
- Unten: „Werkzeuge“ ▾ mit Kalender drucken, Buchungsseite anpassen, Terminvorschlag per WhatsApp senden, Buchungslink an Schüler senden, QR-Code anzeigen, Termine aus Screenshot übernehmen (Import + KI), Urlaub eintragen.
- **Ally-Leiste** (nur wo Ally freigeschaltet und an ist): „Frag Ally“ („Fragen, filtern, planen“) und „Planen“. Hat Ally den Kalender gefiltert, steht oben „Kalender gefiltert“ mit „Nur: …“ und „Alle zeigen“.
- Der Kalender aktualisiert sich selbst, wenn Schüler buchen, absagen wollen oder einen freien Termin übernehmen (kurze Meldung, Tipp öffnet den Kalender).

### 1.9 Einstellungen (Startliste)
Oben „Einstellung suchen…“, dann:
- **Darstellung**: Dark Mode, Schriftgröße (A− / A+).
- **Mein Bereich**: Profil, Arbeit & Ausbildung, Meine Unterlagen, Daten & Sicherung (für Nicht-Admins zusätzlich Funktionen ein/aus).
- **Fahrschule** (nur Fahrschul-Admin), in vier Gruppen:
  - Identität & Team: Meine Fahrschule, Team & Einladung, Standorte, Personalunterlagen, Allindrive Autopilot (öffnet den Autopilot), Fahrschul-Dashboard
  - Ausbildung & Struktur: Führerscheinklassen, Ausbildungsfahrt-Arten, Sonderfahrten-Soll, Funktionen ein/aus
  - Geld & Abrechnung: Kosten, Rechnungsdaten, DATEV-Export, Geschenkgutscheine, Fuhrpark & Auswertung
  - Recht & Datenschutz: Führerschein-Reform 2027, Löschprotokoll
- **Konto**: Konto, Abonnement, Gerät & Benachrichtigungen (nur in der iPhone-App), Hilfe & Support (KI-Support, Status „KI · antwortet sofort“ bzw. „N neue Antworten“), Info, Datenschutzerklärung, Impressum.
- Ganz unten „Abmelden“.
Der PIN und der Fahrschul-Code stehen nicht hier, sondern beim Schüler unter Schülerdaten (die Einstellungs-Suche weist darauf hin).

---

## 2. Aufgaben von A bis Z

### Schüler anlegen
1. Reiter „Schüler“ › „+ Schüler“ (braucht Internet).
2. Die App legt sofort einen leeren Schüler an und öffnet Schülerdaten › 🏕️ Basislager.
3. Unter „Stammdaten“ Vorname, Name, Geburtsdatum, Anmeldedatum, Handynummer, Festnetz, Anschrift, Führerscheinklasse, Theorieprüfung (Ersterwerb/Erweiterung), Standort / Filiale und Sehhilfe eintragen. Gespeichert wird automatisch.
4. Unter „Zugänge & Teilen“ den PIN vergeben und den Zugang schicken (siehe Abschnitt 2, Buchungslink und Fahrschul-Code).
- Die Führerscheinklasse bestimmt, welche ADK und Strecken der Schüler bekommt. Ohne Auswahl gilt die Standardklasse.
- Neue Schüler bekommen automatisch deinen Standort, wenn du ihn unter Einstellungen › Profil › „Mein Standort“ gewählt hast.
- Schüler aus einer anderen Software: unter „Ausbildung“ › „Bisherigen Stand eintragen“ (Fahrstunden bisher, Sonderfahrten in UE). Zählt zu Stunden und Sonderfahrten-Pflicht, wird nicht abgerechnet (Funktion „Bisheriger Stand“).

### Schüler aus Screenshot, Foto oder Excel übernehmen
Screenshot/Foto (braucht „Import“ und KI):
1. Schülerliste › Bild-Symbol („Schüler aus Screenshot“).
2. „Screenshots auswählen“ – ein oder mehrere Fotos (z. B. Anmeldeformular).
3. Ausgelesene Daten prüfen und „Schüler anlegen“ (oder „Anderen Screenshot“).

Excel/CSV aus der alten Software (Funktion „Import“, KI nicht nötig):
1. Schülerliste › Datei-Symbol („Bestand aus alter Software übernehmen“) › „Excel- oder CSV-Datei wählen“ (.xlsx oder .csv).
2. Die App erkennt die Spalten an den Überschriften. In der Vorschau „Spaltenzuordnung“ jede Spalte prüfen oder auf „– nicht importieren –“ stellen.
3. „N Schüler anlegen“ tippen und das Fenster offen lassen.
- Übernommen werden auch „Theorie bestanden“, „Fahrstunden gesamt“ und Überland/Autobahn/Dämmerung in UE. Straße, Hausnummer, PLZ und Ort aus getrennten Spalten werden zusammengesetzt.
- Schüler mit schon vorhandenem Namen werden übersprungen.
- Alles bleibt auf dem Gerät. Nur wenn keine Namensspalte erkannt wird, gehen Überschriften und fünf Beispielzeilen an die KI (wenn eingeschaltet).

Fahrschulwechsel innerhalb von Allindrive: Die alte Fahrschule öffnet beim Schüler ⋮ › „Fahrschulwechsel: Übergabecode“ (einmal einlösbar, befristet). Die neue Fahrschule: Schülerliste › Datei-Symbol › „Übergabecode einlösen“ › „Prüfen“ › „Schüler übernehmen“. Gefahrene Stunden zählen zur Sonderfahrten-Pflicht, werden aber nicht abgerechnet.

Termine aus der alten Software: Kalender › Werkzeuge › „Termine aus Screenshot übernehmen“ (am besten die Tagesansicht fotografieren).

### Neue Online-Anmeldungen
Wer sich über den Reiter „Anmelden“ der Buchungsseite anmeldet, steht oben in der Schülerliste („1 neue Anmeldung“) mit „✓ Übernehmen“ oder „Ablehnen“. Abgelehnte landen im Papierkorb. Die Online-Anmeldung lässt sich schulweit abschalten (Funktion „Online-Anmeldung“).

### Schüler archivieren, löschen, Papierkorb
Archivieren (Schüler bleibt mit allen Daten erhalten):
1. Schüler öffnen › ⋮ › „Als bestanden archivieren“.
2. Ist unter Arbeit & Ausbildung ein Bewertungslink hinterlegt, fragt die App, ob du um eine Bewertung bitten möchtest (WhatsApp, du sendest selbst).
- Zurückholen: Schülerliste › „Archiv (bestanden)“ aufklappen › Schüler öffnen › ⋮ › „Aus Archiv zurückholen (wieder aktiv)“.
- Die Karte „Aufräumen“ in der Schülerliste schlägt bestandene oder seit über einem Jahr inaktive Schüler vor („Archivieren“, „Alle N archivieren“, „Später“).

Löschen:
1. Schülerliste › grauer × auf der Schülerkarte (nur eigene Schüler).
2. Bestätigen. Hat der Schüler künftige Termine, fragt die App „Termine löschen“ oder „Behalten“ (behaltene bleiben ohne Schüler, mit Namen im Titel).
3. Direkt danach ist einmal „Rückgängig“ möglich, danach liegt der Schüler 30 Tage im Papierkorb.
- Hat der Schüler schon Rechnungen, wird er nicht gelöscht, sondern archiviert (Aufbewahrungspflicht).
- Endgültig weg sind sofort: hochgeladene Dokumente, Rückmeldungen zu Fahrstunden, Theorie-Anwesenheit.
- Gesperrt, solange für den Schüler eine Streckenaufzeichnung, Prüfungssimulation oder ein Schaltkompetenz-Test läuft.

Papierkorb: Schülerliste ganz unten › „Papierkorb“ (oder Schnellsuche „Papierkorb“) › „Wiederherstellen“ oder „Endgültig löschen“. Enthält gelöschte Schüler, abgelehnte Online-Anmeldungen und Interessenten, jeweils 30 Tage. Hochgeladene Dokumente kommen nicht zurück.

Löschung nach § 31 FahrlG: Fünf Jahre nach dem Jahresende der Archivierung erscheint im Archiv „Schüler mit abgelaufener Löschfrist“ › „Daten löschen“ › Namen eintippen › „Endgültig löschen“. Rechnungen und Zahlungen bleiben (10 Jahre steuerliche Aufbewahrung). Der Vorgang steht im Löschprotokoll.

### Schüler mit Kollegen teilen
1. Schüler öffnen › Schülerdaten › 🏕️ Basislager › Abschnitt „Zugänge & Teilen“.
2. Karte „Mit Kollegin/Kollegen teilen“: E-Mail der Kollegin oder des Kollegen eingeben › „Teilen“.
3. Freigabe aufheben: „Entfernen“ neben dem Namen.
- Die Person muss sich vorher einmal in der App registriert haben („Kein Konto mit dieser E-Mail gefunden“).
- Nur der Besitzer verwaltet die Freigabe. Der Kollege sieht den Schüler mit „geteilt“ und kann Einträge machen.
- Fahrschul-Admin und Büro können im Fahrschul-Dashboard „Zusätzlich freigeben“ oder den Schüler ganz umhängen („Als zuständig setzen“).
- Abschaltbar: Funktion „Schüler mit Kollegen teilen“.

### Termin anlegen
1. „+“ (Neuer Termin) in der unteren Leiste bzw. „Neuer Termin“ in der Seitenleiste – oder im Kalender auf einen Tag tippen (Termin gleich für diesen Tag).
2. Schüler (optional – ohne Schüler z. B. „Werkstatt“), Datum, Von, Bis. Die Dauer-Knöpfe setzen das Ende: 1 FS, 2 FS, 3 FS, 60 min, Prüfung.
3. Art wählen (farbig, gruppiert nach Fahrstunden, Sonderfahrten, Prüfungsteile, Theorie, Sonstiges).
4. Optional: Ziel der Stunde, Abholort (Vorschläge per Tipp, z. B. „Zu Hause“), Notiz, Fahrzeug, bei Theorieunterricht ein Thema.
5. „Termin anlegen“.
- „Sonstige Tätigkeit“ anhaken für alles, was keine praktische Ausbildung ist – zählt nicht zum Ausbildungslimit.
- Die App warnt bei Überschneidungen, doppelt verplantem Fahrzeug und überschrittenen Limits (dann lässt sich der Termin nicht bestätigen). Private Termine, sonstige Tätigkeiten und „Versetzt“ gehen auch bei vollem Tageslimit.
- Bei Dämmerungsfahrten weist die App auf die Uhrzeit des Sonnenuntergangs hin („Auf … Uhr setzen“).
- In der Schülerauswahl stehen nur eigene, nicht archivierte Schüler (alphabetisch) – mit dir geteilte und archivierte Schüler erscheinen dort nicht.
- Der Schüler bekommt automatisch eine Mitteilung in seiner App (auch bei Bestätigen, Verschieben, Absagen).
- Termine anlegen und ändern braucht Internet.

### Terminserie
1. Termin-Formular wie oben ausfüllen.
2. „Terminserie anlegen“ anhaken › Wiederholung „Wöchentlich“ oder „Alle 2 Wochen“ › „Anzahl Termine“.
3. „Serie anlegen“. Termine, die sich überschneiden oder ein Limit überschreiten, werden übersprungen; danach kommt eine Übersicht.

### Termin bearbeiten, verschieben, löschen
- Antippen eines Termins im Kalender öffnet die Auswahl: „Vor der Fahrt“ (Ziel, Notiz „Nächstes Mal“, Auffälligkeiten, Sonderfahrt-Stand, Prüfungswarnung, „Fahrstundenplan ansehen“), „Zum Abholort navigieren“, „Termin bearbeiten“, „Fahrstunde abschließen“ bzw. „Fahrstunde anlegen“, „Termin löschen“, „Abbrechen“.
- Verschieben: „Termin bearbeiten“ › Datum/Von/Bis ändern › „Speichern“. Ziehen per Maus gibt es nur im Team-Kalender (Fahrlehrerwechsel).
- In „Termin bearbeiten“ außerdem: „Bestätigung per WhatsApp senden“, „Als Kalender-Datei senden“, „Leistung erstellen“ (Leistungsnachweis mit Unterschrift), bei Theorieunterricht „Anwesenheit (QR-Check-in)“, bei vergangenen Terminen „Stunde im Tagebuch bewerten“.
- Löschen: „Termin löschen“ › „Löschen“. Warten Schüler auf einen früheren Termin, fragt die App danach „Termin ist frei geworden“ und bietet die Zeit der Warteliste an („Auf der Warteliste anbieten“, WhatsApp je Schüler, oder „Nicht anbieten“). Hatte der Schüler den Termin absagen wollen (Storno-Anfrage) und beginnt er innerhalb deiner Stornofrist, fragt die App dabei auch nach der Ausfallgebühr („Gebühr buchen“ oder „Kulanz“).
- Ein Schüler erscheint nicht: Schüler › Übersicht › Karte „Zuverlässigkeit“ › „+ melden“ (Notiz, optional Ausfallgebühr; Standardbetrag unter Einstellungen › Kosten).

### Terminart und Ausbildungsfahrt-Arten
- Feste Standardliste: ÜST Übungsfahrt (Vorauswahl), AB Autobahnfahrt, ÜL Überlandfahrt, NF Dämmerungsfahrt, GF Grundfahraufgaben, UW Unterweisung am Fahrzeug, AKH Abfahrtskontrolle/Handfertigkeiten, VS Versetzt, VT Vorstellung Theoretische Prüfung, PF Prüfungsfahrt, SF sonstige Fahrstunden, ST sonstige Tätigkeiten, STI Sonstige Tätigkeiten intern, T1–T3 Teilprüfungen, B197 Testfahrt B197, FPASF Fahrprobe ASF, SASF Seminarteilnahme ASF, TH Theorieunterricht, SIM Fahrsimulator, PRIVAT Privater Termin.
- Nur ÜL, AB und NF zählen als Sonderfahrten. SIM zählt als Fahrstunde, aber nie als Sonderfahrt.
- Standardmäßig nicht als Fahrstunde gezählt (UE-Zähler, Limits): PRIVAT, ST, STI, VS, TH, SASF, VT.
- Anpassen (nur Fahrschul-Admin): Einstellungen › Ausbildungsfahrt-Arten. Je Art Farbe, Bezeichnung und „Zählt zu den Fahrstunden“; „+ Art hinzufügen“ (Kürzel, Bezeichnung); unter „Weitere Standard-Arten“ fehlende Standardarten wie SIM wieder „+ Hinzufügen“. Gilt für alle Fahrlehrer der Fahrschule.

### Terminvorschlag an einen Schüler schicken
1. Kalender › Werkzeuge › „Terminvorschlag per WhatsApp senden“.
2. Schüler wählen, „Art der Stunde“, einen oder mehrere „Wunschtermine“ („+ weiterer Termin“).
3. „Vorschläge anlegen“ › „WhatsApp öffnen“. Der Schüler bestätigt über den Buchungslink.
- Offene Vorschläge stehen im Kalender als Anfrage und zählen je nach Einstellung beim Tageslimit mit (siehe Arbeitszeiten).

### Anfragen von Schülern annehmen oder ablehnen
1. Kalender: Fläche mit den offenen Anfragen › „Ansehen“ (oder auf der Startseite „Offene Terminvorschläge“, oder die Anfrage direkt im Kalender antippen).
2. „✓ Bestätigen“, „Ablehnen“ oder „Gegenvorschlag senden“ (bzw. im Termin „Andere Zeit vorschlagen“): neue Zeit wählen, der Schüler bekommt sie per WhatsApp mit Buchungslink.
3. Storno-Wunsch eines Schülers: „Stornierung bestätigen“ oder „Termin behalten“. Liegt die Absage innerhalb deiner Stornofrist, bietet die App „Gebühr buchen“ oder „Kulanz“ an und danach – wenn die Funktion „Warteliste & Lücken-Radar“ an ist – die Warteliste.
- Ab zwei offenen Vorschlägen: „Alle N auf einmal einplanen“ – die KI ordnet sie und begründet, was du annehmen solltest.
- Der Schüler bekommt jede Entscheidung als Mitteilung in seiner App.

### Buchungslink, Fahrschul-Code und Fahrschüler-App
- **Buchungslink**: Kalender › Werkzeuge › „Buchungslink an Schüler senden“ (Teilen-Menü) oder „QR-Code anzeigen“ (zum Ausdrucken/Aushängen). Darüber schlagen Schüler Wunschtermine vor, die du bestätigst. Den Begleittext legst du unter Einstellungen › Arbeit & Ausbildung › „Nachricht beim Buchungslink“ fest ({LINK} = Stelle des Links; „Zurücksetzen auf Standard“).
- **Fahrschul-Code** (für alle Schüler gleich) und **PIN** (je Schüler) stehen beim Schüler: Schülerdaten › 🏕️ Basislager › „Zugänge & Teilen“ › Karte „Fahrschülerbereich“. Schnellweg: Schnellsuche „Fahrschul-Code“, „Schülercode“ oder „PIN“.
1. Unter „Neuer PIN (4 bis 8 Ziffern)“ einen PIN eintippen oder „Zufälligen PIN erzeugen“ › „PIN speichern“.
2. Mit Handynummer in den Stammdaten: „Per WhatsApp an [Vorname] senden“ (Link, Name, PIN und Code in einer Nachricht). „Anders teilen“ öffnet das normale Teilen-Menü; ohne Handynummer heißt der Knopf „Fahrschülerbereich teilen“.
3. Beim ersten Login muss der Schüler den Start-PIN durch einen eigenen ersetzen.
- Ein gespeicherter PIN ist aus Sicherheitsgründen nicht mehr lesbar. Zum erneuten Teilen einen neuen PIN vergeben – der alte gilt bis dahin weiter. Hat der Schüler den eigenen PIN vergessen: neuen PIN vergeben, er wählt beim nächsten Login wieder einen eigenen.
- „Wird erzeugt, sobald du den Buchungslink das erste Mal teilst“: Der Fahrschul-Code entsteht erst beim ersten Teilen des Buchungslinks.
- Der Fahrschul-Code ist nicht der Einladungscode für Fahrlehrer (der steht unter Team & Einladung).

### Buchungsseite anpassen
Kalender › Werkzeuge › „Buchungsseite anpassen“: „Nachricht an deine Schüler (optional)“, „Nachricht anzeigen bis (optional)“, „Telefon für Rückfragen (optional)“ (erscheint mit „WhatsApp“ und „Anrufen“), „Anleitung „So funktioniert es“ ausblenden“ › „Speichern“. „Buchungsseite ansehen“ zeigt die Seite. Gilt für Buchungsseite und Schüler-App.

### Sofort-Buchung
Schüler › Übersicht › Karte „Zuverlässigkeit“ › „Sofort-Buchung erlauben“. Freie Termine innerhalb deiner Arbeitszeiten bucht dieser Schüler dann direkt fest, ohne deine Bestätigung. Der Server prüft trotzdem Überschneidungen, Limits und Arbeitszeit. Termine mit weniger als 2 Stunden Vorlauf bleiben immer eine Anfrage, die du bestätigst.

### Warteliste, Lücken-Radar und Woche planen
- Schüler tragen in ihrer App unter „Warteliste“ Wochentage und Zeitfenster ein, wann sie früher drankommen möchten (Funktion „Wunschzeiten“).
- Wird ein Termin frei (Löschen, bestätigte Absage), fragt die App „Termin ist frei geworden“ › „Auf der Warteliste anbieten“. Der Termin erscheint bei passenden Schülern als „Ein früherer Termin ist frei geworden!“ – wer zuerst „Jetzt sichern“ tippt, bekommt ihn. „Wen zuerst fragen?“ sortiert die KI.
- **Lücken-Radar**: Mehr › Fahrschule › Tagesgeschäft › Abschnitt „Lücken füllen“: freie Zeiten der nächsten 7 Tage, die zu wartenden Schülern passen › „Anbieten“ (legt ein Warteliste-Angebot an). Darüber „Ganze Woche füllen“ › „Wochenplan vorschlagen“ (KI; daraus werden Terminvorschläge, die der Schüler bestätigt).
- **Leerlauf verdichten** (Tagesgeschäft): Lücken ab 45 Minuten zwischen zwei Terminen desselben Tages in den nächsten zwei Wochen › „Verschiebungen vorschlagen“ (KI, gleicher Tag, gleiche Länge, du entscheidest je Schüler).
- Im Kalender bündelt „Planen“ (Blatt „Woche planen“: „Passt zur Warteliste“, „Leerlauf verdichten“) dasselbe. Wo Ally an ist, ersetzt Ally diesen Knopf.
- Abschaltbar: Funktion „Warteliste & Lücken-Radar“.

### Arbeitszeiten, Ausbildungslimit und Limit je Schüler
Einstellungen › Arbeit & Ausbildung:
1. „Meine Arbeitszeiten“ › „Wochentage & Zeiten“ aufklappen. Ohne Zeit ist ein Tag ganztägig buchbar, mit Zeit nur in diesem Fenster; das Kreuz sperrt einen Tag ganz. Sonntag ist für Schüler immer gesperrt; die Sonntagszeile steuert nur, ob Sonntag in deinem eigenen Kalender erscheint. Für dich selbst gelten diese Grenzen nicht.
2. „Mein Ausbildungslimit“: „Tageslimit in Minuten (z.B. 495)“ und „Wochenlimit in Minuten (0 = aus)“. Termine über dem Limit lassen sich nicht bestätigen. § 12 FahrlG erlaubt höchstens 495 Minuten praktischen Fahrunterricht am Tag.
3. Mit Tageslimit: „Vorschläge über … Min. am Tag zulassen“. Aus = offene Vorschläge zählen mit, ein voller Tag nimmt keine Vorschläge mehr an. An = Schüler können weiter vorschlagen, ausgebucht ist erst der Tag mit vollen bestätigten Terminen.
4. „Limit je Fahrschüler“: Tages- und Wochenlimit je Schüler in Minuten (0 = aus) – gilt für Buchungslink und eigene Termine.
- Gezählt wird die tatsächliche Dauer bestätigter Fahrstunden (auch mit angefragter Absage), Überschneidungen einmal. Urlaub, Krank, Privates, sonstige Tätigkeiten und Theorieunterricht zählen nicht. Welche Arten zählen, legt der Fahrschul-Admin unter Ausbildungsfahrt-Arten fest.
- „Arbeitszeitnachweis ansehen (§ 12 FahrlG)“ steht im selben Bildschirm (siehe Arbeitszeitnachweis).

### Urlaub eintragen
1. Kalender › Werkzeuge › „Urlaub eintragen“.
2. Zeitraum wählen; am ersten und letzten Tag lässt sich die Uhrzeit einschränken.
3. „Urlaub eintragen“. Die Tage sind über den Buchungslink komplett belegt und zählen nicht zu deinen Unterrichtsstunden. Im Kalender als „🌴 Urlaub“; ändern über den Termin › „Urlaub bearbeiten“.

### Fahrlehrer krank / Krankmeldung
1. Mehr › Fahrschule › Tagesgeschäft › rote Karte „Fahrlehrer krank“.
2. Tag wählen, die betroffenen Termine anhaken. Optional „Tag im Kalender als „Krank“ sperren – dann bucht niemand über den Buchungslink hinein“.
3. „Alle N Termine absagen“ (oder „Nur den Tag sperren“).
4. Danach je Schüler „WhatsApp“ mit fertigem Text antippen und selbst senden.
- Die frei werdenden Zeiten werden niemandem angeboten. Mit Ally: „Ich bin morgen krank“ öffnet die Krankmeldung für den richtigen Tag.
- Sagt ein Schüler krankheitsbedingt ab: seinen Termin im Kalender öffnen und löschen bzw. seine Storno-Anfrage bestätigen.

### Tagesgeschäft und Tagesabschluss
Mehr › Fahrschule › Tagesgeschäft (Funktion „Tagesgeschäft“): oben „Fahrlehrer krank“, dann „Heute“ mit „UE heute“, „Eingenommen heute“, „Noch zu bestätigen“ (vergangene Fahrstunden von heute: „✓ N Min“ bestätigt, „Nicht gefahren“ blendet aus, mit Rückgängig), „Zahlungen heute“, „Morgen“ (geplante Fahrstunden), „Geburtstage diese Woche“ (WhatsApp-Glückwunsch), „✨ Tages-Rückblick erstellen“ (KI). Darunter „Lücken füllen“ und „Leerlauf verdichten“.

### Fahrstunde abschließen (nach einem Termin)
Ist ein bestätigter Termin vorbei, öffnet die App von selbst „Fahrstunde abschließen“ (nur eigene Schüler, nur Arten, die als Fahrstunde zählen). Sonst: Termin antippen › „Fahrstunde abschließen“ – vergangene offene Termine tragen im Kalender „Abschluss offen“.
1. Dauer prüfen („wie geplant“; „Ändern“ für eine andere Minutenzahl). Weicht sie ab, passt sich das Terminende im Kalender an.
2. „Nächster Termin“ steht da, oder: „Per WhatsApp erinnern“ bzw. „Oder gleich selbst einplanen:“ (bis zu drei freie Zeiten).
3. Optional „Bewertung & Notiz“ › „Hinzufügen“: Bewertung je Kriterium, „Bewertung wie letztes Mal“, Thema („Ziel als Thema übernehmen“), „Woran nächstes Mal arbeiten?“.
4. „Abschließen“ (bzw. „Abschließen und Termin anlegen“). „Fand nicht statt“, wenn die Stunde ausfiel.
- Ergebnis: eine abrechenbare Fahrstunde in der Kasse (Preis aus der Preisliste nach § 32, Posten „Fahrstunde“ der Klasse, sonst Preis pro UE) und – wenn etwas eingetragen wurde – ein Fahrtenbuch-Eintrag. Die Notiz „Nächstes Mal“ erscheint vor der nächsten Stunde.
- Schon im Navigator abgeschlossene Stunden zeigen „schon im Ausbildungsnavigator eingetragen“.

### Fahrstunde erfassen ohne Termin
1. Schüler › Reiter „Kosten“ (Station Kasse) › Abschnitt „Gefahrene Fahrstunden“ › „+ Fahrstunde erfassen“.
2. Datum, Uhrzeit, Dauer, Art (z. B. „Normale Fahrstunde“; Überland/Autobahn/Dämmerung zählen automatisch zu den Sonderfahrten), „Preis pro UE für diese Stunde“ (vorbelegt aus Preisliste bzw. Preis pro UE).
3. „Speichern“.
- Löschen per ×; steht die Stunde schon auf einer Rechnung, geht das nur über eine Stornorechnung.
- Unterschied: Der „+“-Knopf „Neue Fahrstunde“ in den Ausbildungsansichten legt nur einen Fahrtenbuch-Eintrag (Tagebuch) an, keine abrechenbare Stunde.

### Fahrtenbuch (Fahrstunden) mit Bewertung
Schüler › Reiter „Fahrstunden“ (Funktion „Fahrstunden-Tagebuch“):
1. „+ Stunde“ (bzw. „+ Erste Stunde eintragen“) oder Eintrag antippen.
2. „Thema der Fahrstunde“, Bewertung in fünf Kriterien (Verkehrsbeobachtung, Fahrzeugpositionierung, Geschwindigkeitsanpassung, Kommunikation, Fahrzeugbedienung) mit 🙂 gut / 😐 mittel / 🙁 schlecht.
3. „Hinweis für den Schüler“ (sichtbar im Fahrschülerbereich), „Das lief gut“, „Was lief schlecht“, „Weitere Notizen“ (privat). Gespeichert wird beim Verlassen des Feldes.
- KI-Hilfen: „✨ KI-Entwurf“ (füllt leere Felder aus einem Stichwort), „✨ Tipp: So in den Griff bekommen“, „✨ ADK/Strecken-Vorschlag aus dieser Stunde“.
- „Selbsteinschätzung Schüler“: Was der Schüler in seiner App eingeschätzt hat, steht daneben (Funktion „Selbsteinschätzung“).
- „Fahrtenbuch durchsuchen“ ab 4 Einträgen.
- **Wiederkehrend auffällig**: Oben im Fahrtenbuch stehen Kriterien, die in den letzten Stunden wiederholt schlecht bewertet wurden (mindestens zweimal „schlecht“ oder im Schnitt sehr schwach). Erscheint erst ab einem echten Muster, nicht nach einem Ausrutscher.
- Export: Einstellungen › Daten & Sicherung › „Fahrtenbuch als CSV exportieren“.

### ADK abhaken
1. Schüler wählen › Reiter „ADK“ (oder Ausbildung › ADK).
2. Abschnitt antippen und die Kästchen der Punkte abhaken. Fahrzeugkunde hat statt Kästchen eine Stufenleiste.
3. Oben „Alles abhaken“ / „Alles zurücksetzen“; „Anzahl ändern“ ändert die Soll-Anzahl für alle deine Schüler dieser Klasse (und erlaubt Häkchen je Abschnitt auf einmal). Ab vielen Abschnitten gibt es „Abschnitt oder Punkt suchen“.
- Eigene Inhalte: Einstellungen › Arbeit & Ausbildung › „ADK & Strecken bearbeiten“ (gilt für alle deine Schüler). Hat der Fahrschul-Admin eine Vorlage hinterlegt, bietet die Übersicht „Vorlage übernehmen“ an.
- „Beim Abhaken nach Status fragen“ (Arbeit & Ausbildung): Titel antippen speichert Angesprochen/Geübt/Gekonnt mit Zeitstempel und Bewertung.
- Foto der Papier-ADK übernehmen: „ADK-Karte per Foto übertragen“ (Übersicht oder Schülerdaten; Import + KI).
- ADK aus (Funktionen ein/aus) = zählt nicht mehr zu Fortschritt und Prüfungsreife.

### Strecken
Schüler › Reiter „Strecken“: wie ADK mit eigenen Streckenpunkten und Sonderfahrten, „Anzahl ändern“, „Alles abhaken“. Der Gesamtfortschritt ist der höhere Wert aus ADK und Strecken. Sind ADK und Strecken beide aus, stehen alle Schüler bei 0 % und niemand wird prüfungsreif.

### Sonderfahrten und Sonderfahrten-Soll
- Fahrstunden mit Art ÜL (Überland), AB (Autobahn) oder NF (Dämmerung) zählen automatisch – aus Terminabschluss oder „Fahrstunde erfassen“. Die Übersicht zeigt die Kachel „Sonderfahrten“ mit erreichten UE und ob eine Doppelstunde fehlt.
- Soll festlegen (nur Fahrschul-Admin): Einstellungen › Sonderfahrten-Soll, je Klasse UE für Überland, Autobahn, Dämmerung. Klasse B ist mit 5/4/3 UE vorbelegt, andere Klassen musst du selbst eintragen – ohne Eintrag gibt es für die Klasse keine Kachel.
- Für die grüne Ampel muss je Art die UE-Zahl erreicht und mindestens eine Doppelstunde (90 Minuten am Stück) dabei sein.
- Mit Stichtag unter Einstellungen › Führerschein-Reform 2027 gelten für danach begonnene Ausbildungen die flexibleren Reform-Regeln (Kachel „Reform: neue Regeln“).

### Ausbildungsnavigator
Ausbildung › Navigator oder Reiter „Navigator“ beim Schüler (Funktion „Ausbildungsnavigator“, für alle an).
1. „Nächste Fahrstunde“: Ziel, Einstieg, passende Strecke und die Fahraufgaben – aus ADK, letzten Stunden und Termin-Länge. „Warum dieser Plan?“, „Fahraufgaben anpassen“ (+ ADK-Punkt, + Eigener Punkt), „Neu vorschlagen“ (KI, Funktion „Navigator: KI-Tipps“).
2. Während der Fahrt nichts tippen.
3. Danach „Stunde abschließen“: je Fahraufgabe „Eingeführt“, „Geübt“, „Unsicher“ oder „Sitzt“ (oder „Nicht dran“), „Das lief gut“, „Nächstes Mal“, „Bewertung (freiwillig)“ › „Speichern“. „Sitzt“ hakt den Punkt in der ADK ganz ab, „Geübt“ zählt eine Übung dazu; Unsicheres kommt zuerst wieder dran.
- Darunter: Ausbildungsverlauf (geschätzte Stufe), „Lernstand nach Prüfungsthemen“, „Überblick für die Übergabe“. Unter dem Plan stehen deine nächsten Fahrstunden.
- Praxistipps: „+ Eigenen Praxistipp“ („Nur für mich“ oder „Mit Fahrschule teilen“); Kollegentipps zeigt die Funktion „Navigator: Fahrschul-Tipps“.
- Der Navigator plant nur nach der ADK, nicht nach den Strecken. Ab etwa 15 Übungsstunden erinnert er an offene Sonderfahrten. Nach bestandener Praxisprüfung gibt es keinen Plan mehr.

### Prüfungssimulation
Ausbildung › Prüfungssimulation (Funktion „Prüfungssimulation“):
1. „Prüfungssimulation starten“.
2. Während der Fahrt unter „Was ist passiert?“ in eigenen Worten schreiben oder diktieren › „Festhalten“ (die KI teilt in Beobachtungen auf) – oder „+ Gut gemacht“ / „+ Fehler“: Prüfkriterium wählen, Formulierung antippen, Fahraufgabe freiwillig.
3. „Simulation beenden und bewerten“: Die App schlägt je der 5 Prüfkriterien eine Stufe vor und zeigt „Diese Fahrt wäre bestanden“ bzw. „Diese Fahrt wäre nicht bestanden“ (Gefährdung = nicht bestanden). Stufen per Tipp änderbar › „Speichern“.
- Läuft eine Simulation, zeigt eine rote Leiste „Prüfungssimulation · Name“ den Weg zurück. „Simulation abbrechen“ verwirft alles.
- „Bisherige Simulationen“ mit „PDF für den Schüler“ und „PDF für die Akte“; „Wiederkehrend auffällig“ über alle Simulationen. Die KI-Prüfreife-Einschätzung berücksichtigt die letzte Simulation.

### Schaltkompetenz
Ausbildung › Schaltkompetenz › „Schaltkompetenz-Test starten“ (für die Automatik-Ausbildung, Funktion „Schaltkompetenz“). Jeden Punkt (Anfahren, Bremsen, Schalten, Streckenelemente) antippen, sobald er dran war, mit Notiz › „Test abschließen“ › „Als PDF drucken“. „Test abbrechen“ verwirft die Bewertungen.

### Prüfreife-Ampel
- Grün „Prüfungsreif“: Gesamtfortschritt (ADK oder Strecken) mindestens 90 %, Theorie bestanden, Sonderfahrten erfüllt (wenn ein Soll hinterlegt ist, inklusive Doppelstunde je Art).
- Gelb „Fast so weit“: mindestens 80 %. Rot „In Ausbildung“: darunter.
- Sichtbar als Punkt am Profilbild, als Gruppe in der Schülerliste, im Filter „Prüfungsreif“ und in der Übersicht unter „Prüfungsreife“ mit der Checkliste „Voraussetzungen zur Prüfungsanmeldung“ (Theorieprüfung bestanden, Sonderfahrten erfüllt, Unterlagen vollständig, Konto ausgeglichen, Prüfungsreife festgestellt).
- Grüne Ampel heißt nur: rechnerisch bereit. Die Prüfungsreife stellst du nach einer Testfahrt fest: Übersicht › „Prüfungsreife amtlich feststellen“ (Test bestanden/nicht bestanden, Dauer) › später „Bestätigung als PDF“ oder „Zurücknehmen“. Alles steht mit Datum im Verlauf.
- „✨ KI-Prüfreife-Einschätzung erstellen“ gibt eine KI-Einordnung (nur mit KI).

### Prüfungsplanung, Prüfplätze und Prüfungsakte
- **Prüfungsakte**: Schülerdaten › Station „Prüfung“. Für Theorie und Praxis Schritt für Schritt: Voraussetzungen, Prüfungsreife („Prüfungsreife feststellen“), Prüfplatz („Prüfplatz eintragen“ / „Anderen Platz eintragen“), Kalender („In den Kalender eintragen“), Ergebnis („Bestanden“ / „Nicht bestanden“). Wer einen Prüfplatz bekommt, gilt als angemeldet.
- **Führerschein-Stand**: Station „Führersch.“ mit den Schritten Sehtest, Erste-Hilfe-Kurs, Biometrisches Passfoto, Antrag gestellt, Theorie-/Praxisprüfung angemeldet/bestanden, Prüfungsversuchen und „Fehlende Unterlagen per WhatsApp anfordern“.
- **Prüfungsplanung**: Mehr › Fahrschule › Auswertung › „Prüfungsplanung“ (Funktion „Prüfungsplanung“): „Anstehende Prüfungen“, „Bereit, nicht angemeldet“, „Sonderfahrten-Radar“ (nur noch Sonderfahrten fehlen), „Prüfplätze“.
- **Prüfplätze**: „+ Prüfplatz“ › Praxis/Theorie, Datum, Zeit und Ort (optional) › „Speichern“. Dann „Zuweisen“ › „Wer bekommt den Prüfplatz?“ › „Auswählen ›“ › „Per WhatsApp Bescheid geben“. Sagt TÜV/DEKRA ab: „TÜV-Absage“. Die App meldet nichts beim TÜV/DEKRA an.
- **Prüfungstag**: Die Startseite zeigt eine Checkliste und danach „Bestanden“ / „Nicht bestanden“ (mit „Glückwunsch per WhatsApp“, „Schlussrechnung“ bzw. „Neuen Prüfplatz“, „Übungsstunde planen“).
- Prüfungsquoten: Auswertung › Abrechnung › „Prüfungserfolg“ und „Quotenpilot öffnen“ (zählt nur erfasste Versuche).

### Theorie: Theoriepilot, Theorie-Lernstand, Anwesenheit
- **Theoriepilot** (Seitenleiste Fahrlehrer › Theoriepilot, am Handy Mehr › Lernen › Theoriepilot; Funktion „Theoriepilot“): „Theorie-Stand deiner Schüler“ (wer die Theorie offen hat, wer angemeldet ist), die 12 Grundstoff-Themen und der Zusatzstoff je Klasse. Je Thema Beiträge von Fahrlehrern („+ Beitrag teilen“) – sichtbar erst nach Freigabe durch den Fahrschul-Admin („Beiträge prüfen“). Bei Thema 5 gibt es Allindrive-Folien zum „Herunterladen“ (PowerPoint).
- **Theorie-Lernstand**: Schülerdaten › Station „Theorie“ (Funktion „Theorie-Lernstand“): Prozent und Stufe (Bereit für die Prüfung, Auf gutem Weg, Am Lernen, Noch nicht angefangen). Eine Frage „sitzt“ nach 4× in Folge richtig; eine falsche Antwort senkt den Stand. Grundlage ist „Theorie üben“ in der Schüler-App. „✨ KI-Fragen … generieren“ legt eigene Übungsfragen an (keine amtlichen).
- **Theorieunterricht und Anwesenheit**: Termin mit Art „TH · Theorieunterricht“ anlegen (Thema wählbar – Schüler sehen es in ihrer App und melden sich mit „Ich komme“ an). Im Termin › „Termin bearbeiten“ › „Anwesenheit (QR-Check-in)“: Thema und Klasse wählen › „Anwesenheit starten“ – ein QR-Code (15 Minuten gültig) zum Scannen in der Schüler-App. Angemeldete stehen oben („✓ da“), „Manuell hinzufügen“ für Schüler ohne App.
- Die besuchten Pflichtthemen erscheinen beim Schüler und auf dem gedruckten Ausbildungsnachweis – als Ergänzung zur eigenen Anwesenheitsliste, kein amtlicher Nachweis.
- Theorieprüfung bestanden: im Führerschein-Stand bzw. in der Prüfungsakte eintragen („Theorie bestanden am“ in den Stammdaten).

### Streckenaufzeichnung (GPS)
1. Schüler › Reiter „Fahrstunden“ › Eintrag öffnen › „Gefahrene Strecke“ › „Strecke aufzeichnen“.
2. Während der Fahrt zeigt eine rote Leiste „Aufzeichnung läuft · Name“ mit Strecke und Dauer. „Stecknadel“ markiert Stellen auf der Karte.
3. „Stoppen“ (in der Leiste) bzw. „Stoppen & speichern“ (im Eintrag). „×“ verwirft.
- Im Browser muss der Bildschirm an bleiben; bei App-Wechsel kann die Aufnahme abbrechen. Die iPhone-App zeichnet auch im Hintergrund auf.
- Nur eine Aufzeichnung gleichzeitig. Wurde die App mitten in der Aufnahme geschlossen, fragt sie beim nächsten Start: „Strecke speichern“, „Aufzeichnung fortsetzen“, „Verwerfen“ oder „Später entscheiden“.
- Schüler sehen ihre Strecken in der App. Abschaltbar: Funktion „Streckenaufzeichnung“.

### Rechnungen und Kasse
Die Kasse eines Schülers: Schüler › Reiter „Kosten“ (Station „Kasse“, Titel „Fahrten & Kosten“). Funktion „Rechnungen & Kasse“.
- Oben: Gesamt, bezahlt, „Offener Betrag“ bzw. „Guthaben“ oder „Vollständig bezahlt“.
- Abschnitte: „Gefahrene Fahrstunden“, „Posten“ („+ Posten hinzufügen“, „Beleg fotografieren“ (KI), Pauschalen aus der Preisliste, „Oder ein Paket übernehmen“), „Zahlungen“, „Rechnungen“, „Ausbildungsvertrag“.
Rechnung erstellen:
1. Kasse › „+ Rechnung erstellen“.
2. Offene Posten auswählen, optional „Vermerk auf der Rechnung“.
3. „Rechnung erstellen“ – fortlaufende Nummer der Fahrschule, PDF zum Drucken/Teilen.
- Korrigieren nur per „Rechnung stornieren“ (Stornorechnung mit eigener Nummer). Bei Firmenkunden zusätzlich „XRechnung“ (Beta). Firmenkunde: Stammdaten › „Firmenkunde (E-Rechnung)“ (Funktion „Firmenkunden (E-Rechnung)“).
- Sammelrechnung: Auswertung › Abrechnung › „Erbrachte Leistungen ohne Rechnung – ansehen und abrechnen“ › „Rechnungen für alle …“ › „N Rechnungen erstellen“. × nimmt eine Position dauerhaft aus der Liste („Nicht berechnen“), ohne den Saldo zu ändern.
- Auch Fahrschul-Admin und Büro können im Fahrschul-Dashboard in der Schülerakte Rechnungen erstellen und stornieren.

### Zahlung erfassen
1. Kasse › „+ Zahlung erfassen“.
2. Betrag, Datum, „Zahlungsart (optional)“ (vorbelegt „Bar“, z. B. Überweisung, PayPal) › „Hinzufügen“.
3. Optional „Beleg drucken“.
- Zu einer bestimmten Rechnung: Auswertung › Abrechnung › Rechnungen › „Zahlung“ – Restbetrag vorbelegt („wird auf Rechnung … gebucht“), Teilzahlung möglich.
- Löschen mit × (Rückfrage, 6 Sekunden rückgängig). Der offene Betrag steigt wieder.
- Kontoauszug: Auswertung › Abrechnung › „Zahlungen zuordnen“ – Umsätze aus dem Online-Banking einfügen › „Zeilen auswerten“. Zeilen mit Rechnungsnummer oder eindeutigem Namen und Betrag werden erkannt, sonst schlägt die KI vor. Gebucht wird erst nach deiner Bestätigung.
- Mit Ally (Funktion „Ally: Zahlungen“): „Lena hat 50 € bar bezahlt“ legt die Zahlung zum Erfassen bereit.

### Guthaben und Pakete
- Abrechnungsart der Fahrschule (Fahrschul-Admin): Einstellungen › Rechnungsdaten › „So rechnet deine Fahrschule ab“: „Offener Betrag“ (Leistungen werden später berechnet) oder „Guthaben“ (Schüler laden vorab auf, die Rechnung entsteht beim Aufladen, Stunden werden abgezogen). Je Schüler abweichend: Kasse › „Abrechnung für diesen Schüler“.
- Guthaben aufladen: Kasse › „Guthaben aufladen“ › Betrag oder „Oder ein Paket:“ › optional „Betrag schon erhalten (bar oder Karte) – gleich als bezahlt erfassen“. Ist das Guthaben aufgebraucht, meldet es die Startseite; buchen geht weiter.
- Pakete anlegen (Fahrschul-Admin): Einstellungen › Kosten › „Pakete“ › „+ Paket hinzufügen“ (Name, Festpreis, enthaltene UE). Beim Schüler übernommen, werden die UE von den nächsten Fahrstunden abgezogen („Paket-Guthaben“). „Paket-Guthaben knapp“ erscheint auf der Startseite.
- „Guthaben-Modus“ in der Kasse (Aus / Hinweis / Deckung nötig) steuert, ob eine offene Rechnung die Selbstbuchung des Schülers blockiert. Bei „Deckung nötig“ kann er erst nach Bezahlung wieder buchen oder vorschlagen.

### Gutscheine
1. Fahrschul-Admin: Einstellungen › Geschenkgutscheine › „+ Gutschein anlegen“ › Betrag, „Für wen?“, „Von wem?“ › „Anlegen und drucken“. Verkauft wird außerhalb der App (bar/Überweisung).
2. Einlösen: beim Schüler › Kasse › „Gutschein einlösen“ › „Gutschein-Code“ › „Einlösen“. Der Betrag wird als Zahlung gutgeschrieben.
- Funktion „Gutscheine“. Umsatzsteuer (Einzweck/Mehrzweck) mit dem Steuerberater klären.

### SEPA-Lastschrift
1. Fahrschul-Admin: Einstellungen › Rechnungsdaten › „Lastschrift (SEPA)“: Gläubiger-Identifikationsnummer (kostenlos bei der Deutschen Bundesbank) und IBAN des Geschäftskontos – „✓ Lastschrift ist eingerichtet“.
2. Mandat beim Schüler (Kasse, Karte „Lastschrift“): „Per Handy anfordern“ (der Schüler trägt in seiner App IBAN und Unterschrift ein) oder „Hier erfassen“ (vor Ort oder Papier-Mandat) › „Mandat speichern“.
3. Einziehen: Startseite „Rechnungen per Lastschrift einziehbar“, „Offene Rechnungen einziehen“ beim Schüler oder „Per Lastschrift einziehen“ bei den überfälligen Rechnungen › Fälligkeitstag wählen › „Bankdatei erstellen“.
4. Die XML-Datei (pain.008) im Online-Banking hochladen. Die Rechnungen gelten als bezahlt (Lastschrift).
- Platzt eine Lastschrift: beim Schüler unter Kasse die Zahlung „Lastschrift“ löschen, die Rechnung ist wieder offen. Die App zieht selbst nichts ein. Funktion „SEPA-Lastschrift“.

### Zahlungserinnerungen und Mahnungen
- Einzeln: Kasse › „Zahlungserinnerung senden“ (danach „2. Erinnerung senden“ usw., mit Stufe und Datum der letzten Erinnerung). Öffnet WhatsApp mit fertigem Text.
- Überfällige Rechnungen: Startseite „N überfällige Rechnungen“ oder Auswertung › Abrechnung › „Überfällig“ › „Erinnern“ – oder „Alle nacheinander erinnern“ („Per WhatsApp erinnern & weiter“, „Überspringen“, „Beenden“).
- Überfällig ab „Zahlungsziel“ (Einstellungen › Kosten, Standard 14 Tage).

### DATEV-Export
1. Fahrschul-Admin: Einstellungen › DATEV-Export: Beraternummer, Mandantennummer, Kontenrahmen SKR03/SKR04, Erlös-, Geld-, Kassen-, Gutschein- und Debitorenkonto, Sachkontenlänge.
2. Export: Auswertung › Abrechnung › Rechnungen › „DATEV (Vormonat)“ (daneben „CSV-Export“, Zeitraum „Dieser Monat“, „Dieses Jahr“, „Alle“).
- Ein Buchungsvorschlag im EXTF-Format – den ersten Export vom Steuerberater prüfen lassen.

### Kosten und Preisliste (§ 32)
Einstellungen › Kosten (nur Fahrschul-Admin):
- „Preis pro UE (45 Minuten)“ – Minuten werden in UE umgerechnet (60 Minuten = 1,33 UE).
- „Preisliste nach § 32 (Reformentwurf)“: je Führerscheinklasse 13 Posten, „Preise gültig ab“, „Preisliste als PDF erstellen“, als gemeldet markieren. Posten 5 „Fahrstunde“ ist zugleich der Abrechnungspreis für neu abgeschlossene Fahrstunden und Sonderfahrten ab „Gültig ab“; bereits erfasste Stunden bleiben. Simulatorstunden nutzen den Simulator-Preis, falls eingetragen.
- Außerdem: Empfehlungsbonus, Standard-Ausfallgebühr, KI-Schalter, Stornofrist, Zahlungsziel, Planungspuffer, Pakete.

### Ausgaben und Gewinn (nur Fahrschul-Admin)
Mehr › Fahrschule › Ausgaben & Gewinn (auch Auswertung › „Ausgaben & Gewinn“): „+ Ausgabe“ (Betrag brutto, Datum, Bereich, Beschreibung, Umsatzsteuer, Bezahlt per, „Beleg hinzufügen (Foto/PDF)“). Je Monat Einnahmen (Zahlungseingänge), Ausgaben und Überschuss/Verlust; Fahrzeugkosten aus dem Fuhrpark zählen automatisch mit. „Export für Steuerberater (CSV)“. Funktion „Ausgaben & Gewinn“.

### Fuhrpark
Mehr › Fahrschule › Fuhrpark (Funktion „Fuhrpark“):
- „Fahrzeug-Kalender“: Belegungsplan, Fahrzeuge buchen, teilbarer Link für Fahrlehrer ohne App (auch über Einstellungen › Fuhrpark & Auswertung).
- „Verwaltung“ (nur Fahrschul-Admin): „+ Fahrzeug hinzufügen“ (Bezeichnung, Kennzeichen, Automatik/Schaltwagen), Schalter „Insgesamt aktiv“ und „Kalender“.
- „Kosten & Service“ (nur Fahrschul-Admin): Kosten erfassen, TÜV/HU fällig, Kilometerstand, Service-Intervall, „Service erledigt“.
- Am Termin lässt sich ein Fahrzeug wählen; die App warnt, wenn es schon verplant ist.

### Arbeitszeitnachweis (§ 12 FahrlG)
- Fahrlehrer: Einstellungen › Arbeit & Ausbildung › „Arbeitszeitnachweis ansehen (§ 12 FahrlG)“.
- Fahrschul-Admin: im Fahrschul-Dashboard je Fahrlehrer und Monat.
- Grundlage sind die bestätigten Termine im Kalender: Arbeitstage, Fahrunterricht je Tag, Hinweis bei mehr als 495 Minuten. „Nachweis als Excel (CSV)“.

### Auswertung und Statistik
Mehr › Fahrschule › Auswertung („Zu Abschnitt springen“: Statistik, Prüfungsplanung, Abrechnung):
- Statistik (Funktion „Statistik“): Aktive Schüler, Prüfreif, Neu diesen Monat, Schüler nach Klasse, Umsatz pro Monat, Prüfungs-Erfolgsquote (1. Versuch), Ø Fahrstunden bis zur Praxisprüfung.
- Abrechnung (Funktion „Rechnungen & Kasse“): Umsatz, nicht berechnete Leistungen, „Zahlungen zuordnen“, Überfällig, Prüfungserfolg mit Quotenpilot, Offene Forderungen, Rechnungen mit Exporten.
- „Fahrlehrer-Auslastung“ (Fahrschul-Admin) und „Monatsabrechnung Fahrlehrer“ (Admin, alle Fahrlehrer) bzw. „Meine Monatsabrechnung“ (Fahrlehrer, nur eigene) mit Kalender-Aufschlüsselung und Excel-Export.

### Interessenten
Mehr › Fahrschule › Interessenten (Funktion „Interessenten“):
1. „+ Interessent“ (oder „Interessent aus Screenshot“, KI): Vorname, Nachname, Telefon, E-Mail, Klasse (Interesse), Status (Offen, Kontaktiert, Angemeldet, Abgesagt), „Warum abgesagt?“, „Wie kam die Anfrage?“, „Nächster Kontakt (optional)“, Notiz.
2. „✨ Nachricht vorschlagen“ (KI) und „In WhatsApp öffnen“.
3. Wird er Schüler: „Als Schüler übernehmen“ – danach zeigt die App die nächsten Schritte (PIN vergeben und Zugang schicken, Unterlagen anfordern, Ausbildungsvertrag erstellen, erste Fahrstunde planen).
- Fällige Wiedervorlagen erscheinen auf der Startseite. Rückruf-Wünsche aus dem Buchungs-Chat landen hier.
- Fahrschul-Admin und Büro pflegen im Fahrschul-Dashboard die Interessenten der ganzen Fahrschule und übergeben sie einem Fahrlehrer (Feld „Zuständiger Fahrlehrer“).
- Anfragen per E-Mail legt der Posteingang automatisch als Interessent an (Herkunft „E-Mail“, beim Fahrschul-Admin, der das Postfach verbunden hat), wenn die Regel „Interessenten anlegen“ an ist.

### Allindrive Autopilot (Posteingang und Belege mit KI)
Der Autopilot ist eine eigene Web-App für den Computer im Büro – nur Fahrschul-Admin und Büro, Anmeldung mit denselben Zugangsdaten wie in der App. In der App öffnet ihn: Mehr › Fahrschule › „Autopilot“, Einstellungen › Fahrschule › „Allindrive Autopilot“, Schnellsuche „Autopilot“ oder der Hinweis „N E-Mails im Autopilot brauchen dich“ auf der Startseite (ein reines Büro-Konto sieht ihn oben im Fahrschul-Cockpit). Bearbeitet werden E-Mails und Belege nur im Autopilot, nicht in der App.
Posteingang im Autopilot (Funktion „Posteingang im Autopilot (KI)“ an und KI der Fahrschule an):
1. Postfach verbinden (nur Fahrschul-Admin, im Autopilot unter Einstellungen › Postfach): Anbieter wählen (IONOS, STRATO, Telekom, GMX, WEB.DE, Gmail oder „Anderer Anbieter“ mit Server und Port für IMAP und SMTP), E-Mail-Adresse, Passwort des Postfachs, Absendername › „Verbinden“. Abholen und Senden werden sofort geprüft. Gmail braucht ein App-Passwort; bei GMX und WEB.DE muss „POP3/IMAP-Abruf“ im Postfach erlaubt sein; bei T-Online das E-Mail-Passwort aus dem Kundencenter. Outlook/Microsoft 365 geht noch nicht.
2. Steckbrief ausfüllen (Autopilot › Einstellungen › „Steckbrief für die KI“): Angebot, Theoriezeiten, Anmeldung, Unterlagen, Preise, Zahlung, Bürozeiten, Telefon. Preise, Pakete, Standorte und Klassen aus den Einstellungen der App kennt die KI schon. Nur damit beantwortet sie Anfragen selbst.
3. Der Autopilot holt alle fünf Minuten neue E-Mails ab (nur was nach dem Verbinden eingeht). Die KI ordnet jede ein (Interessent, Fahrschüler, Eltern, Rechnung & Zahlung, Prüfung & Behörde, Bewerbung, Geschäftlich, Werbung, Sonstiges) und schreibt einen Entwurf.
4. Selbst antwortet die KI nur auf allgemeine Anfragen von Interessenten, die der Steckbrief vollständig beantwortet – mit einem Hinweis unter der Antwort, dass sie von einer KI stammt. Nicht automatisch: alles mit Schülern, Eltern, Rechnungen und Zahlungen, Prüfungen, Absender, die wie ein Schüler heißen, E-Mails älter als drei Tage, Lücken im Entwurf, Links, die nicht im Steckbrief stehen, Absender, die der Mailserver nicht bestätigt (vermutlich gefälscht), mehr als zwei automatische Antworten an denselben Absender in 24 Stunden, Gesundheitsangaben (gehen gar nicht an die KI), Autopilot aus oder Tageslimit erreicht.
5. Filter: „Braucht dich“, „KI-Antworten“, „Erledigt“, „Alle“. Ein Klick zeigt die E-Mail, warum sie bei dir liegt und den Entwurf: anpassen › „Senden“ (geht über euer Postfach an den Absender; eine Kopie landet, wenn der Anbieter es zulässt, im Ordner „Gesendet“). Stellen mit „[bitte ergänzen …]“ müssen vorher ersetzt werden. Außerdem „Erledigt“, „Spam“, „Wieder vorlegen“, bei beantworteten „Noch einmal antworten“. Nach „Senden“ oder „Erledigt“ öffnet sich gleich die nächste E-Mail, die dich braucht.
6. Regeln (Autopilot › Einstellungen, nur Fahrschul-Admin): „KI antwortet selbst“, „Interessenten anlegen“, „Höchstens am Tag“ (automatische Antworten pro Tag), „E-Mails abholen“ (aus = pausiert), „Neu verbinden“ (z. B. nach Passwortwechsel), „Postfach trennen“ (löscht das gespeicherte Passwort, bisherige E-Mails bleiben sichtbar).
- Probleme: Zeigt der Autopilot „Abholen klappt gerade nicht …“, stimmt meist das Passwort nicht mehr › „Neu verbinden“. Nach drei Tagen mit Fehlern pausiert das Abholen von selbst; „Neu verbinden“ startet es wieder. Kommen keine E-Mails an: prüfen, ob „E-Mails abholen“ an ist und die Mails im Posteingang-Ordner (nicht in Unterordnern) liegen. Automatische Antworten, Rückläufer und Newsletter beantwortet die KI nie.
Buchhaltung im Autopilot (nur Fahrschul-Admin, Funktion „Ausgaben & Gewinn“ an): Belege als PDF oder Foto hineinziehen oder Rechnungen, die per E-Mail kommen – die KI liest Lieferant, Datum, Betrag, Umsatzsteuer und Kategorie aus, gebucht wird erst mit „Als Ausgabe übernehmen“. Dazu „Ausgaben & Einnahmen“ (Jahr, Monate, CSV) und „Monatsabschluss“ (Belege prüfen, Belege zu allen Ausgaben, CSV für den Steuerberater). Es sind dieselben Daten wie „Ausgaben & Gewinn“ in der App.

### Rundnachricht
1. Schülerliste › Megafon-Symbol („Nachricht an Schüler senden“).
2. „An wen?“ (alle oder Gruppe, z. B. Alle aktiven, Prüfungsreif, Ohne nächsten Termin, eine Klasse, ein Standort; Empfänger anpassbar) und Nachricht; Vorlagen z. B. „Fahrschule geschlossen“, „Theorie-Termin“, „Unterlagen“.
3. Senden – erscheint in der Schüler-App unter „Mitteilungen“. Danach optional „Zusätzlich per WhatsApp“ („In WhatsApp öffnen & weiter“).
- Höchstens 1000 Zeichen und 10 Rundnachrichten pro Tag. Schüler ohne App-Zugang sind markiert. Funktion „Rundnachricht“.

### Ausbildungsverträge
1. Kasse › „+ Ausbildungsvertrag erstellen“ (ohne Preis pro UE fragt die App nach).
2. Unterschreiben: „Unterschreiben“ (vor Ort) oder „Per Handy unterschreiben lassen“ – der Schüler bekommt eine Nachricht und unterschreibt in seiner App („Liegt in der App des Schülers zur Unterschrift“, „Erneut senden“). Danach fehlt ggf. noch deine Unterschrift.
- Vertrag mit Klasse, Kosten (zuletzt gewähltes Paket), Kündigungsregelung und Widerrufsbelehrung. „Weicht von aktueller Klasse/Preis ab“ zeigt Änderungen seit Vertragserstellung. Funktion „Ausbildungsverträge“.

### Eltern-Link und Zahler-Zugang
- **Eltern-Link** (vom Schüler erstellt): In der Schüler-App unter „Für deine Eltern“ › „Link erstellen“ › „Link senden“. Eltern sehen Ausbildungsstand und nächste Termine – ohne Noten, Notizen, Kosten. „Sperren“ beendet den Link.
- **Zahler-Zugang** (vom Fahrlehrer): Schülerdaten › Zugänge & Teilen › „Zahler-Zugang“ › „Zugang erstellen & teilen“. Zeigt nur Rechnungen und Zahlstatus. „Widerrufen“ macht den Link ungültig. Funktion „Zahler-Zugang“.

### Empfehlungsprogramm
Schülerdaten › Zugänge & Teilen › „Empfehlungsprogramm“: „Code erzeugen“ › „Teilen“. Gibt ein Freund den Code bei der Online-Anmeldung an, bekommen beide den Empfehlungsbonus als Gutschrift (Höhe: Einstellungen › Kosten, Standard 20 €). Nachträglich: „Empfehlungscode eines Freundes nachtragen“ › „Bonus gutschreiben“. Funktion „Empfehlungsprogramm“.

### Dokumente beim Schüler
Schülerdaten › Station „Führersch.“ › „Dokumente“: „+ Datei“ (Foto oder PDF), „Dokumente laden“ zum Ansehen. Schüler schicken Sehtest, Erste-Hilfe-Nachweis und Passfoto selbst per „Foto senden“ in ihrer App (Funktion „Unterlagen hochladen“); die Startseite meldet neue Unterlagen, „Passt – abhaken“ hakt sie ab. Fehlende Unterlagen: „… per WhatsApp anfordern“.

### Kalender abonnieren (iCal)
1. Einstellungen › Daten & Sicherung › „Kalender abonnieren“ › „Abo-Link erzeugen“.
2. „In Kalender-App öffnen“ oder „Kopieren“ (Apple Kalender, Google Kalender, Outlook). Danach aktualisiert sich alles selbst; enthalten sind deine bestätigten Termine.
- „Link erneuern“ macht den alten ungültig (neu abonnieren nötig), „Deaktivieren“ beendet das Abo. Einzelner Termin: Termin bearbeiten › „Als Kalender-Datei senden“. Funktion „Kalender abonnieren“.

### Push-Benachrichtigungen und Widget (nur iPhone-App)
- Einstellungen › Gerät & Benachrichtigungen. „Aktiv“: neue Anfragen, Stornos und die Erinnerung für morgen (abends gegen 18 Uhr) kommen als Benachrichtigung; auch wenn ein Schüler einen freien Termin übernimmt.
- Keine Benachrichtigung über eigene Aktionen (z. B. wenn du selbst bestätigst).
- Widget: Homescreen lange drücken › „Widget hinzufügen“ › Allindrive – zeigt die heutigen Termine.

### Erinnerungen an Schüler per WhatsApp
- Startseite „N Fahrstunden morgen erinnern“ › „Erinnerungen für morgen“: je Schüler „WhatsApp“ – du drückst selbst auf Senden, die App verschickt nichts von allein. Erinnerte werden gemerkt („Zurücksetzen“ möglich). Eigener Text: Arbeit & Ausbildung › „Erinnerung an Fahrstunden“ (Platzhalter {NAME}, {DATUM}, {ZEIT}, {SCHULE}).
- „Schüler ohne nächsten Termin“ und „Lange nicht gefahren“ (Startseite) bieten „Erinnern“ mit Buchungslink.
- Automatische Mitteilungen in der Schüler-App bei neuem, bestätigtem, verschobenem oder abgesagtem Termin kommen ohne dein Zutun.

### Team und Einladung (Fahrschul-Admin)
1. Einstellungen › Team & Einladung › „Einladungscode für neue Fahrlehrer“ › „Kopieren“ oder „Per WhatsApp teilen“ (App-Link, Code und Anleitung).
2. Der neue Fahrlehrer: „Registrieren“ › E-Mail, Passwort › bei „Deine Fahrschule“ „Einladungscode“ wählen und eintragen › „Konto erstellen“. Wer „Neu gründen“ wählt, wird Admin einer neuen Fahrschule.
3. „Neuen Code erzeugen“ macht den alten ungültig.
- Büro-Recht: im selben Bildschirm unter „Team & Rollen“ › „Zum Büro machen“ / „Büro entziehen“.
- Personalunterlagen für einzelne Fahrlehrer: Einstellungen › Personalunterlagen (sieht nur der Fahrlehrer selbst unter „Meine Unterlagen“ und der Admin).

### Standorte
Fahrschul-Admin: Einstellungen › Standorte › „+ Standort hinzufügen“ (Name der Filiale, Straße und Hausnummer, PLZ, Ort, Telefon, E-Mail). Zuordnung: beim Schüler unter Stammdaten „Standort / Filiale“; eigener Standort unter Profil („Alle Schüler ohne Standort auf meinen setzen“). Ab zwei Standorten filtern Schülerliste und Team-Kalender nach Standort. Löschen entfernt die Zuordnung bei den Schülern.

### Führerscheinklassen
Fahrschul-Admin: Einstellungen › Führerscheinklassen › „+ Klasse hinzufügen“ (z. B. B197) oder entfernen (Warnung, wenn Schüler die Klasse haben). Die Klasse eines Schülers steuert ADK, Strecken, Sonderfahrten-Soll und Preisliste. Eigene ADK/Strecken je Klasse: Arbeit & Ausbildung › „ADK & Strecken bearbeiten“.

### Fahrschul-Dashboard und Team-Kalender (Fahrschul-Admin und Büro)
- Mehr › Fahrschule › Fahrschul-Dashboard: Kennzahlen je Zeitraum (Unterrichtseinheiten, Umsatz, Auslastung je Fahrlehrer, Umsatz & Vergütung, Prüfungsquoten, Offene Posten, Klassen, Fahrzeugnutzung, Team-Aktivität), „Schüler zuteilen“ (Suchen › „Zuteilen“ › „Als zuständig setzen“ oder „Zusätzlich freigeben“), Arbeitszeitnachweis, Interessenten, „Letzte Änderungen“. In der Schülerakte: „Stammdaten bearbeiten“, Unterlagen abhaken, „Zahlung erfassen“, Rechnungen erstellen/stornieren.
- Das Büro sieht kein Umsatz-/Vergütungsfeld und keine Ausbildungsnotizen.
- Mehr › Fahrschule › Team-Kalender: eine Spalte je Fahrlehrer für einen Tag. Fahrstunde auf eine andere Spalte ziehen oder antippen › „Umhängen zu“. Die App prüft Überschneidungen und das 495-Minuten-Limit, gibt dem neuen Fahrlehrer Zugriff und protokolliert. Beide Fahrlehrer bitte selbst informieren – eine automatische Nachricht gibt es nicht. Private Termine und Urlaub erscheinen nur als belegte Zeit; Standort-Filter ab zwei Standorten.

### Funktionen ein/aus
Einstellungen › Funktionen ein/aus:
- Jeder Fahrlehrer: „Für mich“ – blendet Funktionen nur in der eigenen Ansicht aus (auf allen eigenen Geräten).
- Fahrschul-Admin zusätzlich „Für die Fahrschule“ – gilt für alle Fahrlehrer, das Büro und bei den Schüler-App-Funktionen für die Schüler. Schüler-App-Funktionen (Lernvideos, Begleitetes Fahren (BF17), Online-Anmeldung, Theorie üben, Wunschzeiten, Selbsteinschätzung, Profilbild, Unterlagen hochladen) gibt es nur schulweit.
- Gruppen: Startseite, Schülerliste, Schülerakte, Ausbildung, Kalender, Geld, Fahrschule, Schüler-App. Suche „Funktion suchen…“, „Alles wieder einschalten (N aus)“.
- Schulweit ausgeschaltete Funktionen stehen bei „Für mich“ grau mit „Für die ganze Fahrschule ausgeschaltet“.
- Ausschalten löscht keine Daten; beim Einschalten ist alles wieder da. Standard ist alles an.

### KI-Schalter der Fahrschule
Fahrschul-Admin: Einstellungen › Kosten › „KI-Funktionen für die Fahrschule“. Aus: KI-Helfer, Briefings, Foto-Erfassung, Buchungs-Chat und Theorie-Erklärungen sind für alle Konten der Fahrschule gesperrt, es gehen keine Daten an den KI-Anbieter (gilt auf dem Server). Standard: an. Einzelne Fahrlehrer können die KI für sich unter Funktionen ein/aus › „KI-Helfer“ ausblenden.

### Ally (Pilot)
Ally ist die KI-Assistentin. Es gibt sie nur in Fahrschulen, für die Allindrive den Pilot freigeschaltet hat, und nur mit eingeschalteter KI. Dann ist sie für alle an und ersetzt den KI-Helfer: der runde Knopf unten rechts („Ally fragen“) öffnet überall Ally; im Kalender gibt es die Ally-Leiste mit „Planen“. Beim ersten Öffnen kommt eine Einweisung („Verstanden – Ally starten“). Fragen zur Bedienung gibt Ally an den Support weiter (Knopf „Im Support fragen“) und öffnet auf Wunsch die passende Seite (Knopf „Öffnen“, z. B. den Navigator eines Schülers). Abschalten: Funktionen ein/aus › „Ally – KI-Assistentin“, „Ally: Zahlungen“, „Ally: ADK und Strecken“. Details siehe Abschnitt 5.

### Hilfe & Support (KI-Support)
Für alle Fahrlehrer, auch ohne Ally.
1. Mehr › Einstellungen › „Hilfe & Support“ (oder Schnellsuche „Hilfe & Support (KI)“; mit Ally über „Im Support fragen“).
2. Frage eintippen („Was möchtest du wissen? Was klappt nicht?“) › „Frage senden“ – oder ein Beispiel antippen.
3. Die Antwort kommt mit Schritt-für-Schritt-Anleitung, oft mit Knopf „Öffnen“, der die richtige Stelle der App öffnet.
4. „Hat das geholfen?“ › „Ja“ oder „Noch nicht“. Bei „Noch nicht“ das Problem genauer beschreiben oder „An Allindrive weitergeben“.
- Kann der Support etwas nicht lösen, gibt er es selbst an Allindrive weiter („An Allindrive weitergegeben. Die Antwort erscheint unter „Anfragen“.“).
- „Anfragen“ (oben im Support): eigene Anfragen mit Status (Offen, Beantwortet, Gelöst, Bei Allindrive, Erledigt) und Kennzeichen „Neue Antwort“; „Weiter schreiben“, „Neue Frage stellen“. Neue Antworten zeigt auch die Zeile in den Einstellungen („1 neue Antwort“).
- Ist die KI der Fahrschule ausgeschaltet, geht die Nachricht ohne KI direkt an Allindrive; die Antwort erscheint unter „Anfragen“.
- Fragen mit Gesundheitsangaben schickt die App nicht an die KI – bitte ohne dieses Wort formulieren. In der Demo ist der Support nicht aktiv.

### Daten und Sicherung
Einstellungen › Daten & Sicherung:
- „Backup herunterladen“ – alle deine Schülerdaten als Sicherungsdatei aufs Gerät. Ein Einspielen über die App gibt es nicht.
- „Fahrtenbuch als CSV exportieren“.
- „Für Excel exportieren“: Schülerliste, Rechnungen, Zahlungen, Termine (CSV für Excel, Numbers, LibreOffice).
- „Kalender abonnieren“ (siehe oben).
- Die Daten liegen in der Cloud und sind auf allen Geräten verfügbar.

### Konto und Abonnement
- Einstellungen › Konto: „Angemeldet als …“, „Passwort ändern“, „Konto löschen …“. Passwort vergessen: auf der Anmeldeseite „Passwort vergessen?“.
- Einstellungen › Abonnement: Status („Lifetime-Zugang“, „Kein Abo hinterlegt“ oder Monatsbeitrag mit „Zuletzt bezahlt“). „Jetzt mit PayPal bezahlen“ (bzw. „Geld senden“ in der PayPal-App), danach „Ich habe bezahlt“.
- Mit eingerichtetem Monatsabo stimmt der Fahrlehrer erst zu („Ich bin einverstanden · 7 Tage testen“). Nach 7 Tagen ohne Zahlung oder über 31 Tage nach der letzten Zahlung wird der Zugriff pausiert („Testzeitraum abgelaufen“); die Daten bleiben und sind nach der Zahlung sofort wieder da.
- Abo-Beträge, Lifetime-Zugang und das Theorie-Zusatzpaket stellt nur Allindrive ein.

### Konto löschen
1. Einstellungen › Konto › „Konto löschen …“.
2. „Weiter zur Bestätigung“ › „LÖSCHEN“ eintippen › „Konto endgültig löschen“.
- Gelöscht werden Anmelde-Konto, eigene Schüler mit Fahrstunden, Terminen, Unterschriften und Dateien sowie eigene Lehrvideos (auch für Kollegen).
- Gibt es Rechnungen (Aufbewahrungspflicht) oder mit Kollegen geteilte Schüler, wird nichts gelöscht – die App erklärt, was vorher zu klären ist.
- Fahrschul-Admins mit Kollegen: Admin-Rolle vorher über den Support übertragen lassen. Vorher ggf. Backup sichern.

### Datenschutz: Auskunft und Löschprotokoll
- Datenauskunft (Art. 15 DSGVO): Schüler › ⋮ › „Datenauskunft (DSGVO)“ › „Als PDF drucken“ oder „Als Datei speichern“. Enthält alle gespeicherten Daten inklusive Termine bei Kollegen und Theorie-Anwesenheit; der PIN steht nie im Klartext darin.
- Löschung nach § 31 FahrlG: siehe Abschnitt 2, Schüler archivieren und löschen. Nachweis: Einstellungen › Löschprotokoll (Fahrschul-Admin). Einträge lassen sich nicht entfernen.
- Datenschutzerklärung und Impressum: Einstellungen › Konto. Buchungsseite und Schüler-App zeigen Impressum, Datenschutz und Erklärung zur Barrierefreiheit unten.

---

## 3. Rollen und Rechte

- **Fahrlehrer**: eigene Schüler, eigener Kalender, Buchungslink, Kasse und Rechnungen der eigenen Schüler. In den Einstellungen nur „Mein Bereich“ und „Konto“. Funktionen ein/aus nur „Für mich“. Nutzt Preise, Klassen, Terminarten und Fahrzeuge der Fahrschule, ändert sie aber nicht. In der Auswertung „Meine Monatsabrechnung“.
- **Geteilte Schüler**: Wer einen Schüler geteilt bekommt, kann Einträge machen (ADK, Fahrstunden usw.), sieht ihn mit „geteilt“, verwaltet aber die Freigabe nicht. Archivieren, Löschen, Datenauskunft und KI-Übergabe-Einschätzung kann nur der Besitzer. Im Termin-Formular stehen geteilte Schüler nicht zur Auswahl.
- **Fahrschul-Admin (Inhaber)**: alles unter Einstellungen › Fahrschule (Meine Fahrschule, Team & Einladung, Standorte, Personalunterlagen, Führerscheinklassen, Ausbildungsfahrt-Arten, Sonderfahrten-Soll, Funktionen ein/aus „Für die Fahrschule“, Kosten inkl. KI-Schalter, Rechnungsdaten, DATEV-Export, Geschenkgutscheine, Fuhrpark & Auswertung, Führerschein-Reform 2027, Löschprotokoll). Dazu Fahrschul-Dashboard, Team-Kalender, Ausgaben & Gewinn, Fuhrpark-Verwaltung, Fahrlehrer-Auslastung, Monatsabrechnung aller Fahrlehrer mit Vergütung, Theoriepilot-Beiträge freigeben und das Büro-Recht vergeben („Zum Büro machen“). Wer beim Registrieren „Neu gründen“ wählt, wird Admin der neuen Fahrschule.
- **Büro**: tritt mit dem Einladungscode bei und bekommt das Recht vom Admin. Sieht alle Schüler der Fahrschule (Fahrschul-Dashboard, Team-Kalender), teilt sie Fahrlehrern zu, hängt Termine um, hakt Unterlagen ab, erfasst Zahlungen, erstellt und storniert Rechnungen, korrigiert Stammdaten (mit Protokoll) und pflegt Interessenten der Fahrschule. Kein Zugriff auf Ausbildungsnotizen, Umsatz und Vergütung, keine Fahrschul-Einstellungen. Ein reines Büro-Konto startet im Fahrschul-Cockpit.
- **Nur Allindrive (Betreiber)**: weitergegebene Support-Anfragen beantworten (Support-Zentrale), einen Fahrlehrer zum Fahrschul-Admin machen oder das Recht entziehen, einen Fahrlehrer aus der Fahrschule lösen („stilllegen“), Pilotfunktionen wie Ally freischalten, Abo-Status, Monatsbeitrag, Lifetime-Zugang und Theorie-Zusatzpaket setzen, Konten verwalten. Will ein Admin sein Konto löschen, muss die Admin-Rolle vorher über den Support übertragen werden.

---

## 4. Fahrschüler-Seite

### Zugang
- **Buchungsseite** (Link oder QR-Code vom Fahrlehrer): Reiter Termine, Fortschritt, Lernen (wenn Lernvideos an), Anmelden (wenn Online-Anmeldung an), Mitte-Knopf „Termin anfragen“. Ohne Anmeldung können Schüler Termine mit Vor- und Nachname anfragen. Unter „Fortschritt“ („Mein Fortschritt“) melden sie sich mit Vorname, Nachname und PIN an.
- **App „Allindrive für Fahrschüler“**: einmal Fahrschul-Code, Name und PIN eingeben, danach bleibt man angemeldet. Groß-/Kleinschreibung und Leerzeichen im Code sind egal. Reiter Start, Termine, Fortschritt, Lernen, Üben (Begleitetes Fahren, wenn an), Mitte-Knopf „Termin anfragen“. „Theorie üben“ und Übungsfahrten gibt es nur in der App.
- Beim ersten Login ersetzt der Schüler den Start-PIN durch einen eigenen („Eigenen PIN festlegen“). Sprachen: Deutsch, Englisch, Türkisch, Russisch.
- Ohne PIN („Noch nicht angemeldet“) gibt es nur Terminanfragen, keinen Ausbildungsstand.

### Was Schüler tun können
- **Termine anfragen**: Tag und Uhrzeit (15-Minuten-Schritte) wählen, auch mehrere Wunschtermine auf einmal. Belegte Zeiten sind als „belegt“ markiert. Der Fahrlehrer bestätigt; mit Sofort-Buchung ist der Termin direkt fest (außer unter 2 Stunden Vorlauf).
- **Absagen**: bestätigten Termin „stornieren“ – der Fahrlehrer muss die Stornierung bestätigen („Storno angefragt“). Innerhalb der Stornofrist erscheint vorher der Hinweis auf eine mögliche Ausfallgebühr. Offene Anfragen lassen sich löschen.
- **Warteliste**: Wochentage und Zeitfenster eintragen; frei werdende Termine erscheinen oben mit „Jetzt sichern“.
- **Fortschritt**: Ausbildungsstand (ADK/Strecken), Fahrstunden mit Hinweis des Fahrlehrers und aufgezeichneten Strecken, Erfolge, „Dein nächster Schritt“, „Unterlagen für die Prüfung“ („Foto senden“), Selbsteinschätzung nach der Stunde („Wie war die Stunde für dich?“), Profilbild, Abholort und „Ziel der Stunde“ der nächsten Fahrstunde.
- **Mitteilungen**: neue, bestätigte, verschobene, abgesagte Termine, Antworten auf Absagen und Rundnachrichten.
- **Unterschreiben**: Ausbildungsvertrag („Lesen und unterschreiben“) und SEPA-Mandat („IBAN eintragen“, „Mandat erteilen“).
- **Theorie**: „Theorie üben“ (Themen, „Probeprüfung“, „Fällige wiederholen“, „Markierte Fragen“, Lernstand, „✨ Erklär mir das“), nächste Theoriestunden mit „Ich komme“, QR-Check-in im Unterricht.
- **Für deine Eltern**: Eltern-Link erstellen und sperren.
- **Üben** (Begleitetes Fahren ab 17): Übungsfahrten mit Begleitperson planen, aufzeichnen und eintragen; das Fahrtenbuch ist kein amtlicher Nachweis.
- **„Frag uns“**: KI-Chat zu Fragen rund um die Fahrschule (nicht bei ausgeschalteter KI). Auf der öffentlichen Seite kann man „Rückruf anfordern“; die Anfrage landet bei den Interessenten.

### Fehlermeldungen bei der Buchung (Schülerseite)
- „liegt außerhalb der Arbeitszeit deines Fahrlehrers“ → Arbeitszeiten, gesperrter Tag, Urlaub, Krank-Sperre; Sonntag nie.
- „dein Fahrlehrer ist an diesem Tag schon voll ausgelastet“ → Tageslimit des Fahrlehrers. „dein Tageslimit ist an diesem Tag erreicht“ / „dein Wochenlimit ist in dieser Woche erreicht“ → Limit je Fahrschüler.
- „wegen einer offenen Rechnung gesperrt“ → Guthaben-Modus „Deckung nötig“.
- „schon belegt oder angefragt“, „höchstens 4 Stunden am Stück möglich“, „liegt schon in der Vergangenheit“ → andere Zeit.
- „der Buchungslink ist nicht mehr gültig“ → neuen Link vom Fahrlehrer.
- „Name oder PIN stimmt nicht“ → siehe 6.5, Nr. 20.

---

## 5. KI in der App

**KI-Funktionen** (alle mit Vorschau, nichts wird ohne Bestätigung gespeichert):
- KI-Helfer (runder Knopf unten rechts, wo Ally nicht an ist), Tages-Briefing (Startseite), Tages-Rückblick (Tagesgeschäft), KI-Einordnung (Statistik, Abrechnung), Einschätzung (Prüfungsplanung).
- Foto-Erfassung: Schüler, Interessent und Termine aus Screenshot, ADK-Karte per Foto, Beleg fotografieren; Spaltenzuordnung beim Excel-Import nur als Rückfall.
- Ausbildung: KI-Entwurf und Tipps im Fahrtenbuch, Trainingsvorschlag und wiederkehrende Schwächen (Übersicht, nur wo Ally nicht an ist), KI-Prüfreife-Einschätzung, KI-Übergabe-Einschätzung, Navigator „Neu vorschlagen“ und Abschluss-Texte, Prüfungssimulation (Freitext in Beobachtungen), KI-Übungsfragen für die Theorie.
- Planung und Verwaltung: „Alle N auf einmal einplanen“, „Wochenplan vorschlagen“, „Verschiebungen vorschlagen“, Warteliste-Reihenfolge, Kontoauszug-Zuordnung, Nachricht an Interessenten, Eltern-Update, Reform-Einordnung.
- Für Schüler: Buchungs-Chat „Frag uns“ und „✨ Erklär mir das“ bei Theoriefragen.

**KI-Support** (Mehr › Einstellungen › „Hilfe & Support“): beantwortet Fragen zur Bedienung, zu Fehlern, Konto und Abo sofort, öffnet die passende Stelle und gibt Ungelöstes an Allindrive weiter (Antwort unter „Anfragen“). Er ersetzt die frühere FAQ-Liste. Ist die KI der Fahrschule aus, geht die Nachricht ohne KI an Allindrive.

**Posteingang (KI-Verwaltung, im Allindrive Autopilot)**: Die KI bearbeitet die E-Mails der Fahrschule (siehe „Allindrive Autopilot“ in Abschnitt 2). Sie liest jede neue E-Mail mit den Angaben der Fahrschule und dem Steckbrief, schreibt Entwürfe und beantwortet nur allgemeine Interessenten-Anfragen selbst, mit KI-Hinweis. Was automatisch rausgeht, entscheiden feste Regeln in der App, nicht die KI.

**KI-Schalter der Fahrschule** (Einstellungen › Kosten, nur Fahrschul-Admin): Aus sperrt KI-Helfer, Briefings, Foto-Erfassung, Buchungs-Chat und Theorie-Erklärungen für alle Konten der Fahrschule auf dem Server; es gehen keine Daten an den KI-Anbieter. Dann fehlen alle KI-Knöpfe, auch Ally und der Posteingang (es werden keine E-Mails mehr abgeholt). Persönlich lässt sich die KI unter Funktionen ein/aus › „KI-Helfer“ ausblenden.

**Ally (Pilot)**: Ally arbeitet mit Claude von Anthropic. Sie beantwortet Fragen zum Kalender („Was steht morgen an?“), filtert den Kalender („Kalender gefiltert“, „Alle zeigen“), plant die Woche („Planen“ bzw. „Plane meine Woche“: Anfragen annehmen/ablehnen, Terminvorschläge, Warteliste – erst nach Abhaken und „Übernehmen“), trägt Termine ein („Eintragen“), bereitet Abschlüsse vor, nennt offene Beträge und legt Zahlungen bereit („Ally: Zahlungen“), hakt ADK-Punkte ab („Abhaken“, „Ally: ADK und Strecken“) und öffnet die Krankmeldung. Für Fahrschul-Admin und Büro fasst Ally den Posteingang zusammen („Was liegt im Posteingang?“, nur Kurzfassungen, Absender als Kürzel) und öffnet ihn; antworten kann man nur im Posteingang selbst. Eingetragenes lässt sich gleich danach rückgängig machen. Verschiebungen laufen einzeln, nachdem der Schüler gefragt wurde. Ally bewertet keine Menschen – Lernstand und Prüfungsreife beurteilt der Fahrlehrer. Telefonnummer, Anschrift und Notizen ändert man direkt in der Schülerakte.

**Datenschutz laut App**: Namen gehen nur als Kürzel an die KI, Kontaktdaten und Gesundheitsangaben (z. B. Sehhilfe) gar nicht. Das Ally-Gespräch speichert Allindrive nicht. Beim Support gehen Nachricht und technische Angaben (App-Version, Gerätetyp, geöffnete Seite, Rolle) an die KI; Fragen und Antworten speichert Allindrive 12 Monate, damit bei Bedarf jemand weiterhelfen kann. Die KI ist Claude von Anthropic. Im Posteingang gehen E-Mails (Absender, Betreff, Text) mit den Angaben der Fahrschule an die KI, E-Mails mit Gesundheitsangaben nicht; Kopien speichert Allindrive 12 Monate, das Original bleibt im Postfach, das Postfach-Passwort liegt verschlüsselt und ist nur für den Server lesbar. Beim Excel-Import bleibt alles auf dem Gerät, außer Überschriften und fünf Beispielzeilen, wenn keine Namensspalte erkannt wird. KI kann sich irren – Wichtiges im Kalender bzw. in der Akte prüfen.

---

## 6. Technik und Probleme

### 6.1 iPhone-App und Browser
- Inhalt und Daten sind gleich. Nur in der iPhone-App: Push-Benachrichtigungen, Widget, Einstellungen › Gerät & Benachrichtigungen, Streckenaufzeichnung auch bei gesperrtem Bildschirm.
- Browser-Adresse: allindrive.netlify.app (dieselbe App und dieselben Daten wie in der iPhone-App). Lädt die Seite nicht („Die App konnte nicht geladen werden“): Verbindung, aktuellen Browser, Werbeblocker/Firmennetz prüfen, „Neu laden“.
- Ab ca. 900 Pixel Breite gibt es die Seitenleiste, darunter die untere Leiste.

### 6.2 Updates
- Jeder Start lädt die neueste Version aus dem Netz – App schließen und neu öffnen bzw. Seite neu laden genügt. Ohne Netz startet die zuletzt geladene Version.
- Nach einem Update öffnet sich einmal „Was ist neu?“ (sonst Hinweis „App wurde aktualisiert · v…“). Jederzeit: Einstellungen › Info › „Version … · Was ist neu? ›“, ältere über „Ältere Versionen anzeigen“.

### 6.3 Speicheranzeige und offline
- Oben rechts: „Speichert…“, dann „✓ Gespeichert“. „Nicht gespeichert · erneut“ (schmal: „⚠ Erneut“) antippen versucht es erneut.
- Ohne Netz: „Offline gespeichert · N“ – Fahrstunden, ADK-Haken, Bewertungen, Zahlungen und Schülerdaten liegen sicher auf dem Gerät und gehen automatisch raus (Antippen = sofort versuchen). Termine sind offline sichtbar, aber Anlegen und Ändern braucht Internet.
- Mehrere Geräte und Kollegen: Gespeichert wird nur, was sich geändert hat, auf den neuesten Serverstand. Kommt die App in den Vordergrund, lädt sie neu; Schüleraktionen erscheinen im Kalender sofort.
- Absturzseite „App-Fehler“: „Zwischenspeicher leeren & neu laden“ löscht den lokalen Zwischenspeicher (Daten bleiben in der Cloud).

### 6.4 Bekannte Grenzen
- Termine nur online anlegen/ändern; Schüler buchen höchstens 4 Stunden am Stück; Sonntag nie für Schüler.
- Rundnachricht: höchstens 1000 Zeichen, 10 pro Tag. Bilder für Logo/Profil höchstens 8 MB, Uploads der Schüler höchstens 10 MB.
- Kein Einspielen von Backups, keine Anmeldung beim TÜV/DEKRA, keine automatische Nachricht beim Umhängen im Team-Kalender. XRechnung ist Beta.
- In der Demo-Ansicht wird vieles nicht gespeichert und die Darstellung ist immer hell.

### 6.5 Häufige Probleme und Lösungen
1. **Funktion/Menüpunkt fehlt** → ausgeschaltet: Einstellungen › Funktionen ein/aus. Steht dort „Für die ganze Fahrschule ausgeschaltet“, kann nur der Fahrschul-Admin es einschalten. Admin-Bereiche (Kosten, Klassen, Arten, Team …) sieht ein Fahrlehrer nie.
2. **Navigator, ADK, Strecken oder Kosten fehlen beim Schüler** → Funktion aus (Kosten hängt an „Rechnungen & Kasse“). Ohne gewählten Schüler: „Kein Schüler ausgewählt“.
3. **Ally fehlt** → nur in freigeschalteten Pilot-Fahrschulen, nur mit KI an, persönlich abschaltbar.
4. **KI-Knöpfe fehlen / „KI-Funktionen sind für deine Fahrschule ausgeschaltet.“** → KI-Schalter (Einstellungen › Kosten, Admin) oder Funktion „KI-Helfer“ persönlich aus.
5. **Kalender zeigt nicht alle Termine** → Ally-Filter aktiv („Kalender gefiltert“ › „Alle zeigen“); im Team-Kalender Standort-Filter; Sonntag erst sichtbar, wenn unter Arbeitszeiten eingeblendet.
6. **Schüler kann einen Tag nicht buchen („außerhalb der Arbeitszeit“)** → Sonntag immer gesperrt; sonst Wochentage & Zeiten (Kreuz = gesperrt), Urlaub oder Krank-Sperre.
7. **Keine Frage nach der Ausfallgebühr nach kurzfristiger Absage** → Die Frage („Gebühr buchen“ oder „Kulanz“) kommt, wenn du die Storno-Anfrage eines Schülers annimmst – über „Stornierung bestätigen“ oder „Termin löschen“ – und der Termin dann noch innerhalb deiner Stornofrist beginnt (Einstellungen › Kosten; ohne eingetragene Frist keine Frage). Termine ohne Storno-Anfrage lösen keine Frage aus. Ältere Versionen fragten nicht bei ausgeschalteter Funktion „Warteliste & Lücken-Radar“ (behoben in v2.125.1) und nicht bei „Termin löschen“ (seit v2.125.2) – App neu öffnen. Gebühr nachträglich: Kasse › „+ Posten hinzufügen“.
8. **Tag „voll ausgelastet“, obwohl Zeit frei** → Tageslimit erreicht; ohne Haken bei „Vorschläge über … Min. am Tag zulassen“ zählen offene Vorschläge mit.
9. **Termin lässt sich nicht bestätigen** → Tages-/Wochenlimit, Limit je Schüler oder Überschneidung.
10. **Schüler kann wegen offener Rechnung nicht buchen** → Kasse › „Guthaben-Modus“ steht auf „Deckung nötig“.
11. **Terminvorschlag noch offen** → Der Schüler hat ihn noch nicht über den Buchungslink bestätigt, bzw. seine Anfrage wartet auf dich (Kalender › offene Anfragen).
12. **Sofort-Buchung, Termin trotzdem „offen“** → unter 2 Stunden Vorlauf oder Limit erreicht.
13. **UE-Zähler zu niedrig** → zählt die tatsächliche Dauer bestätigter Fahrstunden, Überschneidungen einmal; Urlaub, Krank, Privat, sonstige Tätigkeiten, Theorie, Versetzt nicht. Was zählt, stellt der Admin je Art ein.
14. **Vergangene Fahrstunde wird nicht zum Abschließen angeboten** → Art zählt nicht als Fahrstunde, Schüler nicht dein eigener, schon erfasst oder „Nicht gefahren“/„Fand nicht statt“.
15. **Falscher Preis oder 0 €** → Preis pro UE bzw. Preisliste (Posten „Fahrstunde“, „Gültig ab“) prüfen; gilt nur für neu abgeschlossene Stunden. Einzelne Stunde in der Kasse antippen › „Fahrstunde bearbeiten“ (nicht mehr, wenn sie auf einer Rechnung steht).
16. **Ampel bleibt gelb trotz 100 %** → Theorie nicht eingetragen oder Sonderfahrten nicht erfüllt (je Art auch eine Doppelstunde von 90 Minuten).
17. **Schüler lässt sich nicht löschen** → hat Rechnungen (wird archiviert) oder es läuft Aufzeichnung, Prüfungssimulation oder Schaltkompetenz-Test.
18. **Gelöschter Schüler soll zurück** → Papierkorb (30 Tage); Dokumente kommen nicht zurück.
19. **Schüler fehlt in der Termin-Auswahl** → geteilte und archivierte Schüler stehen dort nicht.
20. **Schüler-Login klappt nicht** → Name wie in den Stammdaten, Fahrschul-Code vollständig, sonst neuen PIN vergeben (gespeicherte PINs sind nicht einsehbar).
21. **„Wird erzeugt, sobald du den Buchungslink das erste Mal teilst“** → einmal „Buchungslink an Schüler senden“, dann gibt es den Fahrschul-Code.
22. **„Kein Konto mit dieser E-Mail gefunden“ beim Teilen** → der Kollege muss sich erst registrieren.
23. **„Keine Fahrschule zugeordnet“ bei neuem Fahrlehrer** → gültigen Einladungscode eintragen › „Beitreten“; ein neu erzeugter Code macht den alten ungültig. Einladungscode ≠ Fahrschul-Code.
24. **„Speichert…“ hängt / „Nicht gespeichert · erneut“** → antippen, Verbindung prüfen; offline Gespeichertes geht automatisch raus.
25. **Termin anlegen ohne Netz geht nicht** → Termine brauchen Internet.
26. **Push kommt nicht** → nur iPhone-App; Gerät & Benachrichtigungen muss „Aktiv“ zeigen, sonst in den iPhone-Einstellungen bei „Allindrive“ erlauben. Über eigene Aktionen gibt es keine Push.
27. **„Testzeitraum abgelaufen“** → Abo bezahlen und „Ich habe bezahlt“; Daten bleiben erhalten.
28. **Streckenaufzeichnung bricht im Browser ab** → Bildschirm anlassen, App nicht wechseln; nach Neustart „Strecke speichern“ oder „Aufzeichnung fortsetzen“.
29. **Abgehakte Punkte waren nach „Gespeichert“ wieder weg** → in v2.107.0 behoben; App auf allen Geräten neu öffnen.
30. **Support-Antwort hilft nicht** → „Noch nicht“ › „An Allindrive weitergeben“. Die Antwort von Allindrive steht später unter „Anfragen“ („Neue Antwort“). „Der Support ist gerade nicht erreichbar“ → kurz warten und erneut senden („Nochmal senden“).

---

## 7. Navigationsziele (Schnellsuche)

Feste Ziele der Schnellsuche (⌘K) aus der Funktion \`befehlsZiele()\` – dieselben Ziele öffnet der KI-Support mit seinem Knopf „Öffnen“; ein Ziel funktioniert nur, wenn es für die Person gerade sichtbar ist. Dazu kommen dynamisch Schüler (\`stu-…\`, ohne archivierte), Rechnungen (\`inv-…\`, ab 2 Zeichen, nur eigene Schüler, Funktion „Rechnungen & Kasse“) und Interessenten (\`int-…\`, ab 2 Zeichen).

| id | Label | Wer sieht es |
|---|---|---|
| home | Startseite | alle |
| liste | Schüler | alle |
| kalender | Kalender | alle |
| support | Support-Zentrale – alle Anfragen | nur Allindrive (App-Admin) |
| ally | Ally fragen – KI-Assistentin | nur wo Ally freigeschaltet und an ist (KI an) |
| uebersicht | Übersicht | nur mit gewähltem Schüler |
| navigator | Ausbildungsnavigator | nur wenn Funktion „Ausbildungsnavigator“ an |
| adk | ADK | nur mit gewähltem Schüler und Funktion „ADK“ an |
| strecken | Strecken | nur mit gewähltem Schüler und Funktion „Strecken“ an |
| pruefungssimliste | Prüfungssimulation | nur mit gewähltem Schüler und Funktion „Prüfungssimulation“ an |
| schaltkompetenzliste | Schaltkompetenz | nur mit gewähltem Schüler und Funktion „Schaltkompetenz“ an |
| theoriepilot | Theoriepilot | nur wenn Funktion „Theoriepilot“ an |
| daten | Schülerdaten | immer gelistet; Inhalt nur mit gewähltem Schüler |
| fuhrpark | Fuhrpark - Fahrzeuge, Kosten, Kalender | nur wenn Funktion „Fuhrpark“ an |
| ausgaben | Ausgaben & Gewinn - Belege, Überschuss, Export | nur Fahrschul-Admin, mit Fahrschule, Funktion „Ausgaben & Gewinn“ an |
| schulboard | Fahrschul-Dashboard - alle Fahrlehrer, Schüler zuteilen | nur Fahrschul-Admin und Büro |
| teamkalender | Team-Kalender - Termine aller Fahrlehrer, umhängen | nur Fahrschul-Admin und Büro |
| auswertung | Auswertung - Statistik, Prüfungsplanung, Abrechnung | alle |
| tagesgeschaeft | Tagesgeschäft - Tagesabschluss, Lücken, krank melden | nur wenn Funktion „Tagesgeschäft“ an |
| papierkorb | Papierkorb - gelöschte Schüler und Interessenten (30 Tage) | alle |
| interessenten | Interessenten | nur wenn Funktion „Interessenten“ an |
| autopilot | Allindrive Autopilot – E-Mails und Belege mit KI | nur Fahrschul-Admin und Büro; öffnet den Autopilot in einem neuen Fenster |
| einstellungen | Einstellungen | alle |
| videos | Videos | immer gelistet; ist „Lernvideos“ aus, springt die App zur Startseite |
| set-profil | Profil | alle |
| set-arbeit | Arbeit & Ausbildung | alle |
| set-unterlagen | Meine Unterlagen | alle |
| set-konto-daten | Daten & Sicherung | alle |
| set-abo | Abonnement | alle |
| fahrschulcode | Fahrschul-Code für die Fahrschüler-App | nur mit gewähltem Schüler (springt zur Karte „Fahrschülerbereich“) |
| set-meine-fahrschule | Meine Fahrschule | nur Fahrschul-Admin |
| set-team | Team & Einladung | nur Fahrschul-Admin |
| set-standorte | Standorte | nur Fahrschul-Admin |
| set-klassen | Führerscheinklassen | nur Fahrschul-Admin |
| set-arten | Ausbildungsfahrt-Arten | nur Fahrschul-Admin |
| set-soll | Sonderfahrten-Soll | nur Fahrschul-Admin |
| set-reform | Führerschein-Reform 2027 | nur Fahrschul-Admin |
| set-fuhrpark | Fuhrpark & Auswertung | nur Fahrschul-Admin |
| set-kosten | Kosten | nur Fahrschul-Admin |
| set-rechnung | Rechnungsdaten | nur Fahrschul-Admin, Funktion „Rechnungen & Kasse“ an |
| set-datev | DATEV-Export | nur Fahrschul-Admin, Funktion „Rechnungen & Kasse“ an |
| set-gutscheine | Geschenkgutscheine | nur Fahrschul-Admin, Funktion „Gutscheine“ an |
| set-loeschprotokoll | Löschprotokoll | nur Fahrschul-Admin |
| set-personal | Personalunterlagen | nur Fahrschul-Admin |
| set-konto | Konto | alle |
| set-hilfe | Hilfe & Support (KI) | alle (öffnet den KI-Support) |
| set-info | Info | alle |

„Nur Fahrschul-Admin“ schließt jeweils auch Allindrive (Betreiber) ein. Funktionen ein/aus, Gerät & Benachrichtigungen, Datenschutzerklärung und Impressum haben keinen eigenen Eintrag – sie sind über Einstellungen erreichbar (Funktionen ein/aus: Einstellungen › Fahrschule bzw. Mein Bereich).`;

module.exports = { WISSEN };
