// Netlify Function: KI-Übergabe-Einschätzung eines Fahrschülers - für den Fall, dass ein
// Schüler an eine andere Lehrkraft übergeben wird oder die Fahrschule wechselt. Der Client
// schickt eine bereits zusammengestellte, reichhaltige Übersicht EINES Schülers (ADK/Strecken-
// Fortschritt, Fahrtenbuch-Notizen, Prüfungssimulation/Schaltkompetenz, Besonderheiten wie
// Sehhilfe/Lenkradposition) - bewusst OHNE Kosten/Zahlungen, die gehören nicht in eine
// fachliche Einschätzung. Claude fasst das zu einem zusammenhängenden Text zusammen.
//
// Bearer-Token-gated wie assistant.js (nur angemeldete Fahrlehrer, kostet echtes Guthaben).

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
  } catch (e) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Anmeldung konnte nicht geprüft werden" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "Kein API-Schlüssel hinterlegt (ANTHROPIC_API_KEY)." }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Ungültige Anfrage" }) }; }

  const student = body.student && typeof body.student === "object" ? body.student : null;
  if (!student || !student.name) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Schülerdaten übergeben" }) };

  const system = `Du schreibst eine vollständige Übergabe-Einschätzung eines Fahrschülers für eine neue Fahrlehrkraft oder eine neue Fahrschule (Fahrschulwechsel). Fasse ALLE unten stehenden Daten in einem gut strukturierten, sachlichen Text auf Deutsch zusammen, damit die neue Lehrkraft sofort weiß, wo der Schüler steht, ohne die kompletten Rohdaten selbst durchsuchen zu müssen.

Regeln, unbedingt einhalten:
1. Nutze AUSSCHLIESSLICH die unten stehenden Daten. Erfinde niemals Fortschritt, Ereignisse, Noten oder Aussagen, die dort nicht stehen.
2. Struktur (als Fließtext mit kurzen Absätzen, keine Tabellen):
   a) Kurzer Überblick: Klasse, Theorie-Status, Gesamtfortschritt, Anzahl gefahrener Fahrstunden.
   b) Ausbildungsstand im Detail: welche Abschnitte (ADK/Strecken) schon gut laufen, welche noch fehlen - nenne konkrete Abschnittsnamen mit Prozentwert, nicht nur Gesamtzahlen.
   c) Besonderheiten: Sehhilfe, Lenkrad-/Kopfstützen-Einstellung, sowie alle Freitext-Notizen (Bemerkungen, letzte Notiz, Streckennotizen) und wiederkehrende Schwächen aus dem Fahrtenbuch, falls vorhanden.
   d) Prüfungssimulation und Schaltkompetenz-Ergebnisse, falls vorhanden.
   e) Ein bis zwei Sätze Einstiegsempfehlung für die neue Lehrkraft, basierend NUR auf den obigen Punkten.
3. KOSTEN, ZAHLUNGEN ODER OFFENE BETRÄGE KOMMEN IN DEN DATEN NICHT VOR UND DÜRFEN WEDER ERWÄHNT NOCH VERMUTET WERDEN. Das ist eine fachliche Einschätzung, keine Abrechnung.
4. Fehlen zu einem Punkt Daten (z.B. keine Prüfungssimulation absolviert), lass den Punkt einfach weg, statt "keine Daten vorhanden" zu schreiben.
5. Sachlicher, kollegialer Ton - wie eine Übergabenotiz von einer Fahrlehrkraft an die nächste. Keine Anrede, keine Grußformel, direkt mit dem Überblick anfangen.

Die Daten zu ${student.name}:
${JSON.stringify(student, null, 2)}`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 1400, system, messages: [{ role: "user", content: "Schreib die Übergabe-Einschätzung." }] }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : "KI-Anfrage fehlgeschlagen";
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
    }
    let text = "";
    if (Array.isArray(data.content)) text = data.content.map((c) => (c && c.type === "text" ? c.text : "")).join("").trim();
    if (!text) return { statusCode: 502, headers, body: JSON.stringify({ error: "Leere Antwort erhalten" }) };
    return { statusCode: 200, headers, body: JSON.stringify({ text }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
