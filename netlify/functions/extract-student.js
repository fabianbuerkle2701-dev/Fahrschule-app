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
    // Der oeffentliche Website-Demo-Account darf keine KI-/Bezahl-Funktionen ausloesen
    // (verhindert Anthropic-Kosten durch Missbrauch des oeffentlichen Demo-Tokens).
    const whoData = await whoResp.json().catch(() => null);
    if (whoData && whoData.id === "114d1f0a-9947-459d-8009-06282799ca44") {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Diese Funktion ist im Demo-Modus deaktiviert." }) };
    }
    // Nur Konten mit aktivem Abo duerfen KI ausloesen (Anthropic-Kosten). Faellt fail-open aus.
    const kiGate = await require("./lib/ki-guard").subscriptionGate(whoData && whoData.id, requesterToken);
    if (!kiGate.ok) {
      return { statusCode: kiGate.statusCode, headers, body: JSON.stringify({ error: kiGate.error }) };
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

  // Wie bei den anderen KI-Funktionen (generate-theory-questions.js: count/avoidTexts,
  // map-import-columns.js: header/samples, match-kontoauszug.js: lines/students) wird das
  // client-kontrollierte Array vor dem Weiterreichen an Anthropic gedeckelt - sonst könnte ein
  // Aufruf mit dutzenden Bildern die Kosten weit über eine normale "Foto vom Anmeldeformular"-
  // Nutzung treiben (jedes Bild zählt als eigener Bildblock in den Input-Tokens). 6 Bilder
  // reichen für ein mehrseitiges Formular inkl. Rückseite.
  const images = (Array.isArray(body.images) ? body.images : (body.image ? [body.image] : [])).slice(0, 6);
  if (images.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Kein Bild übergeben" }) };
  }
  // Serverseitiger Größen-Deckel pro Bild, zusätzlich zum Client-Check ("Bild ist zu groß (max.
  // 8 MB)", siehe index.html) - diese Funktion ist auch direkt ohne Frontend aufrufbar, das
  // Client-Limit allein reicht also nicht.
  if (images.some((img) => typeof img === "string" && img.length > 11 * 1024 * 1024)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Bild ist zu groß (max. 8 MB)." }) };
  }

  // Bild-Bausteine für Claude aufbereiten (Base64 ohne data:-Präfix)
  const imageBlocks = images.map((img) => {
    // img könnte auch eine Zahl/Objekt/Array sein (missgebildete Anfrage) - dann würde
    // .match unten crashen, bevor der try/catch weiter unten greift. Als String erzwingen.
    let data = typeof img === "string" ? img : "";
    let media = "image/jpeg";
    const m = data.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
    if (m) { media = m[1]; data = m[2]; }
    return { type: "image", source: { type: "base64", media_type: media, data } };
  });

  const instruction = `Du erhältst ein oder mehrere Fotos oder Screenshots eines Schülerdokuments für einen einzelnen Fahrschüler (z.B. ein Anmeldeformular, eine Karteikarte oder ein Screenshot aus einer anderen Fahrschul-Verwaltungssoftware). Lies die sichtbaren Daten sorgfältig aus und gib AUSSCHLIESSLICH ein JSON-Objekt zurück, ohne Erklärung, ohne Markdown, ohne Backticks.

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
