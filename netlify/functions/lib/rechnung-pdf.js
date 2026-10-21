// Rechnung als PDF auf dem Server (Vollautonom „Jeden Monat selbst abrechnen“, Fabian 21.10.2026) – dieselben
// Angaben und dieselbe Anordnung wie die Druckansicht des Autopiloten (allindrive-autopilot/src/ui/RechnungsDruck.tsx,
// gleich dem Rechnungsblatt der App): Absender mit Steuernummer/USt-IdNr./IBAN, Rechnungsnummer, Datum,
// Leistungszeitraum (§ 14 Abs. 4 Nr. 6 UStG), Zahlungsziel, Empfänger, Posten, Summe mit 19 % USt. bzw. § 19 UStG,
// Girocode. Schrift: Helvetica (WinAnsi) – Zeichen außerhalb davon werden durch „?“ ersetzt.

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { Encodings } = require("@pdf-lib/standard-fonts"); // kommt mit pdf-lib
const A = require("./abrechnung");
const { buildEpcQrText, qrEncode } = require("./girocode");

const BREITE = 595.28, HOEHE = 841.89;
const RAND_L = 60, RAND_R = 60, RAND_O = 56, RAND_U = 64;
const INNEN = BREITE - RAND_L - RAND_R;
const SCHWARZ = rgb(0.067, 0.067, 0.067), GRAU = rgb(0.267, 0.267, 0.267), GRAU_M = rgb(0.333, 0.333, 0.333), GRAU_H = rgb(0.42, 0.42, 0.42);
const LINIE = rgb(0.133, 0.133, 0.133), LINIE_H = rgb(0.89, 0.89, 0.89), ROT = rgb(0.702, 0.212, 0.165), RAHMEN = rgb(0.867, 0.867, 0.867);

// Lässt sich der Text mit der PDF-Grundschrift (WinAnsi) zeigen? Sonst stünde dort „?“ – solche Rechnungen
// schreibt der Zeitjob nicht selbst, sie bleiben für den Menschen (die Druckansicht im Browser kann alle Zeichen).
function darstellbar(t) {
  return Array.from(String(t == null ? "" : t)).every((c) => c === "\n" || c === "\r" || Encodings.WinAnsi.canEncodeUnicodeCodePoint(c.codePointAt(0)));
}

const datumDe = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? m[3] + "." + m[2] + "." + m[1] : ""; };
function kontoName(k) {
  return [k.vorname, k.name].map((x) => String(x || "").trim()).filter(Boolean).join(" ") || "Ohne Namen";
}
function abrSchueler(k) {
  return { drivenLessons: k.lessons || [], costItems: k.cost_items || [], packages: k.packages || [], invoices: k.invoices || [], abrechnungsModell: k.abrechnungs_modell };
}

