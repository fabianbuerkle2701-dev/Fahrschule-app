// Netlify Function: Vollautonom „An offene Rechnungen erinnern“ (Allindrive Autopilot, Fabian 21.10.2026).
// Aufruf stündlich durch den pg_cron-Job "vollautonom-erinnerungen" (nur wenn eine Fahrschule den Schalter hat),
// mit x-cron-secret. Gesendet wird nur werktags von 9 bis 17 Uhr Berliner Zeit.
// Je Fahrschule dreifach geprüft: Paket Vollautonom, Schalter „erinnerungen“, KI und Bereich Rechnungen an. Dann
// gehen fällige Zahlungserinnerungen über das Postfach der Fahrschule raus – dieselbe Auswahl und derselbe Text wie
// „Erinnerung fällig“ im Autopilot (lib/rechnungen.js), aber vorsichtiger:
//  - nur Stufe 1 und 2 (die Stufe „letzte Erinnerung vor Mahnung“ schickt der Mensch), nur ab 5 € offen,
//  - nicht an archivierte Schüler, bei Firmenkunden nur an die Rechnungs-E-Mail der Firma,
//  - höchstens 10 je Fahrschule und Lauf, 100 Nachrichten je Fahrschule und Tag (wie nachricht-senden.js).
// Doppelt senden ist schlimmer als gar nicht: Je Rechnung und Tag gibt es genau einen Schlüssel in nachrichten_ausgang,
// und liegt dort in den letzten 10 Tagen schon eine Erinnerung zur Rechnung, geht keine neue raus. Vermerkt wird jede
// gesendete Erinnerung im Protokoll des Schülers (Weg E-Mail, erfasst von „ki“). Adressen und Texte kommen nie ins Log.

const crypto = require("crypto");
const { dienst } = require("./lib/dienst");
const { antwortSenden, emailGueltig } = require("./lib/postfach");
const { autonomieAn } = require("./lib/pakete");
const R = require("./lib/rechnungen");

const MAX_JE_SCHULE = 10;
const TAGESLIMIT = 100;
const MIN_BETRAG = 5;
const MAX_STUFE = 2;
const RESTZEIT_MS = 6000;
// Die Uhr ist austauschbar, damit sich Sendezeiten testen lassen
const uhr = { jetzt: () => new Date() };

