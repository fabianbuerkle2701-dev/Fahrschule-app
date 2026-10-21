// Netlify Function: einen gerade hochgeladenen Beleg sofort auslesen (Allindrive Autopilot, 21.10.2026).
// Der Fahrschul-Admin lädt im Autopilot ein Foto oder PDF hoch (Speicher „belege“, RPC
// beleg_vorschlag_anlegen) und ruft dann diese Function mit der Vorschlags-ID auf - so steht das
// Ergebnis nach Sekunden da statt nach dem nächsten Zeitjob. Läuft der Zeitjob schon am selben Beleg,
// liefert sie einfach den aktuellen Stand. Gebucht wird hier nie.

const Anthropic = require("@anthropic-ai/sdk").default;
const { dienst, benutzerAusToken } = require("./lib/dienst");
const { lesen } = require("./lib/belege");

const ADMIN_UID = "96530a9f-28ae-4ac6-9cfa-26de392ecf05";
const DEMO_UID = "114d1f0a-9947-459d-8009-06282799ca44";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPALTEN = "id,school_id,status,versuche,grund,quelle,beleg_pfad,beleg_typ,beleg_name,lieferant,rechnungsnummer,datum,faellig_am,betrag,ust_satz,kategorie,beschreibung,zahlart,hinweis,created_at,updated_at";

exports.handler = async function (event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
  const antwort = (statusCode, daten) => ({ statusCode, headers, body: JSON.stringify(daten) });
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return antwort(405, { error: "Nur POST erlaubt" });

  const token = ((event.headers && event.headers.authorization) || "").replace(/^Bearer\s+/i, "");
  const nutzer = await benutzerAusToken(token);
  if (!nutzer) return antwort(401, { error: "Nicht angemeldet" });
  if (nutzer.id === DEMO_UID) return antwort(403, { error: "Im Demo-Modus werden keine Belege gelesen." });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!serviceKey || !apiKey) return antwort(500, { error: "Das Auslesen ist gerade nicht eingerichtet." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return antwort(400, { error: "Ungültige Anfrage" }); }
  const id = String(body.id || "");
  if (!UUID.test(id)) return antwort(400, { error: "Ungültige Anfrage" });

  const db = dienst(serviceKey);
  let v, profil;
  try {
    v = ((await db.lesen("beleg_vorschlaege?id=eq." + id + "&select=" + SPALTEN)) || [])[0];
    profil = ((await db.lesen("profiles?id=eq." + encodeURIComponent(nutzer.id) + "&select=school_id,school_admin")) || [])[0];
  } catch (e) {
    return antwort(503, { error: "Die Buchhaltung ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen." });
  }
  if (!v) return antwort(404, { error: "Diesen Beleg gibt es nicht mehr." });
  const darf = nutzer.id === ADMIN_UID || (profil && profil.school_admin === true && profil.school_id === v.school_id);
  if (!darf) return antwort(403, { error: "Belege sieht nur der Fahrschul-Admin." });
  if (v.status !== "lesen") return antwort(200, { vorschlag: v });

  const gate = await require("./lib/ki-guard").subscriptionGate(nutzer.id, token, { feature: "beleg", limit: 200 });
  if (!gate.ok)
    return antwort(gate.statusCode, { error: gate.statusCode === 403 ? "Die KI ist für deine Fahrschule ausgeschaltet – trag die Werte bitte selbst ein." : gate.error });

  // Reservieren: nur wenn der Zeitjob den Beleg nicht gerade selbst liest
  const reserviert = await db.aendern("beleg_vorschlaege", "id=eq." + id + "&status=eq.lesen&versuche=eq." + (Number(v.versuche) || 0),
    { versuche: (Number(v.versuche) || 0) + 1, updated_at: new Date().toISOString() }, true);
  if (!Array.isArray(reserviert) || !reserviert[0]) {
    const jetzt = ((await db.lesen("beleg_vorschlaege?id=eq." + id + "&select=" + SPALTEN)) || [])[0];
    return antwort(200, { vorschlag: jetzt || v });
  }
  const schule = ((await db.lesen("schools?id=eq." + v.school_id + "&select=ki_aus,bereiche_aus")) || [])[0];
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  const r = await lesen(db, client, reserviert[0], schule, context);
  if (r === "nochmal")
    return antwort(202, { vorschlag: { ...reserviert[0] }, hinweis: "Die KI ist gerade ausgelastet – der Beleg wird in einer Minute gelesen." });
  const jetzt = typeof r === "object" ? r : ((await db.lesen("beleg_vorschlaege?id=eq." + id + "&select=" + SPALTEN)) || [])[0];
  return antwort(200, { vorschlag: jetzt });
};
