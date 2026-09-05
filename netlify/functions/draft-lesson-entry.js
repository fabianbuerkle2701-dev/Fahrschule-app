// Der API-Schlüssel kommt NICHT hierher, sondern aus den Netlify-Umgebungsvariablen.
// In Netlify: Site settings -> Environment variables -> ANTHROPIC_API_KEY hinterlegen.
//
// Gleiche Auth-Prüfung wie extract-interessent.js (Bearer-Token einer echten Fahrlehrer-
// Sitzung) statt des Buchungscode-Musters aus morning-briefing.js - Anders als ein Tages-
// Briefing ist das hier eine Aktion INNERHALB der eingeloggten App, kein öffentlicher
// Buchungslink. Reiner Text-Aufruf (kein Bild) mit dem Freitext-Stichwort des Fahrlehrers
// plus den letzten Tagebucheinträgen des Schülers als Kontext für Ton und Wiederholungen.

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
// Der öffentliche Anon-Key - dient hier nur zum Prüfen, ob das mitgeschickte Token zu einer
// echten, angemeldeten Sitzung gehört. Kein Geheimnis, genau wie in index.html.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdnVmdGxmbmtudWN4dW9ydGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDQ2NDQsImV4cCI6MjA5Njg4MDY0NH0.5ZoBdQLnJw23dMZ4IKmAauycVcPoVPIZdmNamZ8MEv8";

const LESSON_FIELDS = [
  { id: "verkehr", label: "Verkehrsbeobachtung" },
  { id: "position", label: "Fahrzeugpositionierung" },
  { id: "tempo", label: "Geschwindigkeitsanpassung" },
  { id: "komm", label: "Kommunikation" },
  { id: "bedien", label: "Fahrzeugbedienung" },
];

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Nur POST erlaubt" }) };
  }

  // Nur angemeldete Fahrlehrer dürfen diese Funktion nutzen - sie kostet pro Aufruf echtes
  // Anthropic-Guthaben. Prüfung kommt bewusst vor dem API-Schlüssel-Check, damit ein nicht
  // angemeldeter Aufrufer nicht einmal erfährt, ob der Schlüssel konfiguriert ist.
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
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Kein API-Schlüssel hinterlegt. Bitte ANTHROPIC_API_KEY in Netlify setzen." }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Ungültige Anfrage" }) };
  }

  const phrase = (body.phrase || "").toString().trim().slice(0, 500);
  if (!phrase) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Kein Stichwort übergeben" }) };
  }
  const recent = Array.isArray(body.recent) ? body.recent.slice(0, 3) : [];
  // Nur die Array-Laenge war gekappt, die Freitextfelder darin nicht - ein Aufruf mit nur 3
  // Eintraegen, aber beliebig langen thema/gut/schlecht-Strings konnte die Prompt-Groesse
  // trotzdem unbegrenzt hochtreiben (gleiche Fehlerklasse wie bei student-handover-summary.js).
  const clampStr = (v, n) => (v == null ? "" : String(v)).slice(0, n);

  const recentText = recent.length === 0 ? "Keine vorherigen Einträge." : recent.map((l, i) => {
    const bewertungen = LESSON_FIELDS.map(f => (l.ratings && l.ratings[f.id]) ? (f.label + ": " + l.ratings[f.id] + "/3") : null).filter(Boolean).join(", ");
    return "Stunde " + (i + 1) + (l.date ? " (" + clampStr(l.date, 20) + ")" : "") + ": "
      + (l.thema ? "Thema \"" + clampStr(l.thema, 200) + "\". " : "")
      + (bewertungen ? "Bewertungen: " + bewertungen + ". " : "")
      + (l.gut ? "Gut lief: " + clampStr(l.gut, 300) + ". " : "")
      + (l.schlecht ? "Schlecht lief: " + clampStr(l.schlecht, 300) + ". " : "");
  }).join("\n");

  const instruction = `Du hilfst einem Fahrlehrer, einen Tagebucheintrag für eine gerade gegebene Fahrstunde auszufüllen. Er hat dir nur ein kurzes Stichwort zur Stunde gegeben. Nutze es zusammen mit den letzten Einträgen desselben Schülers (Kontext, Wiederholungsmuster, Ton), um einen vollständigen Entwurf zu erstellen.

Stichwort des Fahrlehrers: "${phrase}"

Letzte Einträge dieses Schülers:
${recentText}

Gib AUSSCHLIESSLICH ein JSON-Objekt zurück, ohne Erklärung, ohne Markdown, ohne Backticks, mit genau diesen Feldern:
{
  "thema": "",       // kurzer Titel der Stunde, z.B. "Kreisverkehr" oder "Autobahn auffahren"
  "ratings": { "verkehr": null, "position": null, "tempo": null, "komm": null, "bedien": null },
  "hinweis": "",     // 1 Satz, der DEM SCHÜLER direkt angezeigt wird - freundlich, konkret, ein Tipp für die nächste Stunde
  "gut": "",         // 1 kurzer Satz, was gut lief
  "schlecht": "",    // 1 kurzer Satz, woran noch zu arbeiten ist - leer lassen, wenn aus dem Stichwort nichts Negatives hervorgeht
  "note": ""         // optionale weitere Notiz, meist leer lassen
}

Wichtig zu "ratings": Bewerte NUR Bereiche (verkehr=Verkehrsbeobachtung, position=Fahrzeugpositionierung, tempo=Geschwindigkeitsanpassung, komm=Kommunikation, bedien=Fahrzeugbedienung), zu denen das Stichwort tatsächlich eine Einschätzung hergibt. Skala 1-3 (1=schlecht, 2=mittel, 3=gut). Wenn das Stichwort zu einem Bereich nichts hergibt, lasse den Wert null - rate nichts. Wenn das Stichwort insgesamt zu knapp für eine sinnvolle Einschätzung ist, lasse "thema" und alle anderen Felder als leeren String "" bzw. alle ratings als null. Gib nur das JSON zurück.`;

  const payload = {
    model: "claude-sonnet-5",
    max_tokens: 1024,
    // claude-sonnet-5 denkt ohne explizite Angabe standardmäßig nach, und max_tokens deckelt
    // Denken + Antwort zusammen - dabei kann das gesamte Budget fürs Denken draufgehen und für
    // die eigentliche JSON-Antwort nichts übrig lassen. Denken ist hier nicht nötig.
    thinking: { type: "disabled" },
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: instruction }],
      },
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

    return { statusCode: 200, headers, body: JSON.stringify({ draft: parsed }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
