// Netlify Function: Vollautonom „Online-Anmeldungen übernehmen“ (Allindrive Autopilot, Fabian 23.10.2026: „Die KI soll noch
// viel mehr übernehmen und autonom erledigen“). Aufruf stündlich durch den pg_cron-Job "vollautonom-anmeldungen" (nur wenn
// eine Fahrschule den Schalter hat), mit x-cron-secret. Läuft rund um die Uhr – an Schüler geht dabei nichts hinaus.
// Je Fahrschule geprüft: Paket Vollautonom, Schalter „anmeldungen_uebernehmen“, KI, Interessenten und Online-Anmeldung an.
// Übernommen wird wie „Übernehmen“ im Autopilot (school_anmeldung_bestaetigen) – aber nur, was eindeutig ist:
//  - seit mindestens 10 Minuten da, Vor- und Nachname aus Buchstaben (keine Ziffern, keine Links), eine Telefonnummer,
//  - kein anderer Schüler der Fahrschule mit demselben Namen oder derselben Nummer (auch keine zweite offene Anmeldung,
//    kein ehemaliger Schüler) – ob das dieselbe Person ist, entscheidet ein Mensch,
//  - ohne Empfehlungscode: der Bonus ist Geld, den prüft weiter ein Mensch.
// Höchstens 20 je Fahrschule und Lauf. Jede Übernahme steht im Protokoll der Fahrschule („… · Online-Anmeldung von der KI
// übernommen“). Namen und Nummern kommen nie ins Log.

const { dienst } = require("./lib/dienst");
const { autonomieAn } = require("./lib/pakete");

const MAX_JE_SCHULE = 20;
const WARTE_MS = 10 * 60000;
const SEITE = 1000;
const RESTZEIT_MS = 5000;
const KI_NAME = "KI (Autopilot)";
const uhr = { jetzt: () => new Date() };

function restzeit(context) {
  return context && typeof context.getRemainingTimeInMillis === "function" ? Number(context.getRemainingTimeInMillis()) : 25000;
}
function aus(schule) {
  const b = Array.isArray(schule && schule.bereiche_aus) ? schule.bereiche_aus : [];
  return !!(schule && schule.ki_aus === true) || ["ki", "interessenten", "anmeldung"].some((x) => b.indexOf(x) >= 0);
}
const text = (s) => String(s == null ? "" : s).normalize("NFC").trim();
// Derselbe Mensch: Namensteile ohne Groß-/Kleinschreibung und Reihenfolge („Muster Max“ = „Max Muster“)
const nameSchluessel = (s) => (text(s.vorname) + " " + text(s.name)).toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");
// Dieselbe Nummer: die letzten acht Ziffern („+49 151 …“ = „0151 …“)
function nummerSchluessel(tel) {
  const z = String(tel == null ? "" : tel).replace(/\D/g, "");
  return z.length >= 8 ? z.slice(-8) : z;
}
const NAME = /^\p{L}[\p{L}\p{M}.'’ -]*$/u;
// Sieht aus wie eine Adresse („www.…“, „….de“): kein Name
const ADRESSE = /\.\p{L}|\bwww\b|https?/iu;

// Welche offenen Online-Anmeldungen sind so eindeutig, dass die KI sie übernehmen darf? alle = alle Schüler der Fahrschule
// (auch archivierte und offene Anmeldungen) mit id, created_at, vorname, name, tel, pending, archived, geloescht, empfehlung.
function kandidaten(alle, jetztMs) {
  const namen = new Map(), nummern = new Map();
  const zaehlen = (m, k) => { if (k) m.set(k, (m.get(k) || 0) + 1); };
  alle.forEach((s) => { zaehlen(namen, nameSchluessel(s)); zaehlen(nummern, nummerSchluessel(s.tel)); });
  return alle.filter((s) => {
    if (s.pending !== "true" || s.archived === "true" || text(s.geloescht)) return false;
    const seit = Date.parse(s.created_at || "");
    if (!isFinite(seit) || jetztMs - seit < WARTE_MS) return false;
    if (!NAME.test(text(s.vorname)) || !NAME.test(text(s.name)) || ADRESSE.test(text(s.vorname) + " " + text(s.name))) return false;
    const ziffern = String(s.tel == null ? "" : s.tel).replace(/\D/g, "").length;
    if (ziffern < 6 || ziffern > 15) return false;
    if (text(s.empfehlung)) return false;
    return namen.get(nameSchluessel(s)) === 1 && nummern.get(nummerSchluessel(s.tel)) === 1;
  }).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

async function alleSchueler(db, personen) {
  const alle = [];
  for (let seite = 0; seite < 20; seite++) {
    const teil = (await db.lesen("students?owner=in.(" + personen.join(",") + ")&select=id,owner,created_at,vorname:data->>vorname,name:data->>name,"
      + "tel:data->>tel,pending:data->>pending,archived:data->>archived,geloescht:data->>dataDeletedAt,empfehlung:data->>referredByCode"
      + "&order=id&limit=" + SEITE + "&offset=" + seite * SEITE)) || [];
    alle.push(...teil);
    if (teil.length < SEITE) return alle;
  }
  return null; // zu viele, um Doppelte sicher auszuschließen – dann lieber nichts übernehmen
}

async function schuleBearbeiten(db, schule, jetztMs, context, protokoll) {
  const team = (await db.lesen("profiles?school_id=eq." + schule.id + "&select=id,display_name,school_admin")) || [];
  const admin = team.find((p) => p.school_admin === true);
  if (!admin) return "kein_admin";
  const alle = await alleSchueler(db, team.map((p) => p.id));
  if (!alle) return "zu_viele";
  const liste = kandidaten(alle, jetztMs);
  if (!liste.length) return "nichts";
  const namen = new Map(team.map((p) => [p.id, String(p.display_name || "")]));

  let uebernommen = 0;
  for (const a of liste) {
    if (uebernommen >= MAX_JE_SCHULE || restzeit(context) < RESTZEIT_MS) break;
    let r;
    try {
      r = await db.rpc("school_anmeldung_bestaetigen", { p_student_id: a.id });
    } catch (e) {
      // Meist war jemand schneller („schon erledigt“) – die nächste
      console.error("vollautonom-anmeldungen: nicht übernommen (" + (e && e.status) + ")");
      continue;
    }
    uebernommen++;
    protokoll.push({ schule: schule.id });
    const lehrer = namen.get(a.owner) || "";
    try {
      await db.einfuegen("student_assignment_log", { school_id: schule.id, student_id: a.id,
        student_name: ((r && r.name) || (text(a.vorname) + " " + text(a.name))).slice(0, 240) + " · Online-Anmeldung von der KI übernommen",
        aktion: "akte", von_teacher: a.owner, von_name: lehrer, nach_teacher: a.owner, nach_name: lehrer, durch_user: admin.id, durch_name: KI_NAME });
    } catch (e) {
      console.error("vollautonom-anmeldungen: Protokoll nicht geschrieben (" + (e && e.status) + ")");
    }
  }
  return uebernommen ? "uebernommen" : "nichts";
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
    if (!autonomieAn(schule, "anmeldungen_uebernehmen", jetzt.getTime()) || aus(schule)) continue;
    try {
      ergebnis[schule.id] = await schuleBearbeiten(db, schule, jetzt.getTime(), context, protokoll);
    } catch (e) {
      console.error("vollautonom-anmeldungen: " + ((e && e.status) || "Fehler"));
      ergebnis[schule.id] = "fehler";
    }
  }
  return antwort(200, { uebernommen: protokoll.length, ergebnis });
};

exports.uhr = uhr;
exports.kandidaten = kandidaten;
