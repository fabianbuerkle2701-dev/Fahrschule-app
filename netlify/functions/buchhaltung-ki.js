// Netlify Function: Belege für die Buchhaltung holen und auslesen (Allindrive Autopilot, 21.10.2026).
// Aufruf jede Minute durch den pg_cron-Job "buchhaltung-ki" (nur wenn etwas wartet), mit x-cron-secret.
// Je Lauf bis zu drei Beleg-Vorschläge, einzeln reserviert über beleg_vorschlag_naechster (zählt versuche):
//   holen → den Rechnungs-Anhang aus dem Postfach holen und ablegen (lib/belege.js)
//   lesen → den Beleg von der KI auslesen lassen
// Nach einem Fehler bricht der Lauf ab; der nächste kommt in einer Minute. Gebucht wird hier nie.

const Anthropic = require("@anthropic-ai/sdk").default;
const { dienst } = require("./lib/dienst");
const { holen, lesen } = require("./lib/belege");

const MAX_JE_LAUF = 3;
const RESTZEIT_MS = 8500;

function restzeit(context) {
  return context && typeof context.getRemainingTimeInMillis === "function" ? Number(context.getRemainingTimeInMillis()) : 25000;
}

exports.handler = async function (event, context) {
  const headers = { "Content-Type": "application/json" };
  const antwort = (statusCode, daten) => ({ statusCode, headers, body: JSON.stringify(daten) });
  if (event.httpMethod !== "POST") return antwort(405, { error: "Nur POST erlaubt" });
  const secret = process.env.CRON_SECRET;
  if (!secret || (event.headers && event.headers["x-cron-secret"]) !== secret) return antwort(401, { error: "Nicht autorisiert" });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!serviceKey || !apiKey) return antwort(500, { error: "Nicht eingerichtet." });
  const db = dienst(serviceKey);
  const client = new Anthropic({ apiKey, maxRetries: 0 });

  const ergebnis = [];
  for (let i = 0; i < MAX_JE_LAUF && restzeit(context) > RESTZEIT_MS; i++) {
    let v;
    try {
      v = ((await db.rpc("beleg_vorschlag_naechster", {})) || [])[0];
    } catch (e) {
      break;
    }
    if (!v) break;
    let e;
    try {
      if (v.status === "holen")
        e = await holen(db, v);
      else {
        const schule = ((await db.lesen("schools?id=eq." + v.school_id + "&select=ki_aus,bereiche_aus")) || [])[0];
        const r = await lesen(db, client, v, schule, context);
        e = typeof r === "string" ? r : "gelesen";
      }
    } catch (err) {
      console.error("buchhaltung-ki: " + ((err && err.status) || "Fehler"));
      e = "fehler";
    }
    ergebnis.push(e);
    if (e === "nochmal" || e === "fehler") break;
  }
  return antwort(200, { bearbeitet: ergebnis.length, ergebnis });
};
