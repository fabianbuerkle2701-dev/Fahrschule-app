// Netlify Function: ordnet eine kurze Freitext-Beobachtung aus der Prüfungssimulation
// (Fahrlehrer tippt z.B. "Schulterblick vergessen beim Abbiegen, war aber ungefährlich")
// automatisch einer Fahraufgabe, einem Kompetenzbereich und einem Schweregrad zu, statt dass
// der Fahrlehrer durch drei Menüs tippen muss. Das Ergebnis ist immer nur ein Vorschlag zum
// Bestätigen im Client (nie automatisch gespeichert) - der Schweregrad entscheidet direkt, ob
// die Prüfung als bestanden gilt, darum darf hier nichts stillschweigend übernommen werden.
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
  // Anthropic-Guthaben und war bei vergleichbaren Functions vorher offen im Internet erreichbar.
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

  const text = (body.text || "").toString().trim();
  const fahraufgaben = Array.isArray(body.fahraufgaben) ? body.fahraufgaben : [];
  const kompetenzbereiche = Array.isArray(body.kompetenzbereiche) ? body.kompetenzbereiche : [];
  const schweregrade = Array.isArray(body.schweregrade) ? body.schweregrade : [];
  if (!text) return { statusCode: 400, headers, body: JSON.stringify({ error: "Kein Text übergeben" }) };
  if (!fahraufgaben.length || !kompetenzbereiche.length || !schweregrade.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Kataloge fehlen" }) };
  }

  const system = `Du unterstützt einen Fahrlehrer, der während einer Prüfungssimulation (Nachstellen der praktischen Fahrprüfung) kurz und in eigenen Worten notiert, was gerade passiert ist. Ordne diese Beobachtung strukturiert zu.

Bekannte Fahraufgaben (wähle genau eine id):
${JSON.stringify(fahraufgaben.map((f) => ({ id: f.id, label: f.label })))}

Bekannte Kompetenzbereiche (wähle genau eine id):
${JSON.stringify(kompetenzbereiche.map((k) => ({ id: k.id, label: k.label })))}

Bekannte Schweregrade (wähle genau eine id):
${JSON.stringify(schweregrade.map((s) => ({ id: s.id, label: s.label })))}

Gib ein JSON-Objekt in genau diesem Format zurück, kein Text, keine Backticks:
{
  "fahraufgabe": "<id aus der Fahraufgaben-Liste>",
  "kompetenzbereich": "<id aus der Kompetenzbereiche-Liste>",
  "schweregrad": "<id aus der Schweregrade-Liste>",
  "text": "<knapper, neutraler Fehlertext, 3-12 Wörter, wie in einem Prüfungsprotokoll>",
  "confidence": "hoch"|"mittel"|"niedrig"
}

Regeln:
- Wähle IMMER genau eine id aus jeder der drei bekannten Listen - erfinde niemals eine neue id.
- "text" ist eine sachliche Kurzfassung der Beobachtung in der Art "Schulterblick vergessen, Situation blieb ungefährlich" - keine wörtliche Wiederholung der Eingabe, keine Ich-Form, keine Wertung.
- Der Schweregrad "gefaehrdung" (Prüfung nicht bestanden) ist nur korrekt, wenn die Beobachtung eindeutig eine akute Gefährdung oder einen Kontrollverlust beschreibt. Im Zweifel niedriger einstufen (leicht/erheblich) - das hier ist nur ein Vorschlag, den der Fahrlehrer noch bestätigt.
- confidence "niedrig", wenn die Eingabe zu vage oder mehrdeutig für eine sichere Zuordnung war.`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: "Beobachtung: " + text }],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : "KI-Anfrage fehlgeschlagen";
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
    }
    let out = "";
    if (Array.isArray(data.content)) out = data.content.map((c) => (c && c.type === "text" ? c.text : "")).join("").trim();
    out = out.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    let parsed;
    try { parsed = JSON.parse(out); }
    catch (e) {
      const first = out.indexOf("{");
      const last = out.lastIndexOf("}");
      if (first !== -1 && last !== -1 && last > first) {
        try { parsed = JSON.parse(out.slice(first, last + 1)); }
        catch (e2) { return { statusCode: 502, headers, body: JSON.stringify({ error: "Antwort konnte nicht gelesen werden", raw: out }) }; }
      } else {
        return { statusCode: 502, headers, body: JSON.stringify({ error: "Antwort konnte nicht gelesen werden", raw: out }) };
      }
    }
    return { statusCode: 200, headers, body: JSON.stringify(parsed) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
