// Netlify Function: Vollautonom „Termine in der Werkstatt ausmachen“ (Allindrive Autopilot, Fabian 21.10.2026).
// Aufruf stündlich durch den pg_cron-Job "vollautonom-werkstatt" (nur wenn eine Fahrschule den Schalter hat),
// mit x-cron-secret; angefragt wird werktags von 8 bis 17 Uhr Berliner Zeit.
// Je Fahrschule dreifach geprüft: Paket Vollautonom, Schalter „werkstatt_termine“, KI und Bereich Fuhrpark an.
// Steht bei einem aktiven Fahrzeug die HU in den nächsten 30 Tagen an (oder ist überfällig) oder der Service in den
// nächsten 1.000 km, schreibt der Autopilot die hinterlegte Werkstatt mit drei freien Zeiten an – wie „Termin
// anfragen“ im Fuhrpark. Die Antwort liest posteingang-ki und trägt einen eindeutigen Termin selbst ein.
// Nicht noch einmal anfragen, solange eine Anfrage offen ist, ein eingetragener Termin noch kommt oder kürzer als
// 60 Tage her ist, oder die letzte Anfrage vor weniger als 14 Tagen abgesagt oder abgebrochen wurde.

const { dienst } = require("./lib/dienst");
const { autonomieAn } = require("./lib/pakete");
const N = require("./lib/werkstatt-netz");

const HU_TAGE = 30;
const SERVICE_KM = 1000;
const MAX_JE_SCHULE = 2;
const RESTZEIT_MS = 6000;
const uhr = { jetzt: () => new Date() };

function restzeit(context) {
  return context && typeof context.getRemainingTimeInMillis === "function" ? Number(context.getRemainingTimeInMillis()) : 25000;
}
function sendezeit(jetzt) {
  const t = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(jetzt).forEach((p) => { t[p.type] = p.value; });
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(t.weekday) >= 0 && +t.hour >= 8 && +t.hour < 17;
}
// Was steht bei diesem Fahrzeug an? (wie die Fristen im Autopilot: HU 30 Tage vorher, Service 1.000 km vorher)
function anlaesse(v, heute) {
  const out = [];
  if (/^\d{4}-\d{2}-\d{2}/.test(String(v.tuvDate || ""))) {
    const tage = Math.round((new Date(String(v.tuvDate).slice(0, 10) + "T12:00:00Z").getTime() - new Date(heute + "T12:00:00Z").getTime()) / 86400000);
    if (tage <= HU_TAGE) out.push("hu");
  }
  if (v.serviceIntervalKm && v.mileage != null && v.mileage !== "") {
    const km = (Number(v.lastServiceKm) || 0) + Number(v.serviceIntervalKm) - Number(v.mileage);
    if (Number.isFinite(km) && km <= SERVICE_KM) out.push("service");
  }
  return out;
}
// Darf (noch einmal) angefragt werden? frueher: Anfragen zu diesem Fahrzeug und Anlass
function anfragenErlaubt(frueher, jetztMs) {
  return !frueher.some((a) => {
    if (a.status === "gesendet" || a.status === "antwort") return true;
    if (a.status === "gebucht") return a.termin_start ? new Date(a.termin_start).getTime() > jetztMs - 60 * 86400000 : true;
    return new Date(a.updated_at || a.created_at).getTime() > jetztMs - 14 * 86400000;
  });
}

async function schuleBearbeiten(db, schule, jetzt, context) {
  const pf = ((await db.lesen("postfaecher?school_id=eq." + schule.id + "&select=*")) || [])[0];
  if (!pf || !pf.aktiv || pf.letzter_fehler) return "kein_postfach";
  const heute = N.berlinDatum(0, jetzt);
  const faellig = [];
  (Array.isArray(schule.vehicles) ? schule.vehicles : []).filter((v) => v && v.id && !v.inactive)
    .forEach((v) => anlaesse(v, heute).forEach((anlass) => faellig.push({ v, anlass })));
  if (!faellig.length) return "nichts";
  const werkstaetten = (await db.lesen("fahrzeug_werkstaetten?school_id=eq." + schule.id + "&select=fahrzeug_id")) || [];
  const mitWerkstatt = new Set(werkstaetten.map((w) => w.fahrzeug_id));
  const liste = faellig.filter((f) => mitWerkstatt.has(f.v.id));
  if (!liste.length) return "keine_werkstatt";
  const anfragen = (await db.lesen("werkstatt_anfragen?school_id=eq." + schule.id + "&select=fahrzeug_id,anlass,status,termin_start,created_at,updated_at&order=created_at.desc&limit=200")) || [];
  let passwort = null;
  let gesendet = 0;
  for (const f of liste) {
    if (gesendet >= MAX_JE_SCHULE || restzeit(context) < RESTZEIT_MS) break;
    if (!anfragenErlaubt(anfragen.filter((a) => a.fahrzeug_id === f.v.id && a.anlass === f.anlass), jetzt.getTime())) continue;
    const v = await N.vorbereiten(db, schule, f.v.id, f.anlass, jetzt);
    if (v.fehler) continue;
    if (!passwort) passwort = await db.rpc("postfach_passwort", { p_postfach: pf.id });
    if (!passwort) return "kein_postfach";
    try {
      const r = await N.senden(db, { schule, pf, passwort, fahrzeug: v.fahrzeug, werkstatt: v.werkstatt, anlass: f.anlass, an: v.an,
        betreff: v.betreff, text: v.text + "\n\n—\nDiese Anfrage hat der Autopilot der Fahrschule automatisch verschickt.", vorschlaege: v.vorschlaege, vonKi: true });
      if (!r.schon) gesendet++;
    } catch (e) {
      console.error("vollautonom-werkstatt: Senden fehlgeschlagen");
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
  const db = dienst(serviceKey);
  let schulen;
  try {
    schulen = (await db.lesen("schools?autopilot_paket=eq.vollautonom&select=id,name,invoice_settings,locations,vehicles,ki_aus,bereiche_aus,autopilot_paket,autopilot_paket_bis,ki_autonomie")) || [];
  } catch (e) {
    return antwort(503, { error: "Fahrschulen nicht lesbar" });
  }
  const ergebnis = {};
  for (const schule of schulen) {
    if (restzeit(context) < RESTZEIT_MS) break;
    if (!autonomieAn(schule, "werkstatt_termine", jetzt.getTime()) || N.kiAus(schule)) continue;
    try {
      ergebnis[schule.id] = await schuleBearbeiten(db, schule, jetzt, context);
    } catch (e) {
      console.error("vollautonom-werkstatt: " + ((e && e.status) || "Fehler"));
      ergebnis[schule.id] = "fehler";
    }
  }
  return antwort(200, { ergebnis });
};

exports.uhr = uhr;
exports.sendezeit = sendezeit;
exports.anlaesse = anlaesse;
exports.anfragenErlaubt = anfragenErlaubt;
