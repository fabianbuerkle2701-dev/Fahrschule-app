// Netlify Function: Vollautonom „Interessenten nachfassen“ (Allindrive Autopilot, Fabian 23.10.2026: „Die KI soll noch viel
// mehr übernehmen und autonom erledigen“). Aufruf stündlich durch den pg_cron-Job "vollautonom-nachfassen" (nur wenn eine
// Fahrschule den Schalter hat), mit x-cron-secret. Gesendet wird nur werktags von 9 bis 17 Uhr Berliner Zeit.
// Je Fahrschule dreifach geprüft: Paket Vollautonom, Schalter „interessenten_nachfassen“, KI und Bereich Interessenten an.
// Dann bekommt jeder Interessent, der dich braucht (Wiedervorlage fällig oder seit 48 Stunden ohne Kontakt, wie
// „Jetzt dran“ im Autopilot) und eine E-Mail-Adresse hat, den Nachfass-Text des Autopiloten über das Postfach der
// Fahrschule – danach steht er auf „In Kontakt“ mit Wiedervorlage in drei Tagen, genau wie nach dem Senden von Hand.
// Vorsichtig:
//  - höchstens zwei automatische Nachfass-Mails je Interessent; danach bleibt er bei dir,
//  - nichts, wenn in den letzten drei Tagen schon nachgefasst wurde oder er selbst geschrieben bzw. eine Antwort
//    aus dem Posteingang bekommen hat (das Gespräch läuft),
//  - höchstens 10 je Fahrschule und Lauf, 100 Nachrichten je Fahrschule und Tag (wie nachricht-senden.js).
// Doppelt senden ist schlimmer als gar nicht: je Interessent und Tag genau ein Schlüssel in nachrichten_ausgang.
// Adressen und Texte kommen nie ins Log.

const crypto = require("crypto");
const { dienst } = require("./lib/dienst");
const { antwortSenden, emailGueltig } = require("./lib/postfach");
const { autonomieAn } = require("./lib/pakete");
const I = require("./lib/regeln-interessenten");

const MAX_JE_SCHULE = 10;
const TAGESLIMIT = 100;
const MAX_AUTOMATISCH = 2;
const RUHE_TAGE = 3;
const RESTZEIT_MS = 6000;
const HINWEIS = "\n\n—\nDiese Nachricht wurde automatisch verschickt.";
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
function sendezeit(jetzt) {
  const b = berlin(jetzt);
  return b.werktag && b.stunde >= 9 && b.stunde < 17;
}
function schluesselFuer(bezug, datum) {
  const h = crypto.createHash("sha256").update("vollautonom-nachfassen:" + bezug + ":" + datum).digest("hex");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-8" + h.slice(17, 20) + "-" + h.slice(20, 32);
}
function aus(schule) {
  const b = Array.isArray(schule && schule.bereiche_aus) ? schule.bereiche_aus : [];
  return !!(schule && schule.ki_aus === true) || b.indexOf("ki") >= 0 || b.indexOf("interessenten") >= 0;
}
// Wer bekommt automatisch eine Nachfass-Mail? Fällige Wiedervorlagen zuerst, dann die am längsten Wartenden
function kandidaten(liste, jetztMs) {
  return liste
    .map((i) => ({ i, d: I.dran(i, jetztMs) }))
    .filter((x) => x.d && emailGueltig(String(x.i.email || "").trim()))
    .sort((a, b) => (a.d === b.d ? 0 : a.d === "wiedervorlage" ? -1 : 1)
      || String(a.i.follow_up_am || a.i.created_at || "").localeCompare(String(b.i.follow_up_am || b.i.created_at || "")))
    .map((x) => x.i);
}

