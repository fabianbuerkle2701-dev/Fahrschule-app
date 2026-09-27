# Fahrschule-app
## Tests

Die Rechen-Kernlogik (Abrechnung, Beträge, Preisliste, Fahrtenbuch) ist ohne Installation testbar:

```
node --test tests/*.test.js
```

`tests/lade-app.js` lädt die Funktionen direkt aus `index.html` in eine Node-Sandbox – kein Build, keine Pakete.
