# Fahrschule-app
## Tests

Die Rechen-Kernlogik (Abrechnung, Beträge, Preisliste, Fahrtenbuch) ist ohne Installation testbar:

```
node --test tests/*.test.js
```

`tests/lade-app.js` lädt die Funktionen direkt aus `index.html` in eine Node-Sandbox – kein Build, keine Pakete.

Nach jedem Deploy gegen die Live-App (kostenlos, verändert nichts, prüft Version, Bibliotheken, öffentliche RPCs und ob jede Netlify-Function deployt ist):

```
node tests/smoke-live.js
```
