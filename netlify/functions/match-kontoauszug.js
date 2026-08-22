// Netlify Function: KI-gestützte Zahlungszuordnung für Kontoauszug-Zeilen, die die bestehende
// Regex-Heuristik (findeRechnungsnummer/parseKontoauszug in index.html) NICHT erkennen konnte -
// weil die Bank keine Rechnungsnummer im Verwendungszweck überträgt, was in der Praxis die
// meisten Überweisungen betrifft (nur Name + Betrag, z.B. "Max Mustermann Überweisung 65,00").
// Die bestehende Funktion ignoriert solche Zeilen komplett; diese Function ist der Zweitversuch
// per Fuzzy-Matching (Zahlername vs. Schülername + Betrag).
//
// Bearer-Token-gated wie die anderen Bearer-Functions. Gibt nur VORSCHLÄGE zurück - das
// tatsächliche Buchen bleibt client-seitig bucheZahlung(), jede Zuordnung braucht weiterhin
// einen expliziten Tap, genau wie beim bestehenden regex-basierten Pfad. Bekommt NUR offene
// Rechnungen (Nummer, offener Betrag, Gesamtbetrag, Datum) und Schülernamen - keine
// Telefonnummern, Adressen oder sonstige Daten.

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
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
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "Kein API-Schlüssel hinterlegt (ANTHROPIC_API_KEY)." }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Ungültige Anfrage" }) }; }

  const lines = Array.isArray(body.lines) ? body.lines.slice(0, 100).map((l, i) => String(l || "").slice(0, 200)) : [];
  const students = Array.isArray(body.students) ? body.students.slice(0, 300) : [];
  if (lines.length === 0) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Zeilen übergeben" }) };
  if (students.length === 0) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine offenen Rechnungen übergeben" }) };

  const instruction = `Du gleichst Kontoauszug-Zeilen einer Fahrschule mit offenen Rechnungen ab, um Zahlungseingänge zuzuordnen. Die Zeilen enthalten KEINE Rechnungsnummer (die wurde schon per exaktem Abgleich versucht) - du musst über den ZAHLERNAMEN und den BETRAG matchen.

Kontoauszug-Zeilen (Index beginnt bei 0):
${lines.map((l, i) => i + ": " + l).join("\n")}

Schüler mit offenen Rechnungen:
${JSON.stringify(students, null, 2)}

Gib AUSSCHLIESSLICH ein JSON-Objekt zurück, ohne Erklärung, ohne Markdown, ohne Backticks:
{
  "matches": [
    { "lineIndex": 0, "studentId": "...", "invoiceId": "...", "betrag": 65.00, "confidence": "hoch" }
  ]
}

Regeln:
1. Ordne eine Zeile NUR zu, wenn der Name in der Zeile plausibel zu einem Schülernamen passt (Reihenfolge Vor-/Nachname darf vertauscht sein, Tippfehler/fehlende Umlaute sind ok) UND ein Betrag in der Zeile zu einer seiner offenen Rechnungen passt (exakt gleich dem offenen Betrag oder der Gesamtsumme, oder plausibel als Teilzahlung erkennbar geringer).
2. Bei mehreren offenen Rechnungen desselben Schülers wähle die, deren Betrag am besten passt; bei Gleichstand die älteste (kleinstes Datum).
3. confidence "hoch" nur bei eindeutigem Namens- UND Betragstreffer; "mittel" wenn nur einer von beiden eindeutig ist; "niedrig" bei Unsicherheit - im Zweifel lieber "niedrig" oder GAR NICHT zuordnen, als zu raten.
4. Jede Zeile höchstens einmal zuordnen, jede Rechnung höchstens einmal verwenden.
5. Zeilen ohne plausiblen Treffer einfach weglassen, nicht erzwingen.
6. Erfinde niemals eine studentId oder invoiceId, die nicht in den obigen Daten vorkommt.`;

  const payload = {
    model: "claude-sonnet-5",
    max_tokens: 2000,
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

    const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
    return { statusCode: 200, headers, body: JSON.stringify({ matches }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
