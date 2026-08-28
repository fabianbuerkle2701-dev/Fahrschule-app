// Netlify Function: Chat-Assistent auf der öffentlichen Buchungsseite UND in der Fahrschüler-App.
// Beantwortet Standardfragen von Interessenten (Preise, Klassen, Anmeldung) automatisch,
// ohne dass jemand ans Telefon muss. Antwortet ausschließlich anhand der über public_chat_facts
// geladenen, für diese eine Fahrschule hinterlegten Fakten - keine erfundenen Preise, keine
// Rechts-/Prüfungsauskünfte.
//
// Diese Function ist bewusst OHNE Anmeldung erreichbar (Interessenten sind noch keine Schüler
// und haben keinen Login). Genau das war bei den anderen KI-Functions vor Task #76 die
// Sicherheitslücke - hier wird stattdessen über den Buchungscode + ein Tageslimit
// (public_chat_rate_limit) geschützt, damit die Function nicht zur offenen Kostenfalle wird.
//
// Ist ein Schüler eingeloggt, schickt der Client zusätzlich Name+PIN mit (Phase 1 des
// "Verwaltung ersetzen"-Fahrplans). Diese werden HIER serverseitig über dieselbe
// public_student_overview-RPC verifiziert, die auch StudentArea nutzt - dem Client wird
// nie vertraut, genau wie bei jeder anderen public_student_*-RPC in dieser App. Schlägt die
// Verifikation fehl (falscher PIN, kein Login), läuft der Chat einfach als anonymer
// Schulfakten-Chat weiter, ohne einen Fehler zurückzugeben - so lässt sich von außen nicht
// durch Fehlermeldungen erraten, ob ein Name/PIN existiert.
const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdnVmdGxmbmtudWN4dW9ydGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDQ2NDQsImV4cCI6MjA5Njg4MDY0NH0.5ZoBdQLnJw23dMZ4IKmAauycVcPoVPIZdmNamZ8MEv8";

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

  const code = (body.code || "").toString().trim();
  if (!code) return { statusCode: 400, headers, body: JSON.stringify({ error: "Kein Buchungscode übergeben" }) };

  const frage = (body.frage || "").toString().slice(0, 600);
  const optionen = Array.isArray(body.optionen) ? body.optionen.slice(0, 6) : [];
  const gewaehlt = Array.isArray(body.gewaehlt) ? body.gewaehlt.slice(0, 6) : [];
  if (!frage || optionen.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Frage übergeben" }) };
  }

  // Tageslimit wie beim Buchungs-Chat: die Function ist bewusst ohne Login erreichbar
  // (Schüler haben keinen Supabase-Account), darf aber keine offene Kostenfalle sein.
  const allowed = await rpc("public_chat_rate_limit", { code, max_per_day: 120 });
  if (allowed === false) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: "Für heute ist die Zahl der Erklärungen erschöpft. Morgen geht es weiter." }) };
  }

  const richtige = optionen.filter((o) => o && o.correct).map((o) => o.text);
  const falsche  = optionen.filter((o) => o && !o.correct).map((o) => o.text);

  const instruction = `Du erklärst einem Fahrschüler eine Frage aus der deutschen Theorieprüfung. Antworte auf Deutsch, in Du-Form, sachlich und ohne Werbesprache.

Frage: ${frage}
Richtige Antwort(en): ${richtige.join(" | ") || "(keine)"}
Falsche Antwort(en): ${falsche.join(" | ") || "(keine)"}
${gewaehlt.length ? "Der Schüler hatte angekreuzt: " + gewaehlt.join(" | ") : "Der Schüler hat noch nicht geantwortet."}

Schreibe höchstens 90 Wörter in genau dieser Struktur, ohne Überschriften und ohne Aufzählungszeichen:
Zuerst ein Satz, WARUM die richtige Antwort richtig ist - nenne die dahinterliegende Regel oder den Grund.
Dann ein Satz, warum die wichtigste falsche Antwort nicht stimmt.
${gewaehlt.length ? "Falls der Schüler falsch lag, gehe kurz auf genau seinen Denkfehler ein." : ""}
Zum Schluss eine kurze Eselsbrücke oder Merkregel, falls es eine sinnvolle gibt - sonst lass sie weg.

Wichtig: Erfinde keine Paragrafen und keine Zahlenwerte, die nicht in der Frage stehen. Wenn du dir bei einer konkreten Vorschrift nicht sicher bist, erkläre die Logik dahinter, statt eine Fundstelle zu nennen.`;

  const payload = {
    model: "claude-sonnet-5",
    max_tokens: 500,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: [{ type: "text", text: instruction }] }],
  };

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
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
    if (!text) return { statusCode: 502, headers, body: JSON.stringify({ error: "Keine Erklärung erhalten" }) };
    return { statusCode: 200, headers, body: JSON.stringify({ erklaerung: text }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
