// Netlify Function: kurze KI-Zusammenfassungen für verschiedene Dashboard-Seiten des
// Fahrlehrers (Tages-Briefing morgens, Tages-Rückblick abends, Statistik-Einordnung). Der
// Client hat alle Zahlen bereits geladen und berechnet - diese Function bekommt nur die
// fertigen Zahlen/Namen als JSON (facts) plus ein "kind"-Feld, das steuert, welche Zeilen
// daraus gebaut werden und welchen Rahmen der Prompt bekommt. Erzeugt selbst KEINE neuen
// Daten und trifft keine Aussagen über Dinge, die nicht im "facts"-Objekt stehen.
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
  const kind = ["morning", "evening", "statistik", "interessent"].includes(body.kind) ? body.kind : "morning";
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
  // Je "kind" ein eigener Satz Zeilen, weil jede Seite andere Kacheln zeigt.
  let datenText = "Keine besonderen Punkte.";
  let system = "";

  if (kind === "evening") {
    const zeilen = [];
    if (typeof facts.ueHeute === "number") zeilen.push("Gefahrene UE heute: " + facts.ueHeute);
    if (typeof facts.eingenommenHeute === "number" && facts.eingenommenHeute > 0) zeilen.push("Eingenommen heute: " + facts.eingenommenHeute.toFixed(2).replace(".", ",") + " €");
    if (typeof facts.nochZuBestaetigen === "number" && facts.nochZuBestaetigen > 0) zeilen.push("Noch zu bestätigende Fahrstunden von heute: " + facts.nochZuBestaetigen);
    if (typeof facts.morgenAnzahl === "number") {
      zeilen.push("Fahrstunden morgen: " + facts.morgenAnzahl
        + (Array.isArray(facts.morgenNamen) && facts.morgenNamen.length ? " (" + facts.morgenNamen.join(", ") + ")" : ""));
    }
    if (Array.isArray(facts.geburtstage) && facts.geburtstage.length) zeilen.push("Geburtstage diese Woche: " + facts.geburtstage.join(", "));
    datenText = zeilen.length ? zeilen.join("\n") : "Heute war ein ruhiger Tag ohne besondere Punkte.";
    system = `Du schreibst einen kurzen Tages-Rückblick für den Fahrlehrer der Fahrschule "${schoolFacts.school_name}" am Abend. Er sieht diese Daten bereits als Kacheln in seinem Dashboard - du fasst sie nur in 2-3 freundlichen, natürlich klingenden Sätzen auf Deutsch zusammen, als würde ein Kollege beim Feierabend kurz Bescheid geben.

Regeln, unbedingt einhalten:
1. Nutze AUSSCHLIESSLICH die unten stehenden Daten. Erfinde niemals Namen, Zahlen oder Ereignisse, die dort nicht stehen.
2. Wenn "ruhiger Tag" dabeisteht, schreib einen kurzen, entspannten Satz dazu.
3. Priorisiere: noch zu bestätigende Fahrstunden zuerst (die brauchen am ehesten eine Reaktion), dann morgen, dann der Rest.
4. Kein Small Talk, keine Anrede, keine Grußformel - direkt mit dem Inhalt anfangen.
5. Keine Ratschläge zu Rechtsfragen oder Prüfungen erfinden.

Die Daten von heute:
${datenText}`;
  } else if (kind === "statistik") {
    const zeilen = [];
    if (Array.isArray(facts.umsatzVerlauf) && facts.umsatzVerlauf.length) zeilen.push("Umsatz letzte Monate, älteste zuerst, in Euro: " + facts.umsatzVerlauf.join(", "));
    if (typeof facts.theorieQuote === "number") zeilen.push("Theorie-Erfolgsquote: " + facts.theorieQuote + "%");
    if (typeof facts.praxisQuote === "number") zeilen.push("Praxis-Erfolgsquote: " + facts.praxisQuote + "%");
    if (typeof facts.pruefreif === "number") zeilen.push("Aktuell prüfungsreife Schüler: " + facts.pruefreif);
    if (typeof facts.notReady === "number") zeilen.push("Schüler noch in Ausbildung: " + facts.notReady);
    if (typeof facts.avgUE === "number") zeilen.push("Ø Fahrstunden bis zur bestandenen Praxisprüfung: " + facts.avgUE + " UE");
    if (typeof facts.neueSchueler === "number") zeilen.push("Neue Schüler diesen Monat: " + facts.neueSchueler);
    datenText = zeilen.length ? zeilen.join("\n") : "Noch nicht genug Daten für eine Einordnung.";
    system = `Du ordnest kurz die Monatsstatistik der Fahrschule "${schoolFacts.school_name}" für den Fahrlehrer ein. Er sieht diese Daten bereits als Zahlen/Diagramme in seinem Dashboard - du gibst nur in 2-3 knappen, konkreten Sätzen auf Deutsch eine Einordnung, was auffällt oder wo er ansetzen könnte.

Regeln, unbedingt einhalten:
1. Nutze AUSSCHLIESSLICH die unten stehenden Zahlen. Erfinde niemals Zahlen, Vergleiche oder Trends, die sich nicht direkt aus ihnen ableiten.
2. Wenn "noch nicht genug Daten" dabeisteht, sag das kurz und ehrlich statt etwas zu erfinden.
3. Bleib konkret bei den Zahlen (z.B. "die Erfolgsquote bei X% ist stark" statt allgemeiner Motivation).
4. Kein Small Talk, keine Anrede, keine Grußformel - direkt mit dem Inhalt anfangen.
5. Keine rechtlichen oder pädagogischen Ratschläge erfinden, die nicht direkt aus den Zahlen folgen.

Die Zahlen:
${datenText}`;
  } else if (kind === "interessent") {
    // Anders als die anderen drei "kind"s: kein Bericht AN den Fahrlehrer über etwas, sondern
    // eine Nachricht, die der Fahrlehrer 1:1 an den Interessenten weiterschicken kann (WhatsApp-
    // Tap-Link, wie überall sonst in der App - der Fahrlehrer sieht den Text vor dem Senden).
    system = `Du schreibst EINE kurze, freundliche WhatsApp-Nachricht des Fahrlehrers der Fahrschule "${schoolFacts.school_name}" an einen Interessenten, der noch kein Schüler ist. Schreib die Nachricht direkt in der du-Form, ADRESSIERT AN DEN INTERESSENTEN - nicht als Bericht an den Fahrlehrer.

Regeln, unbedingt einhalten:
1. Nutze AUSSCHLIESSLICH die unten stehenden Angaben. Erfinde keine Zusagen, Termine, Preise oder Kursinhalte, die dort nicht stehen.
2. Kurz (2-4 Sätze), locker-freundlich, keine steife Anrede wie "Sehr geehrte/r".
3. Je nach Status: bei "offen" der erste Kontakt (kurz vorstellen, fragen ob noch Interesse an einem Termin besteht); bei "kontaktiert" eine sanfte, unaufdringliche Erinnerung/Nachfrage.
4. Ist eine Notiz vorhanden, nimm konkret darauf Bezug (z.B. gewünschter Start, bereits absolvierter Kurs) statt sie zu ignorieren.
5. Keine Grußformel am Ende wie "Viele Grüße, [Name]" - die App hängt nichts automatisch an, das wirkt sonst wie ein Platzhalter.
6. Gib NUR den Nachrichtentext zurück, ohne Anführungszeichen drumherum, ohne Erklärung davor oder danach.

Angaben:
Name: ${facts.vorname || "unbekannt"}
Klasse (Interesse): ${facts.klasse || "unbekannt"}
Status: ${facts.status || "offen"}
Notiz: ${facts.notiz || "keine"}`;
  } else {
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
    datenText = zeilen.length ? zeilen.join("\n") : "Keine besonderen Punkte für heute.";
    system = `Du schreibst ein kurzes Tages-Briefing für den Fahrlehrer der Fahrschule "${schoolFacts.school_name}". Er sieht diese Daten bereits als Kacheln in seinem Dashboard - du fasst sie nur in 2-3 freundlichen, natürlich klingenden Sätzen auf Deutsch zusammen, als würde ein Kollege kurz Bescheid geben.

Regeln, unbedingt einhalten:
1. Nutze AUSSCHLIESSLICH die unten stehenden Daten. Erfinde niemals Namen, Zahlen oder Ereignisse, die dort nicht stehen.
2. Wenn "Keine besonderen Punkte für heute" dabeisteht, schreib einen kurzen, entspannten Satz dazu - keine Sorge machen, wo keine Daten sind.
3. Priorisiere: Abbruch-Risiko und offene Anfragen zuerst (die brauchen am ehesten eine Reaktion), reine Terminzahlen zuletzt.
4. Kein Small Talk, keine Anrede, keine Grußformel - direkt mit dem Inhalt anfangen.
5. Keine Ratschläge zu Rechtsfragen oder Prüfungen erfinden.

Die Daten von heute:
${datenText}`;
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      // 250 war bei "statistik" (bis zu 7 einzelne Kennzahlen) manchmal zu knapp und schnitt den
      // letzten Satz mitten im Wort ab - 350 gibt Luft, ohne dass die Texte spürbar länger werden.
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 350, system, messages: [{ role: "user", content: "Schreib den Text." }] }),
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
