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

  const header = Array.isArray(body.header) ? body.header : [];
  const samples = Array.isArray(body.samples) ? body.samples.slice(0, 5) : [];
  if (header.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Spaltenüberschriften übergeben" }) };
  }
  // Harte Obergrenze: eine Fahrschul-Exportdatei hat keine 200 Spalten. Schützt davor, dass
  // eine kaputt geparste Datei einen riesigen (und teuren) Prompt erzeugt.
  if (header.length > 200) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Zu viele Spalten - ist die Datei wirklich eine CSV mit Semikolon oder Komma als Trenner?" }) };
  }

  const FELDER = ["vorname","name","geburtstag","handy","festnetz","email","adresse",
    "anmeldedatum","klasse","theorie_bestanden"];

  const tabelle = [header.join(" | ")]
    .concat(samples.map((r) => (Array.isArray(r) ? r : []).join(" | ")))
    .join("\n");

  const instruction = `Du bekommst die Kopfzeile und bis zu fünf Beispielzeilen einer CSV-Datei aus einer deutschen Fahrschul-Verwaltungssoftware. Ordne die Spalten den Zielfeldern zu.

Spalten (Index 0 bis ${header.length - 1}):
${tabelle}

Gib AUSSCHLIESSLICH ein JSON-Objekt zurück, ohne Erklärung, ohne Markdown, ohne Backticks:
{
  "mapping": { ${FELDER.map((f) => '"' + f + '": null').join(", ")} },
  "hinweis": ""
}

Regeln:
- Werte im mapping sind der Spaltenindex als Zahl, oder null wenn die Spalte fehlt.
- Rate NICHT. Wenn du dir bei einer Spalte nicht sicher bist, setze null.
- Steht der volle Name in EINER Spalte (z.B. "Müller, Anna" oder "Anna Müller"), ordne diese Spalte "name" zu und lasse "vorname" auf null. Schreibe in "hinweis" kurz, dass Namen geteilt werden müssen.
- "handy" ist die Mobilnummer, "festnetz" die Festnetznummer. Gibt es nur eine Telefonspalte, nimm "handy".
- "adresse" darf aus einer einzelnen Spalte kommen; sind Straße, PLZ und Ort getrennt, nimm die Straßenspalte und erwähne das in "hinweis".
- "theorie_bestanden" nur, wenn die Spalte erkennbar das Datum der bestandenen Theorieprüfung enthält.
- "hinweis" ist ein kurzer deutscher Satz oder leer.`;

  const payload = {
    model: "claude-sonnet-5",
    max_tokens: 1024,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: [{ type: "text", text: instruction }] }],
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
    // Serverseitig auf gueltige Spaltenindizes eindampfen: ein halluzinierter Index wuerde
    // sonst im Client stillschweigend zu leeren Feldern oder zu Werten aus falschen Spalten fuehren.
    const roh = (parsed && parsed.mapping) || {};
    const mapping = {};
    FELDER.forEach((f) => {
      const v = roh[f];
      mapping[f] = (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < header.length) ? v : null;
    });
    return { statusCode: 200, headers, body: JSON.stringify({ mapping, hinweis: String((parsed && parsed.hinweis) || "").slice(0, 300) }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