function restzeit(context) {
  return context && typeof context.getRemainingTimeInMillis === "function" ? Number(context.getRemainingTimeInMillis()) : 25000;
}
function berlin(jetzt) {
  const t = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short", hourCycle: "h23" })
    .formatToParts(jetzt).forEach((p) => { t[p.type] = p.value; });
  const alsUtc = Date.UTC(+t.year, +t.month - 1, +t.day, +t.hour, +t.minute, +t.second);
  const versatz = alsUtc - Math.floor(jetzt.getTime() / 1000) * 1000;
  return {
    ms: jetzt.getTime(),
    datum: t.year + "-" + t.month + "-" + t.day,
    stunde: +t.hour,
    werktag: ["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(t.weekday) >= 0,
    tagesbeginn: new Date(Date.UTC(+t.year, +t.month - 1, +t.day) - versatz).toISOString(),
  };
}
// Gesendet wird nur werktags von 9 bis 17 Uhr (Berlin)
function sendezeit(jetzt) {
  const b = berlin(jetzt);
  return b.werktag && b.stunde >= 9 && b.stunde < 17;
}
// Ein Schlüssel je Rechnung und Tag (wie eine UUID geschrieben) – zwei Läufe am selben Tag senden nie zweimal
function schluesselFuer(bezug, datum) {
  const h = crypto.createHash("sha256").update("vollautonom-erinnerung:" + bezug + ":" + datum).digest("hex");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-8" + h.slice(17, 20) + "-" + h.slice(20, 32);
}
function kiAus(schule) {
  const b = Array.isArray(schule && schule.bereiche_aus) ? schule.bereiche_aus : [];
  return !!(schule && schule.ki_aus === true) || b.indexOf("ki") >= 0 || b.indexOf("rechnungen") >= 0;
}
// Fußzeile: die Erinnerung kam automatisch (Sie-Form für Firmen)
function mitHinweis(text, firma) {
  return text + "\n\n—\n" + (firma
    ? "Diese Erinnerung wurde automatisch versendet. Falls Sie bereits gezahlt haben, betrachten Sie sie bitte als gegenstandslos."
    : "Diese Erinnerung wurde automatisch verschickt. Hast du schon bezahlt? Dann betrachte sie einfach als erledigt.");
}
// Wer bekommt automatisch eine Erinnerung? (Auswahl aus „Erinnerung fällig“, vorsichtiger)
function kandidaten(positionen) {
  return positionen
    .filter((p) => p.erinnernFaellig && !p.konto.archiviert && p.naechsteStufe <= MAX_STUFE && p.offen >= MIN_BETRAG)
    .sort((a, b) => (b.tage || 0) - (a.tage || 0) || b.offen - a.offen);
}
function empfaenger(p) {
  const an = String((p.konto.firma ? p.konto.firma.email : p.konto.email) || "").trim();
  return emailGueltig(an) ? an : "";
}

async function schuleBearbeiten(db, schule, b, context, protokoll) {
  const pf = ((await db.lesen("postfaecher?school_id=eq." + schule.id + "&select=*")) || [])[0];
  if (!pf || !pf.aktiv || pf.letzter_fehler) return "kein_postfach";
  const heuteGesendet = await db.zaehlen("nachrichten_ausgang?school_id=eq." + schule.id + "&status=eq.gesendet&created_at=gte." + encodeURIComponent(b.tagesbeginn));
  if (heuteGesendet >= TAGESLIMIT) return "tageslimit";
  const konten = R.kontenAus(await db.rpc("school_rechnungen", { p_school_id: schule.id }));
  const liste = kandidaten(R.positionen(konten, R.zahlungsziel(schule), b.datum)).filter((p) => empfaenger(p));
  if (!liste.length) return "nichts";
  const passwort = await db.rpc("postfach_passwort", { p_postfach: pf.id });
  if (!passwort) return "kein_postfach";

  let gesendet = 0;
  const seit = new Date(b.ms - R.ERINNERUNG_ABSTAND_TAGE * 86400000).toISOString();
  for (const p of liste) {
    if (gesendet >= MAX_JE_SCHULE || heuteGesendet + gesendet >= TAGESLIMIT || restzeit(context) < RESTZEIT_MS) break;
    const bezug = p.konto.student_id + ":" + p.rechnung.id;
    // Schon (oder gerade) eine Erinnerung zu dieser Rechnung in den letzten Tagen? Dann nicht noch einmal
    const frueher = await db.zaehlen("nachrichten_ausgang?school_id=eq." + schule.id + "&art=eq.erinnerung&bezug=eq." + encodeURIComponent(bezug)
      + "&status=in.(gesendet,reserviert)&created_at=gte." + encodeURIComponent(seit));
    if (frueher > 0) continue;
    const stufe = p.naechsteStufe;
    const an = empfaenger(p);
    const betreff = R.erinnerungsBetreff(p, stufe);
    let id = null;
    try {
      const r = await db.einfuegen("nachrichten_ausgang", { school_id: schule.id, art: "erinnerung", schluessel: schluesselFuer(bezug, b.datum), bezug, an, betreff,
        gesendet_von: null, status: "reserviert", fehler: null }, true);
      id = Array.isArray(r) && r[0] ? r[0].id : null;
    } catch (e) {
      id = null;
    }
    if (!id) continue; // heute schon reserviert (ein zweiter Lauf) – nichts doppelt
    let vermerkt = false;
    try {
      await antwortSenden(pf, passwort, {
        an, betreff, text: mitHinweis(R.erinnerungsText(p, schule, stufe), !!p.konto.firma), erzeugt: true,
        gesendet: async () => {
          try { await db.aendern("nachrichten_ausgang", "id=eq." + id, { status: "gesendet" }); }
          catch (e) { console.error("vollautonom-erinnerungen: Ausgang nicht als gesendet markiert (" + (e && e.status) + ")"); }
          try { vermerkt = !!(await db.rpc("school_erinnerung_ki_vermerken", { p_student_id: p.konto.student_id, p_invoice_id: p.rechnung.id, p_stufe: stufe, p_betrag: p.offen })); }
          catch (e) { console.error("vollautonom-erinnerungen: Vermerk fehlgeschlagen (" + (e && e.status) + ")"); }
        },
      });
      gesendet++;
      protokoll.push({ schule: schule.id, stufe, vermerkt });
    } catch (e) {
      const grund = e && e.eigen ? e.message : "Das Senden ist fehlgeschlagen.";
      try { await db.aendern("nachrichten_ausgang", "id=eq." + id, { status: "fehler", fehler: grund }); } catch (e2) { /* egal */ }
      console.error("vollautonom-erinnerungen: Senden fehlgeschlagen");
      return gesendet ? "teilweise" : "senden_fehler"; // Postfach-Problem: bei dieser Fahrschule nicht weiter versuchen
    }
  }
  return gesendet ? "gesendet" : "nichts";
}

exports.handler = async function (event, context) {
  const headers = { "Content-Type": "application/json" };
  const antwort = (statusCode, daten) => ({ statusCode, headers, body: JSON.stringify(daten) });
  if (event.httpMethod !== "POST") return antwort(405, { error: "Nur POST erlaubt" });
  const secret = process.env.CRON_SECRET;
  if (!secret || (event.headers && event.headers["x-cron-secret"]) !== secret) return antwort(401, { error: "Nicht autorisiert" });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return antwort(500, { error: "Nicht eingerichtet." });
  const jetzt = uhr.jetzt();
  if (!sendezeit(jetzt)) return antwort(200, { ruhe: true });
  const b = berlin(jetzt);
  const db = dienst(serviceKey);

  let schulen;
  try {
    schulen = (await db.lesen("schools?autopilot_paket=eq.vollautonom&select=id,name,invoice_settings,zahlungsziel_tage,ki_aus,bereiche_aus,autopilot_paket,autopilot_paket_bis,ki_autonomie")) || [];
  } catch (e) {
    return antwort(503, { error: "Fahrschulen nicht lesbar" });
  }
  const ergebnis = {};
  const protokoll = [];
  for (const schule of schulen) {
    if (restzeit(context) < RESTZEIT_MS) break;
    if (!autonomieAn(schule, "erinnerungen", jetzt.getTime()) || kiAus(schule)) continue;
    try {
      ergebnis[schule.id] = await schuleBearbeiten(db, schule, b, context, protokoll);
    } catch (e) {
      console.error("vollautonom-erinnerungen: " + ((e && e.status) || "Fehler"));
      ergebnis[schule.id] = "fehler";
    }
  }
  return antwort(200, { gesendet: protokoll.length, ergebnis });
};

exports.uhr = uhr;
exports.sendezeit = sendezeit;
exports.schluesselFuer = schluesselFuer;
exports.kandidaten = kandidaten;
exports.mitHinweis = mitHinweis;
