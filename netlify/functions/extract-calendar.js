// Netlify Function: Kalender-Screenshot auslesen.
// Nimmt ein oder mehrere Bilder einer Kalenderansicht (z.B. you-drive Wochenansicht)
// und gibt die erkannten Termine strukturiert zurück.
// Der Schlüssel kommt aus der Netlify-Umgebungsvariable ANTHROPIC_API_KEY.

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

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Nur POST erlaubt" }) };

  // Nur angemeldete Fahrlehrer dürfen diese Funktion nutzen - sie kostet pro Aufruf echtes
  // Anthropic-Guthaben und war vorher komplett offen im Internet aufrufbar. Diese Prüfung
  // kommt bewusst vor dem API-Schlüssel-Check.
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
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "Kein API-Schlüssel hinterlegt (ANTHROPIC_API_KEY)." }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Ungültige Anfrage" }) }; }

  const images = Array.isArray(body.images) ? body.images : [];
  const today = (body.today || "").toString();
  const students = Array.isArray(body.students) ? body.students : [];
  if (!images.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Bilder übergeben" }) };

  // Bilder in Anthropic-Bildblöcke umwandeln
  const imageBlocks = images.map((dataUrl) => {
    const m = /^data:(.*?);base64,(.*)$/.exec(dataUrl || "");
    const mediaType = m ? m[1] : "image/jpeg";
    const data = m ? m[2] : "";
    return { type: "image", source: { type: "base64", media_type: mediaType, data } };
  });

  const roster = students.map((s) => ({ name: ((s.vorname || "") + " " + (s.name || "")).trim() }));

  const system = `Du liest Termine aus einem Screenshot einer Kalender-App (z.B. you-drive Manager) für eine Fahrschule aus. Gib die erkannten Termine als reines JSON zurück, kein Text, keine Backticks.

Heutiges Datum: ${today || "unbekannt"}

Bekannte Schülernamen (zur Zuordnung):
${JSON.stringify(roster)}

Auf dem Screenshot ist die TAGESANSICHT eines Tages zu sehen. Oben steht das Datum (z.B. "25. Juni 2026") und der Wochentag. Darunter sind die Termine als farbige Blöcke, jeweils mit Uhrzeit (z.B. "9:00 - 10:30") und einem Titel wie "ÜST Alyna Wendling (Leistung gebucht)". "ÜST" bedeutet Übungsstunde. In der Tagesansicht sind die Namen meist vollständig und gut lesbar.

Gib ein JSON-Objekt in genau diesem Format zurück:
{
  "appointments": [
    {
      "date": "JJJJ-MM-TT",
      "start": "HH:MM",
      "end": "HH:MM",
      "rawText": "<der erkannte Text, z.B. der Name>",
      "studentName": "<voller Name des zugeordneten Schülers aus der Liste, oder leer wenn unsicher>",
      "matched": <true wenn du den Schüler sicher zuordnen konntest, sonst false>
    }
  ],
  "note": "<kurzer Hinweis, falls etwas unklar war, sonst leer>"
}

Regeln:
- Lies ALLE sichtbaren Termine dieses Tages aus.
- Datum: Nutze das oben sichtbare Datum für alle Termine. Wenn du das Jahr nicht sicher erkennst, nimm das Jahr aus dem heutigen Datum.
- Uhrzeiten immer im Format HH:MM (z.B. "09:00", "10:30").
- Entferne Zusätze wie "ÜST", "(Leistung gebucht)" aus studentName, aber behalte den erkannten Originaltext in rawText.
- Ordne den Namen einem bekannten Schüler zu, wenn er klar passt (auch bei kleinen Abweichungen). In der Tagesansicht sind die Namen meist vollständig, ordne also möglichst zu. Nur bei echter Unsicherheit: matched false und studentName leer, rawText trotzdem füllen.
- Erfinde KEINE Termine. Nur was wirklich sichtbar ist.
- Wenn gar kein Termin erkennbar ist, gib eine leere Liste zurück und erkläre es in note.`;

  const payload = {
    model: "claude-sonnet-5",
    max_tokens: 2000,
    // claude-sonnet-5 denkt ohne explizite Angabe standardmäßig nach, und max_tokens deckelt
    // Denken + Antwort zusammen - dabei kann das gesamte Budget fürs Denken draufgehen und für
    // die eigentliche JSON-Antwort nichts übrig lassen. Denken ist hier nicht nötig.
    thinking: { type: "disabled" },
    system,
    messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: "Lies bitte alle Termine aus diesem Kalender aus." }] }],
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
    if (Array.isArray(data.content)) text = data.content.map((c) => (c && c.type === "text" ? c.text : "")).join("").trim();
    text = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return { statusCode: 502, headers, body: JSON.stringify({ error: "Antwort konnte nicht gelesen werden", raw: text }) }; }
    return { statusCode: 200, headers, body: JSON.stringify(parsed) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
