// Rechnung per E-Mail (Allindrive Autopilot, 21.10.2026): Betreff, Text und Empfänger – gemeinsam für „Per E-Mail
// senden“ im Autopilot (rechnung-senden.js) und den Zeitjob vollautonom-abrechnen. Ohne Netz.

const R = require("./rechnungen");
const { emailGueltig } = require("./postfach");

function absenderName(schule) {
  const iv = (schule && schule.invoice_settings) || {};
  return iv.firma || (schule && schule.name) || "Deine Fahrschule";
}
// Firmenkunden bekommen die Rechnung an ihre Rechnungs-E-Mail, sonst der Schüler
function empfaenger(konto) {
  const an = String((konto.firma ? konto.firma.email : konto.email) || "").trim();
  return emailGueltig(an) ? an : "";
}
function betreff(rechnung, schule) {
  return (rechnung.stornoOf ? "Stornorechnung " : "Rechnung ") + rechnung.number + " · " + absenderName(schule);
}
function wannText(zeitraum, sie) {
  if (!zeitraum) return "";
  return zeitraum.von === zeitraum.bis ? " (Leistung vom " + R.datumKurz(zeitraum.von) + ")"
    : " (Leistungen vom " + R.datumKurz(zeitraum.von) + " bis " + R.datumKurz(zeitraum.bis) + ")";
}
// Text der E-Mail: du-Form für Schüler, Sie-Form für Firmen; automatisch: mit Hinweis am Ende
function text(o) {
  const { konto, schule, rechnung, offen, zeitraum, automatisch } = o;
  const name = absenderName(schule);
  const storno = !!rechnung.stornoOf;
  if (konto.firma) {
    const kern = storno ? "anbei erhalten Sie die Stornorechnung " + rechnung.number + " zur Rechnung " + rechnung.stornoOf + "."
      : "anbei erhalten Sie die Rechnung " + rechnung.number + " über " + R.euro(rechnung.total) + wannText(zeitraum, true) + ". "
        + (offen > 0.005 ? "Bitte überweisen Sie den Betrag bis zum " + R.datumKurz(rechnung.faellig) + "; die Bankverbindung steht auf der Rechnung." : "Der Betrag ist bereits beglichen – vielen Dank.");
    return "Sehr geehrte Damen und Herren,\n\n" + kern + "\n\nMit freundlichen Grüßen\n" + name
      + (automatisch ? "\n\n—\nDiese Rechnung wurde automatisch versendet. Bei Fragen antworten Sie einfach auf diese E-Mail." : "");
  }
  const vorname = String(konto.vorname || "").trim() || R.kontoName(konto);
  const kern = storno ? "anbei die Stornorechnung " + rechnung.number + " zur Rechnung " + rechnung.stornoOf + "."
    : "anbei die Rechnung " + rechnung.number + " über " + R.euro(rechnung.total) + wannText(zeitraum, false) + ". "
      + (offen > 0.005 ? "Bitte überweise den Betrag bis zum " + R.datumKurz(rechnung.faellig) + " – Bankverbindung und einen Girocode für die Banking-App findest du auf der Rechnung." : "Der Betrag ist schon bezahlt – danke!");
  return "Hallo " + vorname + ",\n\n" + kern + "\n\nViele Grüße\n" + name
    + (automatisch ? "\n\n—\nDiese Rechnung wurde automatisch verschickt. Bei Fragen antworte einfach auf diese E-Mail." : "");
}
function dateiname(rechnung) {
  return (rechnung.stornoOf ? "Stornorechnung-" : "Rechnung-") + String(rechnung.number || "").replace(/[^\w.-]+/g, "_") + ".pdf";
}
// Was im Ausgang zu einer Rechnung steht: „nicht verschickt“ heißt ein Fehler beim Senden und danach kein Erfolg
function nichtVerschickt(zeilen) {
  const stand = {};
  (zeilen || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).forEach((z) => {
    if (z.art !== "rechnung" || !z.bezug) return;
    if (z.status === "gesendet") stand[z.bezug] = "gesendet";
    else if (z.status === "fehler" && /^Rechnung RE-/.test(String(z.fehler || "")) && stand[z.bezug] !== "gesendet") stand[z.bezug] = "fehler";
  });
  return new Set(Object.keys(stand).filter((k) => stand[k] === "fehler"));
}

module.exports = { absenderName, empfaenger, betreff, text, dateiname, nichtVerschickt };