async function rechnungPdf(o) {
  const { schule, konto, rechnung } = o;
  const iv = (schule && schule.invoice_settings) || {};
  const firma = iv.firma || (schule && schule.name) || "Fahrschule";
  const abr = abrSchueler(konto);
  const kUnt = A.rechnungKleinunternehmer(abr, rechnung, !!iv.kleinunternehmer);
  const total = Number(rechnung.total) || 0;
  const netto = kUnt ? total : Math.round((total / 1.19) * 100) / 100;
  const ust = kUnt ? 0 : Math.round((total - netto) * 100) / 100;
  const zeitraum = A.rechnungsLeistungszeitraum(abr, rechnung);
  const leistungText = zeitraum
    ? zeitraum.von === zeitraum.bis ? "Leistungsdatum: " + datumDe(zeitraum.von) : "Leistungszeitraum: " + datumDe(zeitraum.von) + " – " + datumDe(zeitraum.bis)
    : "Leistungsdatum entspricht dem Rechnungsdatum";
  const offen = Math.max(0, Math.round((Number(o.offen != null ? o.offen : total)) * 100) / 100);

  const pdf = await PDFDocument.create();
  pdf.setTitle((rechnung.stornoOf ? "Stornorechnung " : "Rechnung ") + rechnung.number);
  pdf.setAuthor(firma);
  pdf.setCreator("Allindrive Autopilot");
  pdf.setProducer("Allindrive Autopilot");
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const fett = await pdf.embedFont(StandardFonts.HelveticaBold);
  const erlaubt = new Set(normal.getCharacterSet());
  const sauber = (t) => Array.from(String(t == null ? "" : t).replace(/\r\n?/g, "\n")).map((c) => (c === "\n" || erlaubt.has(c.codePointAt(0)) ? c : "?")).join("");
  const breite = (t, f, g) => f.widthOfTextAtSize(sauber(t), g);
  // Zeilenumbruch nach Wörtern; zu lange Wörter werden geteilt
  function umbrechen(t, f, g, max) {
    const out = [];
    sauber(t).split("\n").forEach((absatz) => {
      let zeile = "";
      absatz.split(/ +/).forEach((wort) => {
        while (f.widthOfTextAtSize(wort, g) > max && wort.length > 1) {
          let n = wort.length - 1;
          while (n > 1 && f.widthOfTextAtSize(wort.slice(0, n), g) > max) n--;
          if (zeile) { out.push(zeile); zeile = ""; }
          out.push(wort.slice(0, n));
          wort = wort.slice(n);
        }
        const versuch = zeile ? zeile + " " + wort : wort;
        if (f.widthOfTextAtSize(versuch, g) <= max) zeile = versuch;
        else { if (zeile) out.push(zeile); zeile = wort; }
      });
      out.push(zeile);
    });
    return out;
  }

  let seite = pdf.addPage([BREITE, HOEHE]);
  let y = HOEHE - RAND_O;
  const neueSeite = () => { seite = pdf.addPage([BREITE, HOEHE]); y = HOEHE - RAND_O; };
  const text = (t, x, yy, f, g, farbe) => seite.drawText(sauber(t), { x, y: yy, font: f, size: g, color: farbe || SCHWARZ });
  const rechts = (t, xRechts, yy, f, g, farbe) => text(t, xRechts - breite(t, f, g), yy, f, g, farbe);
  const linie = (yy, dicke, farbe) => seite.drawLine({ start: { x: RAND_L, y: yy }, end: { x: BREITE - RAND_R, y: yy }, thickness: dicke, color: farbe });

  // ── Kopf: links der Absender, rechts Titel, Nummer und Daten ──
  let yl = y - 13, yr = y - 16;
  text(firma, RAND_L, yl, fett, 13);
  yl -= 16;
  [iv.strasse, iv.plzOrt].filter(Boolean).forEach((z) => { text(z, RAND_L, yl, normal, 10.5); yl -= 15.75; });
  yl -= 4;
  [iv.steuernummer && "Steuernummer: " + iv.steuernummer, iv.ustId && "USt-IdNr.: " + iv.ustId, iv.iban && "IBAN: " + iv.iban].filter(Boolean)
    .forEach((z) => { text(z, RAND_L, yl, normal, 9.5, GRAU); yl -= 14; });
  const xr = BREITE - RAND_R;
  rechts(rechnung.stornoOf ? "STORNORECHNUNG" : "RECHNUNG", xr, yr, fett, 16);
  yr -= 18;
  rechts(rechnung.number || "", xr, yr, normal, 12);
  yr -= 16;
  const rechtsZeilen = [
    ["Datum: " + datumDe(rechnung.date), GRAU],
    [leistungText, GRAU],
    rechnung.faellig && !rechnung.stornoOf && !rechnung.cancelledBy ? ["Zahlbar bis: " + datumDe(rechnung.faellig), GRAU] : null,
    rechnung.stornoOf ? ["Storniert Rechnung " + rechnung.stornoOf, ROT] : null,
    rechnung.cancelledBy ? ["Storniert durch " + rechnung.cancelledBy, ROT] : null,
  ].filter(Boolean);
  rechtsZeilen.forEach(([z, farbe]) => { rechts(z, xr, yr, normal, 9.5, farbe); yr -= 14; });
  y = Math.min(yl, yr) - 26;

  // ── Empfänger ──
  text("Rechnungsempfänger", RAND_L, y, normal, 9, GRAU_H);
  y -= 15;
  const f = konto.firma;
  if (f && f.name) {
    text(f.name, RAND_L, y, fett, 10.5); y -= 15.75;
    [f.strasse, f.plz_ort].filter(Boolean).forEach((z) => { text(z, RAND_L, y, normal, 10.5); y -= 15.75; });
    text("z.Hd. " + kontoName(konto), RAND_L, y, normal, 9.5, GRAU); y -= 14;
    if (f.ust_id) { text("USt-IdNr.: " + f.ust_id, RAND_L, y, normal, 9.5, GRAU); y -= 14; }
  } else {
    text(kontoName(konto), RAND_L, y, fett, 10.5); y -= 15.75;
    String(konto.anschrift || "").split(/\r?\n/).map((z) => z.trim()).filter(Boolean).forEach((z) => { text(z, RAND_L, y, normal, 10.5); y -= 15.75; });
  }
  y -= 14;

  // ── Posten ──
  const kopfZeile = () => {
    text("Leistung", RAND_L, y, fett, 9, GRAU_M);
    rechts("Betrag", xr, y, fett, 9, GRAU_M);
    y -= 7;
    linie(y, 1.5, LINIE);
    y -= 15;
  };
  kopfZeile();
  const betragsSpalte = 90;
  (rechnung.items || []).forEach((it) => {
    const zeilen = umbrechen(it.label || "", normal, 10.5, INNEN - betragsSpalte);
    const hoehe = zeilen.length * 14 + 9;
    if (y - hoehe < RAND_U + 40) { neueSeite(); kopfZeile(); }
    zeilen.forEach((z, i) => { text(z, RAND_L, y - i * 14, normal, 10.5); });
    rechts(A.eurFmt(it.amount), xr, y, normal, 10.5);
    y -= zeilen.length * 14 - 14 + 9;
    linie(y, 1, LINIE_H);
    y -= 15;
  });
  if (y < RAND_U + 120) neueSeite();
  y += 5;
  linie(y, 1.5, LINIE);
  y -= 17;
  text("Gesamtbetrag", RAND_L, y, fett, 12);
  rechts(A.eurFmt(total), xr, y, fett, 12);
  y -= 16;
  if (!kUnt) { rechts("davon 19% USt.: " + A.eurFmt(ust) + " · netto: " + A.eurFmt(netto), xr, y, normal, 9, GRAU_M); y -= 14; }
  if (rechnung.note && String(rechnung.note).trim()) {
    y -= 8;
    umbrechen(rechnung.note, normal, 9.5, INNEN).forEach((z) => { text(z, RAND_L, y, normal, 9.5, GRAU); y -= 14; });
  }

  // ── Girocode: nur mit IBAN, offenem Betrag und nicht bei Stornos (wie die App) ──
  if (iv.iban && !rechnung.stornoOf && !rechnung.cancelledBy && offen > 0.005) {
    try {
      const epc = buildEpcQrText({ iban: iv.iban, empfaengerName: firma, betragEUR: offen, verwendungszweck: "Rechnung " + rechnung.number });
      if (epc.valid) {
        const qr = qrEncode(epc.text, { errorCorrectionLevel: "M" });
        const kasten = 88 + 24;
        if (y - kasten - 20 < RAND_U) neueSeite();
        y -= 20;
        const oben = y, links = RAND_L;
        seite.drawRectangle({ x: links, y: oben - kasten, width: INNEN, height: kasten, borderColor: RAHMEN, borderWidth: 1, color: rgb(1, 1, 1) });
        const modul = 88 / (qr.moduleCount + 4);
        const qx = links + 12 + 2 * modul, qy = oben - 12 - 2 * modul;
        for (let r = 0; r < qr.moduleCount; r++)
          for (let c = 0; c < qr.moduleCount; c++)
            if (qr.isDark(r, c)) seite.drawRectangle({ x: qx + c * modul, y: qy - (r + 1) * modul, width: modul + 0.02, height: modul + 0.02, color: rgb(0, 0, 0) });
        const tx = links + 12 + 88 + 14;
        let ty = oben - 34;
        text("Bequem per App bezahlen", tx, ty, fett, 9.5);
        ty -= 14;
        umbrechen("Mit der Banking-App scannen – Empfänger, IBAN, Betrag (" + A.eurFmt(offen) + ") und Verwendungszweck sind schon ausgefüllt.", normal, 9, INNEN - 88 - 38)
          .forEach((z) => { text(z, tx, ty, normal, 9, GRAU); ty -= 13.5; });
        y = oben - kasten;
      }
    } catch (e) { /* ohne Girocode */ }
  }

  // ── Fuß ──
  const fuss = [kUnt ? "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet." : "Alle Preise verstehen sich als Bruttopreise inkl. gesetzl. Mehrwertsteuer."];
  if (iv.hinweis) fuss.push(String(iv.hinweis));
  const fussZeilen = fuss.map((z) => umbrechen(z, normal, 9, INNEN));
  const fussHoehe = fussZeilen.reduce((n, l) => n + l.length * 13.5 + 6, 0) + 50;
  if (y - fussHoehe < RAND_U) neueSeite();
  y -= 22;
  fussZeilen.forEach((l) => { l.forEach((z) => { text(z, RAND_L, y, normal, 9, GRAU_M); y -= 13.5; }); y -= 6; });
  y -= 12;
  linie(y + 9, 1, RAHMEN);
  text("Erstellt mit AllInDrive · " + datumDe(o.erstelltAm || rechnung.date), RAND_L, y - 4, normal, 8, rgb(0.6, 0.6, 0.6));

  return Buffer.from(await pdf.save());
}

module.exports = { rechnungPdf, darstellbar };
