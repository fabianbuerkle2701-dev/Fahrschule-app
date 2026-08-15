// Netlify Function: Chat-Assistent auf der öffentlichen Buchungsseite.
// Beantwortet Standardfragen von Interessenten (Preise, Klassen, Anmeldung) automatisch,
// ohne dass jemand ans Telefon muss. Antwortet ausschließlich anhand der über public_chat_facts
// geladenen, für diese eine Fahrschule hinterlegten Fakten - keine erfundenen Preise, keine
// Rechts-/Prüfungsauskünfte.
//
// Diese Function ist bewusst OHNE Anmeldung erreichbar (Interessenten sind noch keine Schüler
// und haben keinen Login). Genau das war bei den anderen KI-Functions vor Task #76 die
// Sicherheitslücke - hier wird stattdessen über den Buchungscode + ein Tageslimit
// (public_chat_rate_limit) geschützt, damit die Function nicht zur offenen Kostenfalle wird.
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
  const message = (body.message || "").toString().trim().slice(0, 800);
  // Nur die letzten paar Runden mitschicken - reicht für Rückfragen im Kontext, hält die
  // Anfrage aber klein (jede Runde kostet, und die Fragen sind kurze Standardthemen).
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
  if (!code) return { statusCode: 400, headers, body: JSON.stringify({ error: "Kein Buchungscode übergeben" }) };
  if (!message) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Nachricht übergeben" }) };

  async function rpc(name, params) {
    const resp = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!resp.ok) return null;
    return resp.json();
  }

  const factsRows = await rpc("public_chat_facts", { code });
  const facts = Array.isArray(factsRows) ? factsRows[0] : null;
  if (!facts || !facts.school_name) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: "Unbekannter Buchungslink" }) };
  }

  const allowed = await rpc("public_chat_rate_limit", { code, max_per_day: 40 });
  if (allowed !== true) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: "Für heute sind schon viele Fragen gestellt worden. Bitte versuch es morgen wieder oder nutze das Anmeldeformular." }) };
  }

  const packages = Array.isArray(facts.packages) ? facts.packages : [];
  const klassen = Array.isArray(facts.klassen) && facts.klassen.length ? facts.klassen.join(", ") : "keine hinterlegt";
  const packagesText = packages.length
    ? packages.map((p) => "- " + (p.name || p.label || "Paket") + (p.price != null ? ": " + p.price + " €" : "")).join("\n")
    : "keine Pakete hinterlegt";

  const system = `Du bist der automatische Chat-Assistent auf der Buchungsseite der Fahrschule "${facts.school_name}". Interessenten und Fahrschüler stellen dir Fragen. Antworte kurz, freundlich, auf Deutsch, in 2-4 Sätzen.

Das sind die EINZIGEN Fakten, die du verwenden darfst:
- Fahrschule: ${facts.school_name}${facts.subtitle ? " (" + facts.subtitle + ")" : ""}
- Standort: ${facts.city || "nicht hinterlegt"}
- Angebotene Klassen: ${klassen}
- Preis pro Fahrstunde: ${facts.price_hour != null ? facts.price_hour + " €" : "nicht hinterlegt"}
- Pakete:
${packagesText}
- Anmeldung: über den Reiter "Neu anmelden" auf dieser Seite, unverbindlich, die Fahrschule meldet sich dann

Regeln, unbedingt einhalten:
1. Erfinde NIEMALS Preise, Zeiten, Erfolgsquoten oder Aussagen, die oben nicht stehen.
2. Keine Rechtsberatung, keine Zusagen zu Prüfungsterminen oder -ergebnissen.
3. Wenn eine Frage nicht aus den Fakten oben beantwortbar ist (z.B. konkrete freie Termine, individuelle Beratung, Sonderfälle), sag das ehrlich und verweise auf das Anmeldeformular oder den direkten Kontakt zur Fahrschule.
4. Wenn nach Preis/Klasse gefragt wird, die hier "nicht hinterlegt" ist, sag das ebenso ehrlich statt zu raten.
5. Du bist kein Mensch - wenn danach gefragt wird, sag klar, dass du ein automatischer Assistent bist.`;

  const messages = [
    ...history
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
      .map((m) => ({ role: m.role, content: m.text.slice(0, 800) })),
    { role: "user", content: message },
  ];

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 400, system, messages }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : "KI-Anfrage fehlgeschlagen";
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
    }
    let text = "";
    if (Array.isArray(data.content)) text = data.content.map((c) => (c && c.type === "text" ? c.text : "")).join("").trim();
    if (!text) return { statusCode: 502, headers, body: JSON.stringify({ error: "Leere Antwort erhalten" }) };
    return { statusCode: 200, headers, body: JSON.stringify({ reply: text }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
