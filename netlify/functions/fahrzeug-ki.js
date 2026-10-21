// Netlify Function: KI-Fahrzeugsuche beim Anlegen eines Fahrzeugs (Autopilot und App, Fabian 21.10.2026).
// Die KI sucht im Internet, welches Auto gemeint ist und welche Intervalle gelten (Service, HU), und liefert sie mit
// Quellen zurück. Nur der Fahrschul-Admin (Fahrzeuge ändert nur er), KI-Schalter der Schule und Tageskontingent wie
// bei den übrigen KI-Functions. Gespeichert wird hier nichts - der Client trägt höchstens das Service-Intervall ein.
// Netlify-Zeitlimit: höchstens zwei Suchen, kurzer Text, Zeitdeckel aus dem Lambda-Kontext (lib/ki-timeout).

const Anthropic = require("@anthropic-ai/sdk").default;
const { kiSignal, istKiTimeout } = require("./lib/ki-timeout");
const { dienst, benutzerAusToken } = require("./lib/dienst");
const F = require("./lib/fahrzeug-ki");

const MODELL = "claude-sonnet-5-5";
const ADMIN_UID = "96530a9f-28ae-4ac6-9cfa-26de392ecf05";
const DEMO_UID = "114d1f0a-9947-459d-8009-06282799ca44";

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
  if (nutzer.id === DEMO_UID) return antwort(403, { error: "Im Demo-Modus schlägt die KI nichts nach." });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!serviceKey || !apiKey) return antwort(500, { error: "Die KI ist gerade nicht eingerichtet." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return antwort(400, { error: "Ungültige Anfrage" }); }
  const name = String(body.name || "").trim();
  if (name.length < 2 || name.length > 120) return antwort(400, { error: "Bitte den Namen des Fahrzeugs angeben, z. B. „VW Golf 8 1.5 eTSI“." });

  const db = dienst(serviceKey);
  let profil;
  try {
    profil = ((await db.lesen("profiles?id=eq." + encodeURIComponent(nutzer.id) + "&select=school_id,school_admin")) || [])[0];
  } catch (e) {
    return antwort(503, { error: "Dein Konto ließ sich gerade nicht prüfen. Bitte versuch es gleich noch einmal." });
  }
  if (!profil || !profil.school_id || !(profil.school_admin === true || nutzer.id === ADMIN_UID))
    return antwort(403, { error: "Fahrzeuge legt der Fahrschul-Admin an." });

  // KI-Schalter der Fahrschule und eigenes Tageskontingent (30 Nachschläge)
  const gate = await require("./lib/ki-guard").subscriptionGate(nutzer.id, token, { feature: "fahrzeug", limit: 30, ohneAbo: true });
  if (!gate.ok)
    return antwort(gate.statusCode, { error: gate.statusCode === 403 ? "Die KI ist für deine Fahrschule ausgeschaltet – trag das Intervall selbst ein." : gate.error });

  const client = new Anthropic({ apiKey, maxRetries: 0 });
  const signal = kiSignal(context);
  try {
    let messages = [{ role: "user", content: F.nachricht({ name, typ: body.typ, km: body.km }) }];
    let msg;
    // Websuche läuft auf dem Server von Anthropic; pausiert eine lange Runde (pause_turn), geht es ohne neue Frage weiter
    for (let runde = 0; runde < 3; runde++) {
      msg = await client.messages.create({
        model: MODELL,
        max_tokens: 1200,
        output_config: { effort: "low" },
        system: F.SYSTEM,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2, user_location: { type: "approximate", country: "DE", timezone: "Europe/Berlin" } }],
        messages,
      }, { signal });
      if (!msg || msg.stop_reason !== "pause_turn") break;
      messages = [...messages, { role: "assistant", content: msg.content }];
    }
    if (!msg || msg.stop_reason === "refusal" || msg.stop_reason === "pause_turn")
      return antwort(502, { error: "Die KI konnte das Fahrzeug gerade nicht nachschlagen. Trag das Intervall selbst ein oder versuch es noch einmal." });
    const text = (msg.content || []).filter((b) => b && b.type === "text").map((b) => b.text || "").join("");
    const roh = F.jsonAusText(text);
    if (!roh) return antwort(502, { error: "Die KI hat kein brauchbares Ergebnis geliefert. Bitte noch einmal versuchen." });
    return antwort(200, F.ergebnisPruefen(roh, F.zitateAus(msg.content)));
  } catch (e) {
    if (istKiTimeout(e)) return antwort(504, { error: "Die KI hat nicht rechtzeitig nachgeschlagen. Bitte noch einmal versuchen." });
    console.error("fahrzeug-ki: Anthropic " + ((e && e.status) || "Fehler"));
    return antwort(502, { error: "Die KI konnte das Fahrzeug gerade nicht nachschlagen. Trag das Intervall selbst ein oder versuch es noch einmal." });
  }
};
