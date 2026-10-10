# Allindrive-Theoriefolien

Eigene PowerPoint-Folien für den Theorieunterricht, gebaut mit pptxgenjs aus nativen Formen
(alles in PowerPoint bearbeitbar). Inhalte nach Anlage 1/2 FahrschAusbO und StVO, eigene Texte
und Grafiken – keine Inhalte aus Verlagsprodukten.

- `bausteine.js` – Farben, Folienrahmen, Kreuzung von oben, Autos, Pfeile, Verkehrszeichen, Ampel, Polizei
- `lektion05.js` – Grundstoff Thema 5 „Vorfahrt und Verkehrsregelung“ (42 Folien, mit Sprechernotizen)

```
cd tools/theorie-folien && npm install
node lektion05.js            # schreibt Lektion05.pptx
node lektion05.js nur=12     # nur Folie 12 (einzel-12.pptx, für die Vorschau)
qlmanage -t -s 1600 -o vorschau einzel-12.pptx   # Vorschau-PNG ohne PowerPoint
```

Fertige Datei nach `assets/theorie/` kopieren und in `ALLINDRIVE_FOLIEN` (index.html) eintragen.
