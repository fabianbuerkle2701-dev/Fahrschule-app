// Der API-Schlüssel kommt NICHT hierher, sondern aus den Netlify-Umgebungsvariablen.
// In Netlify: Site settings -> Environment variables -> ANTHROPIC_API_KEY hinterlegen.
//
// Fast identischer Aufbau wie extract-student.js (gleiche Auth-Prüfung, gleiches
// Bild-zu-Base64-Muster), nur mit kleinerem Ausgabe-Schema: ein Interessent hat
// deutlich weniger Felder als ein Fahrschüler-Datensatz.

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
// Der öffentliche Anon-Key - dient hier nur zum Prüfen, ob das mitgeschickte Token zu einer
// echten, angemeldeten Sitzung gehört. Kein Geheimnis, genau wie in index.html.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdnVmdGxmbmtudWN4dW9ydGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDQ2NDQsImV4cCI6MjA5Njg4MDY0NH0.5ZoBdQLnJw23dMZ4IKmAauycVcPoVPIZdmNamZ8MEv8";

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Nur POST erlaubt" }) };
  }

  // Nur angemeldete Fahrlehrer dürfen diese Funktion nutzen - sie kostet pro Aufruf echtes
  // Anthropic-Guthaben. Prüfung kommt bewusst vor dem API-Schlüssel-Check, damit ein nicht
  // angemeldeter Aufrufer nicht einmal erfährt, ob der Schlüssel konfiguriert ist.
  const requesterToken = (event.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!requesterToken) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Nicht angemeldet" }) };
  }
  try {
    const whoResp = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + requesterToken },
    });
    if (!whoResp.ok) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Sitzung ungültig oder abgelaufen" }) };
    }
  } catch (e) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Anmeldung konnte nicht geprüft werden" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Kein API-Schlüssel hinterlegt. Bitte ANTHROPIC_API_KEY in Netlify setzen." }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Ungültige Anfrage" }) };
  }

  const images = Array.isArray(body.images) ? body.images : (body.image ? [body.image] : []);
  if (images.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Kein Bild übergeben" }) };
  }

  const imageBlocks = images.map((img) => {
    let data = img || "";
    let media = "image/jpeg";
    const m = data.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
    if (m) { media = m[1]; data = m[2]; }
    return { type: "image", source: { type: "base64", media_type: media, data } };
  });

  const instruction = `Du erhältst ein oder mehrere Fotos oder Screenshots einer Kontaktanfrage für eine Fahrschule (z.B. eine WhatsApp-Nachricht, eine Instagram-DM, ein Kontaktformular-Screenshot oder eine handschriftliche Notiz). Lies die sichtbaren Angaben zu der anfragenden Person sorgfältig aus und gib AUSSCHLIESSLICH ein JSON-Objekt zurück, ohne Erklärung, ohne Markdown, ohne Backticks.

Das JSON hat genau diese Felder (fehlende Werte als leerer String "", niemals raten):
{
  "vorname": "",
  "name": "",
  "tel": "",        // Handynummer oder Festnetz, so wie im Bild geschrieben
  "klasse": "",      // gewünschte Führerscheinklasse, z.B. "B", falls erkennbar - sonst ""
  "notiz": ""        // kurze Zusammenfassung des Anliegens/Kontexts in 1-2 Sätzen, z.B. "möchte im Frühjahr anfangen, fragt nach Preisen" - fasse zusammen, zitiere nicht den ganzen Chatverlauf
}

Wichtig: Bei "Vorname Nachname" zerlege den Namen korrekt. Telefonnummer exakt übernehmen. Die Notiz ist eine kurze eigene Zusammenfassung, kein Zitat. Gib nur das JSON zurück.`;

  const payload = {
    model: "claude-sonnet-5",
    max_tokens: 512,
    // claude-sonnet-5 denkt ohne explizite Angabe standardmäßig nach, und max_tokens deckelt
    // Denken + Antwort zusammen - dabei kann das gesamte Budget fürs Denken draufgehen und für
    // die eigentliche JSON-Antwort nichts übrig lassen. Denken ist hier nicht nötig.
    thinking: { type: "disabled" },
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          { type: "text", text: instruction },
        ],
      },
    ],
  };

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : "KI-Anfrage fehlgeschlagen";
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
    }

    let text = "";
    if (Array.isArray(data.content)) {
      text = data.content.map((c) => (c && c.type === "text" ? c.text : "")).join("").trim();
    }
    text = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Antwort konnte nicht gelesen werden", raw: text }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ interessent: parsed }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
