// Netlify Function: KI-Prüfreife-Einschätzung eines Fahrschülers - anders als die reine
// Ampel (ampel()/pruefungsreife() in index.html, ein simpler Regel-Check auf ADK/Strecken/
// Theorie-Prozent) liest Claude hier ZUSÄTZLICH die weichen Signale mit, die eine Regel nicht
// erfassen kann: freie Fahrtenbuch-Notizen, wiederkehrende schwere Fehler aus der Prüfungs-
// simulation, Sonderfahrten-Bilanz, Theorie-Übungsstand - und schreibt eine echte, begründete
// Empfehlung statt nur eines Prozentwerts. Bleibt ausdrücklich eine EMPFEHLUNG, keine
// Zusicherung - die Entscheidung trifft immer der Fahrlehrer.
//
// Bearer-Token-gated wie student-handover-summary.js (nur angemeldete Fahrlehrer, kostet
// echtes Guthaben). Bewusst OHNE Kosten/Zahlungen im Datensatz - das gehört nicht in eine
// fachliche Einschätzung.

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

  const student = body.student && typeof body.student === "object" ? body.student : null;
  if (!student || !student.name) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Schülerdaten übergeben" }) };

  const system = `Du bist ein erfahrener Fahrlehrer-Kollege und gibst eine begründete Einschätzung ab, ob ${student.name} bereit für die Anmeldung zur Praxisprüfung ist. Du bekommst dieselben Rohdaten, die die App auch als Prozentwerte/Ampel zeigt - dein Mehrwert ist, die WEICHEN Signale (Freitext-Notizen, wiederkehrende Fehler, Sonderfahrten, Theorie-Übung) einzubeziehen, die eine reine Prozentzahl nicht erfasst, und daraus eine echte, konkrete Empfehlung zu machen statt nur die Zahlen nachzuerzählen.

Regeln, unbedingt einhalten:
1. Nutze AUSSCHLIESSLICH die unten stehenden Daten. Erfinde niemals Fortschritt, Fehler, Noten oder Ereignisse, die dort nicht stehen.
2. Beginne mit einer KLAREN Einschätzung in einem Satz: z.B. "Bereit für die Prüfungsanmeldung", "Fast bereit, aber X noch klären", oder "Noch nicht bereit, hier ist warum". Sei konkret, nicht ausweichend - aber erfinde nichts über die Daten hinaus.
3. Begründe das dann in 3-5 Sätzen: gehe auf die App-eigene Ampel/Prozentwerte ein (offenePunkteAnzahl, theorieOffen), aber gewichte STÄRKER, was aus wiederkehrendeSchwaechen, wiederkehrendeSchwerePruefungssimFehler, letzteFahrstundenNotizen und sonderfahrten hervorgeht - das sind die Signale, die eine reine Prozentzahl übersieht. Wenn diese weichen Signale der Ampel widersprechen (z.B. Ampel "fast bereit", aber wiederkehrende schwere Fehler in der Prüfungssimulation), sag das explizit und gewichte die weichen Signale höher.
4. Schließe mit 1-2 KONKRETEN nächsten Schritten ab (z.B. "vor der Anmeldung noch 2-3 gezielte Fahrstunden zu Vorfahrt einplanen"), nur wenn sich das direkt aus den Daten ableiten lässt.
5. Fehlen zu einem Punkt Daten (z.B. keine Prüfungssimulation absolviert, Theorie noch nicht geübt), erwähne das nur, wenn es für die Einschätzung relevant ist - nicht jeden fehlenden Datenpunkt einzeln auflisten.
6. KOSTEN, ZAHLUNGEN ODER OFFENE BETRÄGE KOMMEN IN DEN DATEN NICHT VOR UND DÜRFEN WEDER ERWÄHNT NOCH VERMUTET WERDEN.
7. Das ist eine EMPFEHLUNG, keine Zusicherung - formuliere so, dass klar bleibt: die endgültige Entscheidung trifft der Fahrlehrer. Aber sei trotzdem konkret und meinungsstark, keine reine Zahlen-Wiederholung.
8. Sachlicher, kollegialer Ton. Keine Anrede, keine Grußformel - direkt mit der Einschätzung anfangen.

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
      // claude-sonnet-5 denkt ohne explizite Angabe standardmäßig nach (anders als
      // Vorgängermodelle), und max_tokens deckelt Denken + Antwort zusammen - dabei konnte das
      // gesamte Budget fürs Denken draufgehen und für die eigentliche Antwort nichts übrig
      // lassen ("Leere Antwort erhalten" in Produktion beobachtet). Denken ist für diese Prosa-
      // Einschätzung nicht nötig.
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 1400, thinking: { type: "disabled" }, system, messages: [{ role: "user", content: "Schreib die Prüfreife-Einschätzung." }] }),
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
