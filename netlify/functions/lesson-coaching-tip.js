// Der API-Schlüssel kommt NICHT hierher, sondern aus den Netlify-Umgebungsvariablen.
// In Netlify: Site settings -> Environment variables -> ANTHROPIC_API_KEY hinterlegen.
//
// Gleiche Auth-/Abo-Prüfung wie draft-lesson-entry.js und suggest-adk-items.js. Anders als
// diese beiden geht es hier nicht um einen Tagebuch-Entwurf oder eine ADK/Strecken-Zuordnung,
// sondern um eine konkrete pädagogische Methode fuer EIN bestimmtes, vom Fahrlehrer im Feld
// "Was lief schlecht" notiertes Problem - "wie bekomme ich das in den Griff".

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
// Der öffentliche Anon-Key - dient hier nur zum Prüfen, ob das mitgeschickte Token zu einer
// echten, angemeldeten Sitzung gehört. Kein Geheimnis, genau wie in index.html.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdnVmdGxmbmtudWN4dW9ydGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDQ2NDQsImV4cCI6MjA5Njg4MDY0NH0.5ZoBdQLnJw23dMZ4IKmAauycVcPoVPIZdmNamZ8MEv8";

const LESSON_FIELDS = [
  { id: "verkehr", label: "Verkehrsbeobachtung" },
  { id: "position", label: "Fahrzeugpositionierung" },
  { id: "tempo", label: "Geschwindigkeitsanpassung" },
  { id: "komm", label: "Kommunikation" },
  { id: "bedien", label: "Fahrzeugbedienung" },
];

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

  const schlecht = (body.schlecht || "").toString().trim().slice(0, 500);
  if (!schlecht) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Kein Problem angegeben" }) };
  }
  const thema = (body.thema || "").toString().trim().slice(0, 200);
  const gut = (body.gut || "").toString().trim().slice(0, 500);
  const klasse = (body.klasse || "").toString().trim().slice(0, 10);
  const ratings = (body.ratings && typeof body.ratings === "object") ? body.ratings : {};
  const recent = Array.isArray(body.recent) ? body.recent.slice(0, 3) : [];

  const schwacheBereiche = LESSON_FIELDS.filter(f => ratings[f.id] === 1).map(f => f.label).join(", ");

  const recentText = recent.length === 0 ? "Keine vorherigen Einträge zu diesem Schüler." : recent.map((l, i) => {
    return "Stunde " + (i + 1) + (l.date ? " (" + l.date + ")" : "") + ": "
      + (l.thema ? "Thema \"" + l.thema + "\". " : "")
      + (l.schlecht ? "Problem damals: " + l.schlecht + ". " : "")
      + (l.gut ? "Gut lief: " + l.gut + ". " : "");
  }).join("\n");

  const instruction = `Du bist ein erfahrener Fahrlehrer-Coach. Ein Fahrlehrer hat in seinem Tagebuch zu einer Fahrstunde ein konkretes Problem eines Fahrschülers notiert und möchte einen praktischen Vorschlag, wie er dieses Problem in den Griff bekommt - kein allgemeiner Ratschlag, sondern eine konkrete Methode für die NÄCHSTE Fahrstunde mit genau diesem Schüler.

Führerscheinklasse: ${klasse || "nicht angegeben"}
Thema der aktuellen Stunde: ${thema || "nicht angegeben"}
Notiertes Problem: "${schlecht}"
${gut ? 'Was in dieser Stunde gut lief: "' + gut + '"' : ""}
${schwacheBereiche ? "Als schwach bewertete Teilkompetenzen dieser Stunde: " + schwacheBereiche : ""}

Bisherige Einträge dieses Schülers (prüfe, ob sich das Problem wiederholt - wenn ja, schlage bewusst eine ANDERE Methode vor als beim letzten Mal, nicht dieselbe, die schon nicht geholfen hat):
${recentText}

Gib AUSSCHLIESSLICH ein JSON-Objekt zurück, ohne Erklärung, ohne Markdown, ohne Backticks, mit genau diesen Feldern:
{
  "problem": "",        // 1 knapper Satz: das eigentliche Problem, in eigenen Worten präzisiert
  "ursache": "",         // 1 Satz: wahrscheinlichste Ursache (z.B. Unsicherheit, falscher Blickpunkt, Zeitdruck, Übersehen, fehlende Routine)
  "methode": "",         // 2-3 Sätze: eine konkrete, in der nächsten Fahrstunde direkt umsetzbare Übung oder Methode, die genau auf diese Ursache zielt
  "hinweis_schueler": "" // 1 kurzer, freundlicher Satz direkt an den Schüler gerichtet, den der Fahrlehrer 1:1 als Hinweis übernehmen könnte
}

Sei konkret und praxisnah, keine allgemeinen Floskeln wie "einfach mehr üben". Beziehe dich wo sinnvoll auf die Situation im Straßenverkehr in Deutschland (Regeln, übliche Fahrschulpraxis). Gib nur das JSON zurück.`;

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
        content: [{ type: "text", text: instruction }],
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

    return { statusCode: 200, headers, body: JSON.stringify({ tip: parsed }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
