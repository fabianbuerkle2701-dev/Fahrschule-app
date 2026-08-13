// Der API-Schlüssel kommt NICHT hierher, sondern aus den Netlify-Umgebungsvariablen.
// In Netlify: Site settings -> Environment variables -> ANTHROPIC_API_KEY hinterlegen.

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
// Der öffentliche Anon-Key - dient hier nur zum Prüfen, ob das mitgeschickte Token zu einer
// echten, angemeldeten Sitzung gehört. Kein Geheimnis, genau wie in index.html.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdnVmdGxmbmtudWN4dW9ydGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDQ2NDQsImV4cCI6MjA5Njg4MDY0NH0.5ZoBdQLnJw23dMZ4IKmAauycVcPoVPIZdmNamZ8MEv8";

exports.handler = async function (event) {
  // CORS, damit die App die Funktion aufrufen darf
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
  // Anthropic-Guthaben und war vorher komplett offen im Internet aufrufbar (jede Website, jedes
  // Skript, ohne Konto). Diese Prüfung kommt bewusst vor dem API-Schlüssel-Check, damit ein
  // nicht angemeldeter Aufrufer nicht einmal erfährt, ob der Schlüssel konfiguriert ist.
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

  // Bild-Bausteine für Claude aufbereiten (Base64 ohne data:-Präfix)
  const imageBlocks = images.map((img) => {
    let data = img || "";
    let media = "image/jpeg";
    const m = data.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
    if (m) { media = m[1]; data = m[2]; }
    return { type: "image", source: { type: "base64", media_type: media, data } };
  });

  const instruction = `Du erhältst einen oder mehrere Screenshots aus der Fahrschul-Software you-drive für einen einzelnen Fahrschüler. Lies die sichtbaren Daten sorgfältig aus und gib AUSSCHLIESSLICH ein JSON-Objekt zurück, ohne Erklärung, ohne Markdown, ohne Backticks.

Das JSON hat genau diese Felder (fehlende Werte als leerer String "" bzw. 0 bei Zahlen, niemals raten):
{
  "vorname": "",
  "name": "",
  "geburtstag": "",        // Format TT.MM.JJJJ
  "handy": "",
  "festnetz": "",
  "email": "",
  "adresse": "",           // Straße Hausnummer, PLZ Ort in einer Zeile
  "anmeldedatum": "",      // Format TT.MM.JJJJ
  "klasse": "",            // z.B. "B (197)" oder "B"
  "sehhilfe": false,       // true wenn "Benötigt Sehhilfe" erkennbar
  "theorie_bestanden": "", // Datum TT.MM.JJJJ falls Theorieprüfung bestanden, sonst ""
  "uebungsfahrten": 0,
  "autobahnfahrten": 0,
  "ueberlandfahrten": 0,
  "beleuchtungsfahrten": 0,
  "grundfahraufgaben": 0
}

Wichtig: Bei "Schüler: Vorname Nachname" zerlege den Namen korrekt in vorname und name. Telefonnummern exakt übernehmen. Gib nur das JSON zurück.`;

  const payload = {
    model: "claude-sonnet-5",
    max_tokens: 1024,
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

    // Text aus der Antwort holen
    let text = "";
    if (Array.isArray(data.content)) {
      text = data.content.map((c) => (c && c.type === "text" ? c.text : "")).join("").trim();
    }
    // Eventuelle Backticks entfernen
    text = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Antwort konnte nicht gelesen werden", raw: text }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ student: parsed }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
