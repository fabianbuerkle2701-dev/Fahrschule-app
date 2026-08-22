// Der API-Schlüssel kommt NICHT hierher, sondern aus den Netlify-Umgebungsvariablen.
// In Netlify: Site settings -> Environment variables -> ANTHROPIC_API_KEY hinterlegen.
//
// Schlägt anhand des freien Fahrstunden-Textes (Thema/gut/schlecht) vor, welche ADK/Strecken-
// Punkte aus dem Katalog der Fahrschule wahrscheinlich in dieser Stunde geübt wurden. Anders als
// extract-adk.js (liest eine ECHTE Markierung von einem fotografierten Kärtchen ab) rät diese
// Funktion aus Freitext - deutlich schwächere Evidenz. Deshalb absichtlich zurückhaltend im
// Prompt: lieber wenige, sichere Vorschläge als viele geratene. Der Client übernimmt ohnehin
// nichts automatisch (siehe suggestAdkFromLesson()/applyAdkImport() in index.html) - jede Zeile
// braucht einen expliziten Tap.

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

  const thema = (body.thema || "").toString().trim().slice(0, 200);
  const gut = (body.gut || "").toString().trim().slice(0, 500);
  const schlecht = (body.schlecht || "").toString().trim().slice(0, 500);
  const sections = Array.isArray(body.sections) ? body.sections.slice(0, 40) : [];
  if (!thema && !gut && !schlecht) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Kein Stundentext übergeben" }) };
  }
  if (sections.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Kein Punkte-Katalog übergeben" }) };
  }

  // Katalog kompakt für den Prompt aufbereiten: nur id/label je Punkt, keine Zähler - die Anzahl
  // der Wiederholungen kann aus einem Stichwort ohnehin nicht seriös geschätzt werden, das
  // übernimmt der Client (immer genau ein Schritt mehr als der aktuelle Stand).
  const katalogText = sections.map(sec =>
    sec.title + " (" + sec.id + "):\n" + (sec.items || []).map(it => "  - " + it.id + ": " + it.label).join("\n")
  ).join("\n\n");

  const instruction = `Ein Fahrlehrer hat nach einer Fahrstunde folgenden kurzen Text notiert:
Thema: ${thema || "(keins)"}
Was lief gut: ${gut || "(nichts notiert)"}
Was lief schlecht: ${schlecht || "(nichts notiert)"}

Hier ist der vollständige Katalog der ADK-Lerninhalte und Strecken-Punkte dieser Fahrschule (Format "Abschnitt (section-id): - point-id: Bezeichnung"):

${katalogText}

Schlage vor, welche EINZELNEN Punkte aus diesem Katalog in dieser Stunde wahrscheinlich geübt wurden, basierend NUR auf dem Stundentext oben. Gib AUSSCHLIESSLICH ein JSON-Objekt zurück, ohne Erklärung, ohne Markdown, ohne Backticks:
{
  "points": [
    { "sectionId": "adk:xyz", "pointId": "abc", "confidence": "hoch" }
  ],
  "note": ""
}

Regeln:
1. Schlage NUR Punkte vor, die eindeutig zum Text passen - z.B. "Kreisverkehr" im Thema passt zu einem Punkt "Kreisverkehr" oder "Vorfahrt", nicht zu "Einparken".
2. Höchstens 6 Vorschläge insgesamt. Lieber 1-2 sichere Vorschläge als viele geratene.
3. confidence "hoch" nur bei eindeutigem Bezug (Punktname taucht sinngemäß im Text auf), sonst "mittel" oder "niedrig".
4. sectionId und pointId müssen EXAKT aus dem obigen Katalog stammen (inklusive des Präfixes "adk:" oder "strecken:" vor der section-id), erfinde niemals eigene IDs.
5. Wenn der Text zu allgemein ist (z.B. nur "normale Fahrstunde" ohne Details), gib ein leeres "points"-Array zurück statt zu raten, und erkläre das kurz in "note".
6. Gib nur das JSON zurück.`;

  const payload = {
    model: "claude-sonnet-5",
    max_tokens: 1024,
    // claude-sonnet-5 denkt ohne explizite Angabe standardmäßig nach, und max_tokens deckelt
    // Denken + Antwort zusammen - dabei kann das gesamte Budget fürs Denken draufgehen und für
    // die eigentliche JSON-Antwort nichts übrig lassen. Denken ist hier nicht nötig.
    thinking: { type: "disabled" },
    messages: [
      { role: "user", content: [{ type: "text", text: instruction }] },
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

    const points = Array.isArray(parsed.points) ? parsed.points : [];
    return { statusCode: 200, headers, body: JSON.stringify({ points, note: parsed.note || "" }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
