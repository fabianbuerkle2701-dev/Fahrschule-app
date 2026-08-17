// Netlify Function: Tages-Briefing für die Startseite des Fahrlehrer-Dashboards
// (Verwaltung-ersetzen-Fahrplan, Phase 2). Der Client hat alle Zahlen bereits geladen und
// berechnet (heute, offene Anfragen, Abbruch-Risiko, Fristen-Radar) - diese Function bekommt
// nur die fertigen Zahlen/Namen als JSON und lässt Claude daraus einen kurzen, freundlichen
// Fließtext statt trockener Kennzahlen machen. Erzeugt selbst KEINE neuen Daten und trifft
// keine Aussagen über Dinge, die nicht im "facts"-Objekt stehen.
//
// Erreichbar ohne Login (wie booking-chat.js), weil der Client seine Session nicht als Bearer-
// Token mitschickt - stattdessen wie dort über den Buchungscode + Tageslimit geschützt
// (public_chat_rate_limit), damit die Function nicht zur offenen Kostenfalle wird. Der Code
// selbst ist kein Geheimnis (steht auf jedem Buchungslink), und die "facts" enthalten nur
// Zahlen/Vornamen, die der anfragende Fahrlehrer in seinem eigenen Dashboard ohnehin schon sieht.
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
  const facts = body.facts && typeof body.facts === "object" ? body.facts : null;
  if (!code) return { statusCode: 400, headers, body: JSON.stringify({ error: "Kein Buchungscode übergeben" }) };
  if (!facts) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Daten übergeben" }) };

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
  const schoolFacts = Array.isArray(factsRows) ? factsRows[0] : null;
  if (!schoolFacts || !schoolFacts.school_name) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: "Unbekannter Buchungslink" }) };
  }

  // Eigenes, niedrigeres Limit als der Buchungs-Chat: ein Fahrlehrer öffnet sein Dashboard
  // öfter am Tag als ein Interessent chattet, aber ein Briefing braucht nicht bei jedem
  // Öffnen neu erzeugt zu werden - der Client ruft das ohnehin nur auf Knopfdruck ab.
  const allowed = await rpc("public_chat_rate_limit", { code, max_per_day: 20 });
  if (allowed !== true) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: "Für heute wurden schon mehrere Briefings erzeugt. Bitte später erneut versuchen." }) };
  }

  // Rohdaten so, wie sie im Dashboard ohnehin stehen - nur als Text statt als Kacheln.
  const zeilen = [];
  if (typeof facts.heuteAnzahl === "number") zeilen.push("Termine heute: " + facts.heuteAnzahl);
  if (Array.isArray(facts.heuteNamen) && facts.heuteNamen.length) zeilen.push("Davon mit: " + facts.heuteNamen.join(", "));
  if (typeof facts.pendingAnzahl === "number") zeilen.push("Offene Terminanfragen: " + facts.pendingAnzahl);
  if (typeof facts.abbruchAnzahl === "number" && facts.abbruchAnzahl > 0) {
    zeilen.push("Schüler mit erhöhtem Abbruch-Risiko (lange kein Termin + offener Betrag): " + facts.abbruchAnzahl
      + (Array.isArray(facts.abbruchNamen) && facts.abbruchNamen.length ? " (" + facts.abbruchNamen.join(", ") + ")" : ""));
  }
  if (typeof facts.fristenAnzahl === "number" && facts.fristenAnzahl > 0) zeilen.push("Bald ablaufende Fristen (TÜV/Löschfristen): " + facts.fristenAnzahl);
  if (typeof facts.offenAnzahl === "number" && facts.offenAnzahl > 0) zeilen.push("Schüler mit offenem Betrag: " + facts.offenAnzahl);
  const datenText = zeilen.length ? zeilen.join("\n") : "Keine besonderen Punkte für heute.";

  const system = `Du schreibst ein kurzes Tages-Briefing für den Fahrlehrer der Fahrschule "${schoolFacts.school_name}". Er sieht diese Daten bereits als Kacheln in seinem Dashboard - du fasst sie nur in 2-3 freundlichen, natürlich klingenden Sätzen auf Deutsch zusammen, als würde ein Kollege kurz Bescheid geben.

Regeln, unbedingt einhalten:
1. Nutze AUSSCHLIESSLICH die unten stehenden Daten. Erfinde niemals Namen, Zahlen oder Ereignisse, die dort nicht stehen.
2. Wenn "Keine besonderen Punkte für heute" dabeisteht, schreib einen kurzen, entspannten Satz dazu - keine Sorge machen, wo keine Daten sind.
3. Priorisiere: Abbruch-Risiko und offene Anfragen zuerst (die brauchen am ehesten eine Reaktion), reine Terminzahlen zuletzt.
4. Kein Small Talk, keine Anrede, keine Grußformel - direkt mit dem Inhalt anfangen.
5. Keine Ratschläge zu Rechtsfragen oder Prüfungen erfinden.

Die Daten von heute:
${datenText}`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 250, system, messages: [{ role: "user", content: "Schreib das Briefing." }] }),
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
