netlify/functions/assistant.js
// Nimmt eine Anweisung in normaler Sprache + eine Schülerliste entgegen
// und gibt strukturiert zurück, welche Aktion ausgeführt werden soll.
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

  const message = (body.message || "").toString();
  const students = Array.isArray(body.students) ? body.students : [];
  const today = (body.today || "").toString();
  const adk = Array.isArray(body.adk) ? body.adk : [];
  const strecken = Array.isArray(body.strecken) ? body.strecken : [];
  if (!message.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Anweisung übergeben" }) };

  // Schülerliste kompakt: nur Id und Name, damit die KI eindeutig zuordnen kann
  const roster = students.map((s) => ({ id: s.id, name: ((s.vorname || "") + " " + (s.name || "")).trim() }));

  const system = `Du bist der Eintragungs-Helfer einer Fahrschul-App. Der Fahrlehrer gibt dir eine Anweisung in normaler Sprache. Deine Aufgabe ist es, daraus GENAU EINE Aktion abzuleiten und als reines JSON zurückzugeben. Kein Text, kein Markdown, keine Backticks.

Heutiges Datum: ${today || "unbekannt"}

Verfügbare Schüler (id und Name):
${JSON.stringify(roster)}

Verfügbare ADK-Punkte (Ausbildungsnachweis, id, label, count=Soll-Anzahl):
${JSON.stringify(adk)}

Verfügbare Strecken-Punkte (id, label, count=Soll-Anzahl):
${JSON.stringify(strecken)}

Aktuell unterstützte Aktionen: "fahrstunde" (gefahrene Fahrstunde eintragen), "termin" (Termin im Kalender anlegen), "zahlung" (Zahlung erfassen), "adk" (einen ADK-Punkt auf einen Stand setzen) und "strecken" (einen Streckenpunkt auf einen Stand setzen).

Gib ein JSON-Objekt in genau diesem Format zurück:
{
  "action": "fahrstunde" | "termin" | "zahlung" | "adk" | "strecken" | "unknown",
  "studentId": "<id des gemeinten Schülers oder leer>",
  "studentName": "<Name zur Anzeige>",
  "date": "JJJJ-MM-TT",
  "time": "HH:MM",
  "minutes": <Zahl, Dauer in Minuten>,
  "amount": <Zahl, Betrag in Euro; nur bei action zahlung>,
  "title": "<Titel/Notiz des Termins, nur bei action termin>",
  "targetId": "<id des ADK- oder Streckenpunkts; nur bei action adk/strecken>",
  "targetLabel": "<label des Punkts zur Anzeige>",
  "value": "voll" | <Zahl>,
  "needsClarification": <true|false>,
  "clarification": "<kurze Rückfrage falls etwas fehlt oder mehrdeutig ist, sonst leer>",
  "summary": "<ein Satz, was eingetragen wird, zur Bestätigung>"
}

Regeln:
- Ordne den Schüler eindeutig über die Namensliste zu. Bei mehreren/keinem Treffer: needsClarification true, studentId leer. Ausnahme: Termin ohne Schülerbezug (z.B. "Theorie", "Urlaub").
- Relative Datumsangaben anhand des heutigen Datums in JJJJ-MM-TT umrechnen.
- action "fahrstunde": Schüler immer nötig; ohne Uhrzeit oder Dauer needsClarification true.
- action "termin": title sinnvoll setzen; ohne Uhrzeit oder Dauer needsClarification true.
- action "zahlung": Schüler und amount immer nötig; ohne Datum heutiges Datum nehmen (keine Rückfrage). Komma als Dezimaltrennzeichen.
- action "adk" oder "strecken": Finde den passenden Punkt aus dem jeweiligen Katalog und gib seine targetId und targetLabel zurück. Wenn der Nutzer "erledigt", "fertig", "voll", "alle", "abgeschlossen" oder Ähnliches sagt, setze value auf "voll". Wenn er eine konkrete Anzahl nennt (z.B. "3 von 5"), setze value auf diese Zahl. Wenn kein Punkt eindeutig passt, needsClarification true und in clarification nach dem genauen Punkt fragen, targetId leer. WICHTIG: Unterscheide ADK-Punkte von Strecken-Punkten anhand der beiden Kataloge und wähle die richtige action.
- Wenn die Anweisung zu keiner Aktion passt: action "unknown" und in clarification die möglichen Aktionen nennen.
- summary immer in klarem Deutsch.`;

  const payload = {
    model: "claude-sonnet-4-6",
    max_tokens: 700,
    system,
    messages: [{ role: "user", content: message }],
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
    return { statusCode: 200, headers, body: JSON.stringify({ result: parsed }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
