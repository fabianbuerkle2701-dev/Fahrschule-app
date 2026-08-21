// Netlify Function: liest ein Foto/Screenshot einer ausgefüllten ADK-Karte (Papier oder App)
// aus und schätzt pro Abschnitt einen Fortschritt in Prozent.
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
  // Anthropic-Guthaben und war vorher komplett offen im Internet aufrufbar. Diese Prüfung
  // kommt bewusst vor dem API-Schlüssel-Check.
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

  const images = Array.isArray(body.images) ? body.images : [];
  // Katalog der Abschnitte, die es in der Vorlage des Fahrlehrers gibt (ADK und Strecken),
  // damit die KI die erkannten Bereiche eindeutig zuordnen kann.
  const sections = Array.isArray(body.sections) ? body.sections : [];
  if (!images.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Bilder übergeben" }) };

  const imageBlocks = images.map((dataUrl) => {
    const m = /^data:(.*?);base64,(.*)$/.exec(dataUrl || "");
    const mediaType = m ? m[1] : "image/jpeg";
    const data = m ? m[2] : "";
    return { type: "image", source: { type: "base64", media_type: mediaType, data } };
  });

  const system = `Du liest ein Foto oder einen Screenshot einer ausgefüllten ADK-Karte (Ausbildungsdiagrammkarte) einer Fahrschule aus. Das kann eine handschriftlich abgehakte Papierkarte sein (Kreuze, Kästchen, Datum bei einzelnen Punkten) oder ein Screenshot einer anderen App mit Fortschrittsanzeige je Punkt.

Bekannte Abschnitte mit ihren einzelnen Punkten, denen du die erkannten Markierungen zuordnen sollst (falls ein Punkt auf dem Bild keinem dieser bekannten Punkte eindeutig entspricht, lass ihn weg, erfinde keinen neuen). "count" gibt an, wie oft dieser Punkt insgesamt abgehakt werden kann:
${JSON.stringify(sections.map((s) => ({ id: s.id, title: s.title, kind: s.kind, items: (s.items || []).map((it) => ({ id: it.id, label: it.label, count: it.count })) })))}

Schätze für jeden erkennbaren Punkt, wie oft er laut dem Bild bereits erledigt/abgehakt wurde (eine ganze Zahl von 0 bis maximal dem "count" dieses Punkts). Zähle bei einer handschriftlichen Karte die abgehakten Kästchen oder Datumseinträge dieses Punkts. Bei einem Screenshot mit Fortschrittsanzeige leitest du die Anzahl aus der Anzeige ab.

Gib ein JSON-Objekt in genau diesem Format zurück, kein Text, keine Backticks:
{
  "points": [
    { "sectionId": "<id des Abschnitts aus der bekannten Liste>", "pointId": "<id des Punkts aus diesem Abschnitt>", "done": <Zahl 0 bis count>, "confidence": "hoch"|"mittel"|"niedrig" }
  ],
  "note": "<kurzer Hinweis, falls etwas unklar oder nicht lesbar war, sonst leer>"
}

Regeln:
- Nur Punkte zurückgeben, die du auf dem Bild wirklich erkennen konntest.
- done ist eine ganze Zahl zwischen 0 und dem count des jeweiligen Punkts.
- confidence "niedrig" wenn die Karte unscharf, unvollständig sichtbar oder schwer lesbar war.
- Erfinde keine Werte für Punkte, die auf dem Bild gar nicht vorkommen.`;

  const payload = {
    model: "claude-sonnet-5",
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: "Lies bitte den Fortschritt je Punkt aus dieser ADK-Karte aus." }] }],
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
    // Falls die KI trotz Anweisung zusätzlichen Text vor oder nach dem JSON geschrieben hat,
    // gezielt nur den JSON-Block herausschneiden (vom ersten { bis zum letzten passenden }).
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) {
      const first = text.indexOf("{");
      const last = text.lastIndexOf("}");
      if (first !== -1 && last !== -1 && last > first) {
        try { parsed = JSON.parse(text.slice(first, last + 1)); }
        catch (e2) { return { statusCode: 502, headers, body: JSON.stringify({ error: "Antwort konnte nicht gelesen werden", raw: text }) }; }
      } else {
        return { statusCode: 502, headers, body: JSON.stringify({ error: "Antwort konnte nicht gelesen werden", raw: text }) };
      }
    }
    return { statusCode: 200, headers, body: JSON.stringify(parsed) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
