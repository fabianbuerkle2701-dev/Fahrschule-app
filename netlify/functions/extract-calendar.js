// Netlify Function: Kalender-Screenshot auslesen.
// Nimmt ein oder mehrere Bilder einer Kalenderansicht (z.B. you-drive Wochenansicht)
// und gibt die erkannten Termine strukturiert zurück.
// Der Schlüssel kommt aus der Netlify-Umgebungsvariable ANTHROPIC_API_KEY.

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Nur POST erlaubt" }) };

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
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
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
