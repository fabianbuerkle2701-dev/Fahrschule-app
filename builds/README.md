# TestFlight-Builds vom 2026-09-15

Beide Apps zeigen auf den **eigenen Server** (`app.allindrive.app`), nicht mehr auf Netlify.

| App | Bundle-ID | Build | Ziel |
|---|---|---|---|
| Allindrive (Fahrlehrer) | com.allindrive.lehrer | 202609152217 | https://app.allindrive.app |
| Allindrive für Fahrschüler | com.allindrive.schueler | 202609152217 | https://app.allindrive.app/?app=schueler |

Beide sind App-Store-signiert (Team 8S77BDF6PP) und fertig zum Hochladen.

## Hochladen – Weg 1: Xcode (kein zusätzliches Einrichten nötig)
Xcode öffnen → Window → Organizer → Archives → das Archiv vom 15.09. auswählen →
„Distribute App" → „TestFlight & App Store" → dem Assistenten folgen.
Die Archive liegen unter `/tmp/archives/` (bis zum nächsten Neustart) bzw. im
Standard-Archivordner, falls über Xcode gebaut.

## Hochladen – Weg 2: Kommandozeile (einmalig einrichten, danach automatisierbar)
1. App Store Connect → Benutzer und Zugriff → Integrationen → App Store Connect API →
   neuen Schlüssel mit Rolle „App Manager" erzeugen, `.p8`-Datei herunterladen.
2. Ablegen unter `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`
3. Dann genügt:

    xcrun altool --upload-app -f builds/Allindrive-Fahrlehrer-202609152217.ipa \
      -t ios --apiKey <KEYID> --apiIssuer <ISSUER-UUID>

Mit hinterlegtem Schlüssel kann ich den Upload künftig selbst übernehmen.

## Wichtig beim Testen
Wer diese Builds benutzt, arbeitet auf dem **eigenen Server**. Dessen Datenstand ist
der vom 30.08. – die Termine und Schüler der letzten Wochen aus der laufenden
Produktion fehlen dort noch. Also nur ausprobieren, keine echte Arbeit damit
erledigen: beim Umstieg (Phase 8, Schritt 2) wird der Serverstand vollständig durch
einen frischen Stand aus der Cloud ersetzt, und alles, was beim Testen entstanden
ist, ist dann weg.
