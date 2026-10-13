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

const { kiSignal, istKiTimeout, kiTimeoutAntwort } = require("./lib/ki-timeout");

exports.handler = async function (event, context) {
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

  // Länge/Größe begrenzen, bevor sie in den Prompt eingebettet werden (wie in suggest-adk-items.js) -
  // sonst könnte ein Aufruf mit riesigem Text oder Katalog die Anthropic-Tokenkosten eines
  // einzelnen Calls unbegrenzt hochtreiben.
  const mehrfach = body.modus === "mehrfach";
  const text = (body.text || "").toString().trim().slice(0, mehrfach ? 2500 : 800);
  const fahraufgaben = Array.isArray(body.fahraufgaben) ? body.fahraufgaben.filter((f) => f && typeof f === "object").slice(0, 50) : [];
  const kompetenzbereiche = Array.isArray(body.kompetenzbereiche) ? body.kompetenzbereiche.filter((f) => f && typeof f === "object").slice(0, 50) : [];
  const schweregrade = Array.isArray(body.schweregrade) ? body.schweregrade.filter((f) => f && typeof f === "object").slice(0, 50) : [];
  if (!text) return { statusCode: 400, headers, body: JSON.stringify({ error: "Kein Text übergeben" }) };
  if (!fahraufgaben.length || !kompetenzbereiche.length || (!mehrfach && !schweregrade.length)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Kataloge fehlen" }) };
  }
  if (mehrfach) return mehrfachZerlegen({ text, fahraufgaben, kompetenzbereiche, apiKey, headers, context });

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
      signal: kiSignal(context),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 300,
        // claude-sonnet-5 denkt ohne explizite Angabe standardmäßig nach, und max_tokens
        // deckelt Denken + Antwort zusammen - bei diesem knappen Budget kann das gesamte
        // Budget fürs Denken draufgehen und für die eigentliche JSON-Antwort nichts übrig
        // lassen. Denken ist hier nicht nötig.
        thinking: { type: "disabled" },
        system,
        messages: [{ role: "user", content: "Beobachtung: " + text }],
      }),
    });
    const data = (await resp.json().catch(() => null)) || {}; // Fehlerseite ohne JSON (Audit 2026-10-02)
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
    if (istKiTimeout(e)) return kiTimeoutAntwort(headers);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};

// Modus "mehrfach" (v2.118.0): Der Fahrlehrer schreibt oder diktiert die ganze Fahrt auf einmal -
// Gutes und Schlechtes. Die KI zerlegt den Text in einzelne Beobachtungen und ordnet jede einem der
// fünf Prüfkriterien (Kompetenzbereiche), optional einer Fahraufgabe und einer Art zu. Erzwungenes
// Werkzeug statt Freitext; der Server lässt nur bekannte ids durch. Der Client zeigt alles zum
// Bestätigen - gespeichert wird nie automatisch.
const ARTEN = ["gut", "leicht", "erheblich", "gefaehrdung", "notiz"];
async function mehrfachZerlegen({ text, fahraufgaben, kompetenzbereiche, apiKey, headers, context }) {
  const kb = kompetenzbereiche.map((k) => ({ id: String(k.id || "").slice(0, 40), label: String(k.label || "").slice(0, 80) })).filter((k) => k.id);
  const fa = fahraufgaben.map((f) => ({ id: String(f.id || "").slice(0, 40), label: String(f.label || "").slice(0, 120) })).filter((f) => f.id);
  const kbIds = new Set(kb.map((k) => k.id)), faIds = new Set(fa.map((f) => f.id));
  const werkzeug = {
    name: "beobachtungen",
    description: "Einzelne Beobachtungen aus der Notiz einer Prüfungssimulation.",
    input_schema: { type: "object", properties: {
      eintraege: { type: "array", items: { type: "object", properties: {
        art: { type: "string", enum: ARTEN, description: "gut = gelungen/lobenswert; leicht = leichter Fehler; erheblich = schwerer Fehler; gefaehrdung = akute Gefährdung, Eingreifen des Fahrlehrers oder Unfall (Prüfung nicht bestanden); notiz = neutral, ohne Bewertung" },
        kompetenzbereich: { type: "string", enum: [...kbIds, "keiner"] },
        fahraufgabe: { type: "string", enum: [...faIds, "keine"] },
        text: { type: "string", description: "Knapp und sachlich, 3–12 Wörter, wie im Prüfprotokoll" },
      }, required: ["art", "kompetenzbereich", "fahraufgabe", "text"] } },
    }, required: ["eintraege"] },
  };
  const prompt = "Ein Fahrlehrer hat während oder nach einer Prüfungssimulation (Nachstellen der praktischen Fahrprüfung) in eigenen Worten notiert, was passiert ist – Gutes und Schlechtes, oft mehrere Situationen in einem Text.\n"
    + "Zerlege die Notiz in einzelne Beobachtungen (eine Situation = ein Eintrag, in der Reihenfolge des Textes). Lass keine Beobachtung weg und erfinde keine.\n"
    + "Ordne jede Beobachtung einem der fünf Prüfkriterien zu. Ist mangelnde Verkehrsbeobachtung mit überwiegender Sicherheit die Ursache, gehört der Fehler zur Verkehrsbeobachtung (Zuordnungsregel der Prüfung). Nur bei neutralen Notizen ohne Bewertung: kompetenzbereich \"keiner\".\n"
    + "Fahraufgabe nur, wenn sie aus dem Text erkennbar ist, sonst \"keine\".\n"
    + "„gefaehrdung“ nur bei akuter Gefährdung, Eingreifen des Fahrlehrers oder Unfall – im Zweifel niedriger einstufen. Ein Zusatz wie „war aber ungefährlich“ gehört zur vorigen Beobachtung.\n\n"
    + "Prüfkriterien: " + JSON.stringify(kb) + "\nFahraufgaben: " + JSON.stringify(fa) + "\n\nNotiz:\n" + text;
  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: kiSignal(context),
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 1500, thinking: { type: "disabled" },
        tools: [werkzeug], tool_choice: { type: "tool", name: werkzeug.name }, messages: [{ role: "user", content: prompt }] }),
    });
  } catch (e) {
    if (istKiTimeout(e)) return kiTimeoutAntwort(headers);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "KI nicht erreichbar" }) };
  }
  const data = (await resp.json().catch(() => null)) || {};
  if (!resp.ok) return { statusCode: 502, headers, body: JSON.stringify({ error: (data.error && data.error.message) || "KI-Anfrage fehlgeschlagen" }) };
  const block = Array.isArray(data.content) ? data.content.find((c) => c && c.type === "tool_use") : null;
  const roh = block && block.input && Array.isArray(block.input.eintraege) ? block.input.eintraege : null;
  if (!roh) return { statusCode: 502, headers, body: JSON.stringify({ error: "Antwort konnte nicht gelesen werden" }) };
  const eintraege = roh.slice(0, 20).map((e) => {
    const art = ARTEN.indexOf(e && e.art) >= 0 ? e.art : "notiz";
    const t = String((e && e.text) || "").trim().slice(0, 140);
    return { art, kompetenzbereich: kbIds.has(e && e.kompetenzbereich) ? e.kompetenzbereich : null, fahraufgabe: faIds.has(e && e.fahraufgabe) ? e.fahraufgabe : null, text: t };
  }).filter((e) => e.text);
  if (!eintraege.length) return { statusCode: 502, headers, body: JSON.stringify({ error: "Keine Beobachtung erkannt" }) };
  return { statusCode: 200, headers, body: JSON.stringify({ eintraege }) };
}
