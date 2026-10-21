// Rechnungen und Zahlungserinnerungen für Zeitjobs auf dem Server (Allindrive Autopilot, 21.10.2026) – ohne Netz.
// Dieselben Rechenregeln und Texte wie im Autopilot (allindrive-autopilot/src/daten/rechnungen.ts: positionen,
// erinnerungsText, erinnerungsBetreff), die dort ihrerseits der App entsprechen. Ein Test im Autopilot vergleicht
// beide Fassungen an Zufallsdaten – wer hier etwas ändert, ändert es dort mit.

const zahl = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const rund = (x) => Math.round(x * 100) / 100;

function zahlungsziel(schule) {
  const z = schule && schule.zahlungsziel_tage;
  return z != null && Number.isFinite(Number(z)) ? Number(z) : 14;
}
function faelligAm(r, zielTage) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(r.faellig || ""))) return r.faellig;
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(r.date || ""))) return null;
  const d = new Date(String(r.date).slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + zielTage);
  return d.toISOString().slice(0, 10);
}
// Ganze Tage über die Fälligkeit hinaus (<= 0: noch nicht überfällig)
function tageUeber(faellig, heute) {
  if (!faellig) return null;
  return Math.round((new Date(heute + "T12:00:00Z").getTime() - new Date(faellig + "T12:00:00Z").getTime()) / 86400000);
}
function gueltig(r) { return !r.cancelledBy && !r.stornoOf; }

// Auf die Rechnungen angerechnete Zahlungen; Überzahlung einer Rechnung deckt die älteste andere offene
function angerechnet(k) {
  const direkt = {};
  k.payments.forEach((p) => { if (p.invoiceId) direkt[p.invoiceId] = (direkt[p.invoiceId] || 0) + zahl(p.amount); });
  const out = { ...direkt };
  const gute = k.invoices.filter(gueltig);
  let ueberhang = gute.reduce((s, r) => s + Math.max(0, (direkt[r.id] || 0) - zahl(r.total)), 0);
  gute.slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))).forEach((r) => {
    if (ueberhang <= 0.005) return;
    const offen = rund(zahl(r.total) - (direkt[r.id] || 0));
    if (offen <= 0.005) return;
    const anteil = Math.min(offen, ueberhang);
    out[r.id] = (out[r.id] || 0) + anteil;
    ueberhang -= anteil;
  });
  return out;
}

function stufeNachTagen(tage) {
  return tage >= 45 ? 3 : tage >= 21 ? 2 : tage >= 7 ? 1 : 0;
}
const ERINNERUNG_ABSTAND_TAGE = 10;
const ERINNERUNG_AB_TAGEN = 7;

function laufendeErinnerungen(k, liste) {
  const gezahlt = k.payments.reduce((s, p) => s + zahl(p.amount), 0);
  const letzteZahlung = k.payments.reduce((m, p) => { const d = String(p.date || "").slice(0, 10); return d > m ? d : m; }, "");
  return liste.filter((r) => (typeof r.gezahltBis === "number" ? gezahlt <= r.gezahltBis + 0.005 : String(r.date).slice(0, 10) > letzteZahlung));
}

// Konten wie school_rechnungen sie liefert → vereinheitlicht (wie rechnungenLaden im Autopilot)
function kontenAus(daten) {
  return (Array.isArray(daten) ? daten : []).map((k) => ({
    ...k,
    invoices: (Array.isArray(k.invoices) ? k.invoices : []).filter((r) => r && r.id).map((r) => ({ ...r, total: zahl(r.total) })),
    payments: (Array.isArray(k.payments) ? k.payments : []).filter(Boolean).map((p) => ({ ...p, amount: zahl(p.amount) })),
    reminders: (Array.isArray(k.reminders) ? k.reminders : []).filter((r) => r && r.date),
  }));
}

