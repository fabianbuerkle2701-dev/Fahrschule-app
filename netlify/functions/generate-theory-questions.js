// Der API-Schlüssel kommt NICHT hierher, sondern aus den Netlify-Umgebungsvariablen.
// In Netlify: Site settings -> Environment variables -> ANTHROPIC_API_KEY hinterlegen.
//
// Erzeugt NEUE, frei erfundene Übungsfragen fürs "Theorie üben" (theory_questions,
// is_sample=true) - NIEMALS Fragen aus dem amtlichen, lizenzpflichtigen Fragenkatalog
// nachbilden oder paraphrasieren (siehe Entscheidung gegen eine Lizenzierung, THEORY_UEBEN_
// RELEASED bleibt bewusst aus). Der Prompt verlangt deshalb explizit ORIGINÄRE, selbst
// ausgedachte Fragen zu einem Sachgebiet, keine Wiedergabe bekannter Prüfungsfragen.
// Gibt nur einen ENTWURF zurück - das eigentliche Einfügen in theory_questions passiert
// erst nach Prüfung durch den Fahrlehrer, client-seitig über eine eigene RLS-Policy
// (is_sample=true erzwungen), nicht durch diese Funktion.

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

  const topic = (body.topic || "").toString().trim().slice(0, 120);
  const klasse = (body.klasse || "B").toString().trim().slice(0, 10);
  const count = Math.max(1, Math.min(8, parseInt(body.count, 10) || 5));
  const avoid = Array.isArray(body.avoidTexts) ? body.avoidTexts.slice(0, 15).map(t => String(t || "").slice(0, 200)) : [];
  if (!topic) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Kein Sachgebiet übergeben" }) };
  }

  const avoidBlock = avoid.length
    ? "Bereits vorhandene Fragen zu diesem Thema (NICHT wiederholen, andere Situationen/Aspekte wählen):\n" + avoid.map(t => "- " + t).join("\n")
    : "Noch keine vorhandenen Fragen zu diesem Thema.";

  const instruction = `Du erstellst Übungsfragen für angehende Fahrschüler (Führerscheinklasse ${klasse}) zum Sachgebiet "${topic}".

WICHTIG: Diese Fragen sind KEINE amtlichen Prüfungsfragen und dürfen keine bekannte, real existierende Prüfungsfrage nachbilden oder paraphrasieren. Denke dir ${count} völlig neue, eigenständige Multiple-Choice-Fragen aus, die dieselbe Kompetenz sinnvoll prüfen, im Stil und Schwierigkeitsgrad realistischer Fahrschul-Theoriefragen, aber mit eigenen Formulierungen, eigenen Situationen und eigenen Zahlen/Beispielen.

${avoidBlock}

Gib AUSSCHLIESSLICH ein JSON-Objekt zurück, ohne Erklärung, ohne Markdown, ohne Backticks:
{
  "questions": [
    {
      "question": "Fragetext",
      "options": [
        { "text": "Antwortoption 1", "correct": false },
        { "text": "Antwortoption 2", "correct": true },
        { "text": "Antwortoption 3", "correct": false }
      ],
      "points": 3,
      "explanation": "Kurze, verständliche Begründung der richtigen Antwort(en), 1-2 Sätze."
    }
  ]
}

Regeln: 3 oder 4 Antwortoptionen pro Frage, mindestens eine davon "correct": true (bei manchen Fragen dürfen auch mehrere Optionen richtig sein, das ist bei echten Theoriefragen üblich). "points" ist die Fehlerpunkt-Gewichtung bei falscher Antwort, ganzzahlig zwischen 2 und 5 (höher = schwerwiegenderer Fehler). Schreibe alles auf Deutsch. Gib nur das JSON zurück, exakt ${count} Fragen im "questions"-Array.`;

  const payload = {
    model: "claude-sonnet-5",
    max_tokens: 3200,
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

    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
    return { statusCode: 200, headers, body: JSON.stringify({ questions }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
