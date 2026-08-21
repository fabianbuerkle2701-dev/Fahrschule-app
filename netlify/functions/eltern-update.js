// Netlify Function: KI-Eltern-/Begleitpersonen-Update - anders als die teacher-internen
// Einschätzungen (student-handover-summary.js, pruefreife-einschaetzung.js) ist DAS HIER eine
// Nachricht, die 1:1 an die Eltern/Begleitperson weitergeschickt wird (wie beim "interessent"-
// kind in morning-briefing.js), nicht ein Bericht AN den Fahrlehrer. Deshalb bekommt sie ein
// bewusst leichteres, warmes Datenpaket (buildElternUpdatePayload() in index.html) OHNE interne
// Fachsprache (keine Fehlerschwere-Codes, keine "wiederkehrende Schwächen"-Klinik-Sprache) - nur
// Fortschritt, ein Rückblick auf 3 Themen und die schon vorhandene Begleitfahrten-Übungssammlung,
// aus der die KI EINE konkrete gemeinsame nächste Übung vorschlagen darf.
//
// Bearer-Token-gated wie die anderen Bearer-Functions (nur angemeldete Fahrlehrer, kostet echtes
// Guthaben). Bewusst OHNE Kosten/Zahlungen im Datensatz.

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

  const system = `Du schreibst EINE kurze, warme WhatsApp-Nachricht des Fahrlehrers an die Eltern oder Begleitperson von ${student.vorname || student.name}, mit einem kurzen Update zum Ausbildungsstand. Schreib die Nachricht direkt in der du-Form, ADRESSIERT AN DIE ELTERN/BEGLEITPERSON - nicht als Bericht an den Fahrlehrer.

Regeln, unbedingt einhalten:
1. Nutze AUSSCHLIESSLICH die unten stehenden Angaben. Erfinde niemals Fortschritt, Themen oder Vorfälle, die dort nicht stehen.
2. Kurz (4-6 Sätze), freundlich, keine steife Anrede wie "Sehr geehrte/r" - eher wie eine kurze Nachricht von der Fahrlehrkraft.
3. Nimm konkret Bezug auf mindestens EIN Thema aus "letzteThemen" (was gut lief, das ist der Aufhänger für die gute Stimmung), erwähne den Gesamtfortschritt (gesamtProzent) beiläufig, nicht als reine Zahl vorne weg.
4. Wenn in "letzteThemen" auch ein "schlecht"-Punkt steht, formuliere ihn konstruktiv und ermutigend als "woran wir noch arbeiten", nie als Kritik am Schüler.
5. Schlage GENAU EINE konkrete gemeinsame Übung aus "moeglicheUebungen" vor, die zum aktuellen Stand passt (z.B. zum erwähnten Übungspunkt oder zur Ausbildungsstufe) - nenne den Titel der Übung, nicht den internen "key".
6. Wenn "begleitfahrtenKm" > 0 ist, kannst du kurz erwähnen, dass die gemeinsamen Fahrten schon etwas gebracht haben - keine genaue Kilometerzahl nennen, das wirkt technisch.
7. Keine Grußformel am Ende wie "Viele Grüße, [Name]" - die App hängt nichts automatisch an.
8. Keine Rechtsberatung, keine Kosten/Zahlungen erwähnen - das ist nicht Teil dieser Nachricht.
9. Gib NUR den Nachrichtentext zurück, ohne Anführungszeichen drumherum, ohne Erklärung davor oder danach.

Angaben zu ${student.name}:
${JSON.stringify(student, null, 2)}`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 700, system, messages: [{ role: "user", content: "Schreib die Nachricht." }] }),
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