function positionen(konten, zielTage, heute) {
  const out = [];
  konten.forEach((k) => {
    const anr = angerechnet(k);
    k.invoices.forEach((r) => {
      const total = zahl(r.total);
      const istGueltig = gueltig(r);
      const bezahlt = istGueltig ? rund(anr[r.id] || 0) : 0;
      const offen = istGueltig ? Math.max(0, rund(total - bezahlt)) : 0;
      const stand = !istGueltig ? "storniert" : total <= 0.005 || bezahlt + 0.005 >= total ? "bezahlt" : bezahlt <= 0.005 ? "offen" : "teil";
      const faellig = faelligAm(r, zielTage);
      const tage = tageUeber(faellig, heute);
      const erinnerungen = k.reminders
        .filter((e) => (e.invoiceId ? e.invoiceId === r.id : String(e.date).slice(0, 10) >= String(r.date || "").slice(0, 10)))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const laufend = laufendeErinnerungen(k, erinnerungen);
      const letzte = erinnerungen[erinnerungen.length - 1];
      const seitLetzter = letzte ? tageUeber(String(letzte.date).slice(0, 10), heute) || 0 : null;
      const naechsteStufe = Math.min(3, Math.max(stufeNachTagen(tage || 0), laufend.length + 1, 1));
      const erinnernFaellig = (stand === "offen" || stand === "teil") && tage != null && tage >= ERINNERUNG_AB_TAGEN
        && (seitLetzter == null || seitLetzter >= ERINNERUNG_ABSTAND_TAGE);
      out.push({ key: k.student_id + ":" + r.id, konto: k, rechnung: r, stand, bezahlt, offen, faellig, tage, erinnerungen, laufend, naechsteStufe, erinnernFaellig });
    });
  });
  return out;
}

function datumKurz(s) {
  if (!s) return "";
  const [j, m, t] = String(s).slice(0, 10).split("-");
  return t + "." + m + "." + j;
}
function euro(n) {
  return (Number(n) || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function kontoName(k) {
  return [k.vorname, k.name].map((x) => String(x || "").trim()).filter(Boolean).join(" ") || "Ohne Namen";
}

// Erinnerungstext (wie die Staffel der App: ohne Gebühren, Stufe 3 kündigt eine Mahnung nur an)
function erinnerungsText(p, schule, stufe) {
  const iv = (schule && schule.invoice_settings) || {};
  const name = iv.firma || (schule && schule.name) || "Deine Fahrschule";
  const nr = p.rechnung.number || "";
  const datum = datumKurz(p.rechnung.date);
  const betrag = euro(p.offen);
  const tage = Math.max(0, p.tage || 0);
  const konto = iv.iban ? "\n\nBankverbindung: " + name + "\nIBAN: " + iv.iban + "\nVerwendungszweck: " + nr : "";
  if (p.konto.firma) {
    const kern = stufe >= 3
      ? "die Rechnung " + nr + " vom " + datum + " über " + betrag + " ist seit " + tage + " Tagen überfällig. Bitte gleichen Sie den Betrag kurzfristig aus; andernfalls müssen wir Ihnen eine förmliche Mahnung senden."
      : stufe === 2
        ? "die Rechnung " + nr + " vom " + datum + " über " + betrag + " ist seit " + tage + " Tagen offen. Bitte gleichen Sie den Betrag zeitnah aus oder melden Sie sich, falls es Rückfragen gibt."
        : "sicher ist es im Alltag untergegangen: Die Rechnung " + nr + " vom " + datum + " über " + betrag + " ist noch offen. Wir freuen uns über einen Ausgleich in den nächsten Tagen.";
    return "Sehr geehrte Damen und Herren,\n\n" + kern + konto + "\n\nMit freundlichen Grüßen\n" + name;
  }
  const vorname = String(p.konto.vorname || "").trim() || kontoName(p.konto);
  const kern = stufe >= 3
    ? "die Rechnung " + nr + " vom " + datum + " über " + betrag + " ist jetzt seit " + tage + " Tagen überfällig. Bitte gleiche sie kurzfristig aus, sonst müssen wir dir eine förmliche Mahnung schicken. Bei Fragen melde dich gerne."
    : stufe === 2
      ? "die Rechnung " + nr + " vom " + datum + " über " + betrag + " ist seit " + tage + " Tagen offen. Bitte gleiche sie zeitnah aus oder melde dich, falls es ein Problem gibt – dann finden wir eine Lösung."
      : "kleine Erinnerung: Die Rechnung " + nr + " vom " + datum + " über " + betrag + " ist noch offen. Magst du das bei Gelegenheit erledigen? Danke dir!";
  return "Hallo " + vorname + ",\n\n" + kern + konto + "\n\nViele Grüße\n" + name;
}
function erinnerungsBetreff(p, stufe) {
  return (stufe >= 3 ? "Zahlungserinnerung – letzte Erinnerung vor Mahnung" : stufe === 2 ? "2. Zahlungserinnerung" : "Zahlungserinnerung") + " · Rechnung " + p.rechnung.number;
}

module.exports = {
  ERINNERUNG_ABSTAND_TAGE, zahlungsziel, faelligAm, tageUeber, gueltig, angerechnet, stufeNachTagen, kontenAus, positionen,
  datumKurz, euro, kontoName, erinnerungsText, erinnerungsBetreff,
};
