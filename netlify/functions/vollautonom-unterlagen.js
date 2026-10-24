// Netlify Function: Vollautonom „Fehlende Unterlagen anmahnen“ (Allindrive Autopilot, Fabian 23.10.2026: „Die KI soll noch
// viel mehr übernehmen und autonom erledigen“). Aufruf stündlich durch den pg_cron-Job "vollautonom-unterlagen" (nur wenn
// eine Fahrschule den Schalter hat), mit x-cron-secret. Gesendet wird nur werktags von 9 bis 17 Uhr Berliner Zeit.
// Je Fahrschule geprüft: Paket Vollautonom, Schalter „unterlagen_erinnern“, KI an, ein verbundenes Postfach.
// Wer in den nächsten drei Wochen seine Theorieprüfung hat (angesetzt, im Kalender oder mit Prüfplatz – wie „Prüfung bald“
// im Autopilot, lib/regeln-pruefungen.js) und dem noch Sehtest, Erste-Hilfe-Kurs, Passfoto oder Antrag fehlen, bekommt die
// Erinnerung des Autopiloten per E-Mail über das Postfach der Fahrschule. Vorsichtig:
//  - nur vor der Theorieprüfung: wer die Theorie schon hat, hatte alle Unterlagen (dann fehlt nur der Haken in der App),
//  - nicht, wenn die Prüfung in weniger als drei Tagen ist – dann hilft keine Mail mehr, das klärt ihr direkt,
//  - je Prüfung höchstens zwei Erinnerungen, mindestens eine Woche auseinander,
//  - höchstens 10 je Fahrschule und Lauf, 100 Nachrichten je Fahrschule und Tag (wie nachricht-senden.js).
// Doppelt senden ist schlimmer als gar nicht: je Prüfung und Tag genau ein Schlüssel in nachrichten_ausgang.
// Adressen und Texte kommen nie ins Log.

const crypto = require("crypto");
const { dienst } = require("./lib/dienst");
const { antwortSenden, emailGueltig } = require("./lib/postfach");
const { autonomieAn } = require("./lib/pakete");
const P = require("./lib/regeln-pruefungen");

