// Netlify Function: KI-Helfer für die Fahrschul-App.
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

  // Schülerliste wird bereits reichhaltig übergeben (inkl. offen, bezahlt, Prozente, Theorie)
  const roster = students;

  const system = `Du bist der Assistent einer Fahrschul-App für den Fahrlehrer. Du kannst zwei Dinge: (A) Fragen frei beantworten und Übersichten geben, und (B) Eintragungen vorbereiten, die der Fahrlehrer dann bestätigt. Antworte immer mit reinem JSON, kein Text drumherum, keine Backticks.

Heutiges Datum: ${today || "unbekannt"}

Verfügbare Schüler mit ihren aktuellen Daten (alle Beträge in Euro):
${JSON.stringify(roster)}

Bedeutung der Felder: vorname, name, telefon; theorie (Theorieprüfung bestanden true/false); adkProzent (Fortschritt Ausbildungsnachweis); streckenProzent; gesamtProzent; fahrstunden (Anzahl gefahrener Fahrstunden); gefahreneMinuten; berechnet (Summe der Kosten); bezahlt (Summe der Zahlungen); offen (offener Betrag, negativ bedeutet Guthaben).

Verfügbare ADK-Punkte (id, label, count=Soll):
${JSON.stringify(adk)}

Verfügbare Strecken-Punkte (id, label, count=Soll):
${JSON.stringify(strecken)}

Du gibst IMMER ein JSON-Objekt zurück. Entscheide zuerst, ob die Nachricht eine FRAGE ist (dann antwortest du) oder eine AUFGABE/EINTRAGUNG (dann bereitest du eine Aktion vor).

Format:
{
  "action": "antwort" | "fahrstunde" | "termin" | "zahlung" | "adk" | "strecken" | "unknown",
  "answer": "<bei action antwort: deine Antwort in klarem, freundlichem Deutsch>",
  "studentId": "<id des Schülers, bei Aktionen>",
  "studentName": "<Name zur Anzeige>",
  "date": "JJJJ-MM-TT",
  "time": "HH:MM",
  "minutes": <Zahl>,
  "amount": <Zahl, nur bei zahlung>,
  "title": "<nur bei termin>",
  "targetId": "<nur bei adk/strecken>",
  "targetLabel": "<label>",
  "value": "voll" | <Zahl>,
  "needsClarification": <true|false>,
  "clarification": "<Rückfrage falls nötig>",
  "summary": "<ein Satz zur Bestätigung bei Aktionen>"
}

Regeln für action "antwort" (FRAGEN und ÜBERSICHTEN):
- Nutze die Schülerdaten oben, um die Frage konkret zu beantworten. Beispiele: "Wer hat offene Beträge?" -> liste die Schüler mit offen > 0 samt Betrag. "Wie viele haben die Theorie?" -> zähle theorie true. "Wie weit ist Clara?" -> nenne ihre Prozentwerte und offenen Betrag.
- Schreibe natürlich und auf den Punkt. Bei Listen darfst du Namen mit Beträgen in Zeilen auflisten. Keine Tabellen, keine erfundenen Zahlen, nur die vorhandenen Daten.
- Wenn die Daten für eine Antwort nicht ausreichen, sag das ehrlich.
- Beträge mit zwei Nachkommastellen und Euro-Zeichen, z.B. 65,00 €.

Regeln für Aktionen (EINTRAGUNGEN), wie bisher:
- Schüler eindeutig über die Namen zuordnen. Bei mehreren/keinem Treffer needsClarification true.
- "fahrstunde": Schüler immer nötig; ohne Uhrzeit oder Dauer needsClarification true.
- "termin": title setzen; ohne Uhrzeit oder Dauer needsClarification true.
- "zahlung": Schüler und amount nötig; ohne Datum heutiges Datum (keine Rückfrage). Komma als Dezimaltrennzeichen.
- "adk"/"strecken": passenden Punkt aus dem Katalog finden, targetId und targetLabel zurückgeben. "erledigt"/"fertig"/"voll" -> value "voll", sonst konkrete Zahl.
- Relative Datumsangaben in JJJJ-MM-TT umrechnen.
- Wenn unklar, ob Frage oder Aktion, und es klingt nach einer Information: nimm "antwort".`;

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