async function schuleBearbeiten(db, schule, b, context, protokoll) {
  const pf = ((await db.lesen("postfaecher?school_id=eq." + schule.id + "&select=*")) || [])[0];
  if (!pf || !pf.aktiv || pf.letzter_fehler) return "kein_postfach";
  const heuteGesendet = await db.zaehlen("nachrichten_ausgang?school_id=eq." + schule.id + "&status=eq.gesendet&created_at=gte." + encodeURIComponent(b.tagesbeginn));
  if (heuteGesendet >= TAGESLIMIT) return "tageslimit";
  const personen = ((await db.lesen("profiles?school_id=eq." + schule.id + "&select=id")) || []).map((p) => p.id);
  if (!personen.length) return "nichts";
  const liste = kandidaten((await db.lesen("interessenten?owner=in.(" + personen.join(",") + ")&status=in.(offen,kontaktiert)"
    + "&select=id,owner,vorname,name,email,klasse,status,follow_up_am,created_at")) || [], b.ms);
  if (!liste.length) return "nichts";
  // Läuft das Gespräch gerade (Mail bekommen oder beantwortet)? Dann nicht dazwischen schreiben
  const ruheSeit = new Date(b.ms - RUHE_TAGE * 86400000).toISOString();
  const aktiv = new Set();
  for (const feld of ["empfangen_am", "gesendet_am"])
    ((await db.lesen("posteingang?school_id=eq." + schule.id + "&" + feld + "=gte." + encodeURIComponent(ruheSeit) + "&select=von_email")) || [])
      .forEach((m) => { if (m.von_email) aktiv.add(String(m.von_email).trim().toLowerCase()); });
  const passwort = await db.rpc("postfach_passwort", { p_postfach: pf.id });
  if (!passwort) return "kein_postfach";

  let gesendet = 0;
  for (const i of liste) {
    if (gesendet >= MAX_JE_SCHULE || heuteGesendet + gesendet >= TAGESLIMIT || restzeit(context) < RESTZEIT_MS) break;
    const an = String(i.email).trim();
    if (aktiv.has(an.toLowerCase())) continue;
    const frueher = (await db.lesen("nachrichten_ausgang?school_id=eq." + schule.id + "&art=eq.nachfassen&bezug=eq." + encodeURIComponent(i.id)
      + "&status=in.(gesendet,reserviert)&select=created_at,gesendet_von")) || [];
    if (frueher.some((x) => x.created_at && x.created_at >= ruheSeit)) continue;
    if (frueher.filter((x) => !x.gesendet_von).length >= MAX_AUTOMATISCH) continue;
    const betreff = I.nachfassBetreff(schule.name, false);
    let id = null;
    try {
      const r = await db.einfuegen("nachrichten_ausgang", { school_id: schule.id, art: "nachfassen", schluessel: schluesselFuer(i.id, b.datum), bezug: i.id, an, betreff,
        gesendet_von: null, status: "reserviert", fehler: null }, true);
      id = Array.isArray(r) && r[0] ? r[0].id : null;
    } catch (e) {
      id = null;
    }
    if (!id) continue;
    try {
      await antwortSenden(pf, passwort, {
        an, betreff, text: I.nachfassText(i, schule.name, false) + HINWEIS, erzeugt: true,
        gesendet: async () => {
          try { await db.aendern("nachrichten_ausgang", "id=eq." + id, { status: "gesendet" }); }
          catch (e) { console.error("vollautonom-nachfassen: Ausgang nicht als gesendet markiert (" + (e && e.status) + ")"); }
          // Wie nach dem Senden von Hand: „In Kontakt“, nächster Kontakt in drei Tagen
          try { await db.aendern("interessenten", "id=eq." + i.id, { status: "kontaktiert", follow_up_am: I.berlinTag(b.ms, 3), updated_at: new Date(b.ms).toISOString() }); }
          catch (e) { console.error("vollautonom-nachfassen: Interessent nicht vermerkt (" + (e && e.status) + ")"); }
        },
      });
      gesendet++;
      protokoll.push({ schule: schule.id });
    } catch (e) {
      const grund = e && e.eigen ? e.message : "Das Senden ist fehlgeschlagen.";
      try { await db.aendern("nachrichten_ausgang", "id=eq." + id, { status: "fehler", fehler: grund }); } catch (e2) { /* egal */ }
      console.error("vollautonom-nachfassen: Senden fehlgeschlagen");
      return gesendet ? "teilweise" : "senden_fehler";
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
    schulen = (await db.lesen("schools?autopilot_paket=eq.vollautonom&select=id,name,ki_aus,bereiche_aus,autopilot_paket,autopilot_paket_bis,ki_autonomie")) || [];
  } catch (e) {
    return antwort(503, { error: "Fahrschulen nicht lesbar" });
  }
  const ergebnis = {};
  const protokoll = [];
  for (const schule of schulen) {
    if (restzeit(context) < RESTZEIT_MS) break;
    if (!autonomieAn(schule, "interessenten_nachfassen", jetzt.getTime()) || aus(schule)) continue;
    try {
      ergebnis[schule.id] = await schuleBearbeiten(db, schule, b, context, protokoll);
    } catch (e) {
      console.error("vollautonom-nachfassen: " + ((e && e.status) || "Fehler"));
      ergebnis[schule.id] = "fehler";
    }
  }
  return antwort(200, { gesendet: protokoll.length, ergebnis });
};

exports.uhr = uhr;
exports.sendezeit = sendezeit;
exports.kandidaten = kandidaten;