const MAX_JE_SCHULE = 10;
const TAGESLIMIT = 100;
const MAX_AUTOMATISCH = 2;
const ABSTAND_TAGE = 7;
const MIN_VORLAUF_TAGE = 3;
const RESTZEIT_MS = 6000;
const HINWEIS = "\n\n—\nDiese Erinnerung wurde automatisch verschickt. Hast du schon alles abgegeben? Dann betrachte sie einfach als erledigt.";
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
const plusTage = (tag, n) => new Date(Date.parse(tag + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
function schluesselFuer(bezug, datum) {
  const h = crypto.createHash("sha256").update("vollautonom-unterlagen:" + bezug + ":" + datum).digest("hex");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-8" + h.slice(17, 20) + "-" + h.slice(20, 32);
}
function aus(schule) {
  const b = Array.isArray(schule && schule.bereiche_aus) ? schule.bereiche_aus : [];
  return !!(schule && schule.ki_aus === true) || b.indexOf("ki") >= 0;
}
// Wer bekommt automatisch eine Erinnerung? Zeilen aus school_pruefungen; die nächste Prüfung zuerst
function kandidaten(zeilen, heute, jetztMs) {
  const ab = plusTage(heute, MIN_VORLAUF_TAGE);
  const liste = [];
  zeilen.forEach((r) => {
    const z = P.zeileAus(r);
    if (z.theorie || z.pruefungen.some((e) => e.art === "theorie" && e.passed)) return;
    if (!emailGueltig(String(z.email || "").trim())) return;
    const l = P.pruefungsLage(z, heute, jetztMs);
    const termin = l.anstehend[0];
    // fehlt ist nur gefüllt, wenn die nächste Prüfung in den nächsten drei Wochen ist
    if (!termin || termin.art !== "theorie" || termin.datum < ab || !l.fehlt.length || !P.fehlendeUnterlagen(z).length) return;
    liste.push({ z, termin });
  });
  return liste.sort((a, b) => a.termin.datum.localeCompare(b.termin.datum));
}

async function schuleBearbeiten(db, schule, b, context, protokoll) {
  const pf = ((await db.lesen("postfaecher?school_id=eq." + schule.id + "&select=*")) || [])[0];
  if (!pf || !pf.aktiv || pf.letzter_fehler) return "kein_postfach";
  const heuteGesendet = await db.zaehlen("nachrichten_ausgang?school_id=eq." + schule.id + "&status=eq.gesendet&created_at=gte." + encodeURIComponent(b.tagesbeginn));
  if (heuteGesendet >= TAGESLIMIT) return "tageslimit";
  const liste = kandidaten((await db.rpc("school_pruefungen", { p_school_id: schule.id })) || [], b.datum, b.ms);
  if (!liste.length) return "nichts";
  const passwort = await db.rpc("postfach_passwort", { p_postfach: pf.id });
  if (!passwort) return "kein_postfach";
  const abstandSeit = new Date(b.ms - ABSTAND_TAGE * 86400000).toISOString();

  let gesendet = 0;
  for (const { z, termin } of liste) {
    if (gesendet >= MAX_JE_SCHULE || heuteGesendet + gesendet >= TAGESLIMIT || restzeit(context) < RESTZEIT_MS) break;
    const bezug = z.student_id + ":" + termin.datum;
    const frueher = (await db.lesen("nachrichten_ausgang?school_id=eq." + schule.id + "&art=eq.unterlagen&bezug=eq." + encodeURIComponent(bezug)
      + "&status=in.(gesendet,reserviert)&select=created_at,gesendet_von")) || [];
    if (frueher.some((x) => x.created_at && x.created_at >= abstandSeit)) continue;
    if (frueher.filter((x) => !x.gesendet_von).length >= MAX_AUTOMATISCH) continue;
    const an = String(z.email).trim();
    const betreff = P.unterlagenBetreff(termin);
    let id = null;
    try {
      const r = await db.einfuegen("nachrichten_ausgang", { school_id: schule.id, art: "unterlagen", schluessel: schluesselFuer(bezug, b.datum), bezug, an, betreff,
        gesendet_von: null, status: "reserviert", fehler: null }, true);
      id = Array.isArray(r) && r[0] ? r[0].id : null;
    } catch (e) {
      id = null;
    }
    if (!id) continue;
    try {
      await antwortSenden(pf, passwort, {
        an, betreff, text: P.unterlagenNachricht(z, termin, schule.name) + HINWEIS, erzeugt: true,
        gesendet: async () => {
          try { await db.aendern("nachrichten_ausgang", "id=eq." + id, { status: "gesendet" }); }
          catch (e) { console.error("vollautonom-unterlagen: Ausgang nicht als gesendet markiert (" + (e && e.status) + ")"); }
        },
      });
      gesendet++;
      protokoll.push({ schule: schule.id });
    } catch (e) {
      const grund = e && e.eigen ? e.message : "Das Senden ist fehlgeschlagen.";
      try { await db.aendern("nachrichten_ausgang", "id=eq." + id, { status: "fehler", fehler: grund }); } catch (e2) { /* egal */ }
      console.error("vollautonom-unterlagen: Senden fehlgeschlagen");
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
    if (!autonomieAn(schule, "unterlagen_erinnern", jetzt.getTime()) || aus(schule)) continue;
    try {
      ergebnis[schule.id] = await schuleBearbeiten(db, schule, b, context, protokoll);
    } catch (e) {
      console.error("vollautonom-unterlagen: " + ((e && e.status) || "Fehler"));
      ergebnis[schule.id] = "fehler";
    }
  }
  return antwort(200, { gesendet: protokoll.length, ergebnis });
};

exports.uhr = uhr;
exports.sendezeit = sendezeit;
exports.kandidaten = kandidaten;
