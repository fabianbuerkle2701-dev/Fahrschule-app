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
  const kind = ["morning", "evening", "statistik", "interessent", "pruefung", "abrechnung", "reform"].includes(body.kind) ? body.kind : "morning";
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
  } else if (kind === "pruefung") {
    const zeilen = [];
    if (typeof facts.anstehendAnzahl === "number" && facts.anstehendAnzahl > 0) {
      zeilen.push("Anstehende Prüfungstermine: " + facts.anstehendAnzahl
        + (Array.isArray(facts.anstehendListe) && facts.anstehendListe.length ? " (" + facts.anstehendListe.join(", ") + ")" : ""));
    }
    if (typeof facts.bereitAnzahl === "number" && facts.bereitAnzahl > 0) {
      zeilen.push("Prüfungsreif, aber noch nicht zur Praxisprüfung angemeldet: " + facts.bereitAnzahl
        + (Array.isArray(facts.bereitNamen) && facts.bereitNamen.length ? " (" + facts.bereitNamen.join(", ") + ")" : ""));
    }
    datenText = zeilen.length ? zeilen.join("\n") : "Aktuell nichts Besonderes in der Prüfungsplanung.";
    system = `Du gibst kurz eine Einschätzung der Prüfungsplanung der Fahrschule "${schoolFacts.school_name}" für den Fahrlehrer. Er sieht diese Daten bereits als Liste in seinem Dashboard - du fasst sie nur in 1-2 knappen Sätzen auf Deutsch zusammen, mit Fokus darauf, was er als Nächstes tun sollte.

Regeln, unbedingt einhalten:
1. Nutze AUSSCHLIESSLICH die unten stehenden Daten. Erfinde niemals Namen, Termine oder Zahlen, die dort nicht stehen.
2. Priorisiere: prüfungsreife, aber nicht angemeldete Schüler zuerst (das kostet sonst unnötig Zeit bis zur Prüfung), anstehende Termine danach.
3. Wenn "nichts Besonderes" dabeisteht, schreib einen kurzen, entspannten Satz dazu.
4. Kein Small Talk, keine Anrede, keine Grußformel - direkt mit dem Inhalt anfangen.
5. Keine rechtlichen Ratschläge zur Prüfungsordnung erfinden.

Die Daten:
${datenText}`;
  } else if (kind === "abrechnung") {
    const zeilen = [];
    if (typeof facts.umsatzMonat === "number") zeilen.push("Umsatz diesen Monat: " + facts.umsatzMonat + " €");
    if (typeof facts.umsatzJahr === "number") zeilen.push("Umsatz dieses Jahr: " + facts.umsatzJahr + " €");
    if (typeof facts.berechnetOffen === "number" && facts.berechnetOffen > 0) zeilen.push("Berechnet, noch offen (Schüler muss zahlen): " + facts.berechnetOffen + " €");
    if (typeof facts.nichtBerechnet === "number" && facts.nichtBerechnet > 0) zeilen.push("Erbracht, aber noch nicht berechnet (Fahrschule muss Rechnung schreiben): " + facts.nichtBerechnet + " €");
    datenText = zeilen.length ? zeilen.join("\n") : "Noch nicht genug Daten für eine Einordnung.";
    system = `Du gibst kurz eine Einordnung der Abrechnungslage der Fahrschule "${schoolFacts.school_name}" für den Fahrlehrer. Er sieht diese Daten bereits als Zahlen in seinem Dashboard - du gibst nur in 1-2 knappen Sätzen auf Deutsch eine Einordnung.

Regeln, unbedingt einhalten:
1. Nutze AUSSCHLIESSLICH die unten stehenden Zahlen. Erfinde niemals Zahlen oder Vergleiche, die sich nicht direkt aus ihnen ableiten.
2. Priorisiere "noch nicht berechnet" zuerst, falls > 0 - das ist stiller Umsatzverlust, den nur der Fahrlehrer selbst beheben kann (Rechnung schreiben).
3. Wenn "noch nicht genug Daten" dabeisteht, sag das kurz und ehrlich statt etwas zu erfinden.
4. Kein Small Talk, keine Anrede, keine Grußformel - direkt mit dem Inhalt anfangen.
5. Keine Mahnungen, Zahlungsfristen oder rechtlichen Schritte erfinden oder vorschlagen - das ist nicht Teil dieser Zahlen.

Die Zahlen:
${datenText}`;
  } else if (kind === "reform") {
    const zeilen = [];
    zeilen.push("Stichtag für die Übergangsregel in dieser Fahrschule eingetragen: " + (facts.stichtagGesetzt ? ("ja, " + facts.stichtag) : "nein, noch nicht eingetragen"));
    zeilen.push("Preise für die standardisierte Preismeldung gepflegt: " + (facts.preiseGepflegt ? "ja" : "nein, noch nicht"));
    datenText = zeilen.join("\n");
    system = `Du erklärst dem Fahrlehrer der Fahrschule "${schoolFacts.school_name}" kurz und in einfacher Sprache, was der Regierungsentwurf zur Modernisierung der Fahrschulausbildung (Bundestag-Drucksache 21/7404, Kabinettsbeschluss Juni 2026, seit 29.7.2026 im Bundestag, Inkrafttreten voraussichtlich Anfang 2027) für seine Fahrschule bedeutet, und was er in DIESER App jetzt schon konkret einstellen kann.

Fakten zum Gesetzentwurf (nutze NUR diese, erfinde keine weiteren Details, Paragraphen oder Fristen):
- Präsenzpflicht beim Theorieunterricht fällt weg, Theorie ist komplett digital per Lern-App möglich.
- Feste Sonderfahrten-Vorgaben werden flexibilisiert.
- Fahrsimulatoren werden Teil der Ausbildung.
- Üben mit privaten Begleitpersonen ergänzend zur Fahrschulausbildung wird gestärkt.
- Die bisherige Preisaushang-Pflicht wird durch eine regelmäßige, standardisierte Preismeldung ersetzt (Grundgebühr, Lehrmaterial, Fahrstunde, Sonderfahrt, Prüfungsvorstellung).
- Das Tageslimit von 2 Theorieeinheiten fällt weg.
- Übergangsregel: laufende Ausbildungen dürfen nach den bisherigen Regeln zu Ende geführt werden.
- Das Gesetz ist noch NICHT in Kraft - alles hier ist Planung, kein geltendes Recht.

Was die App dafür schon anbietet (nur erwähnen, was laut den Angaben unten auch WIRKLICH schon genutzt wird, nichts andichten):
- Ein Stichtag für die Übergangsregel (Einstellungen, "Führerschein-Reform 2027").
- Eine automatisch erzeugbare, standardisierte Preismeldung (Einstellungen, "Kosten").
- KI-generierte Übungsfragen für die Theorie, digitaler Fortschritts-Nachweis je Schüler.

Angaben zu dieser Fahrschule:
${datenText}

Regeln, unbedingt einhalten:
1. 3-4 kurze Sätze, einfache Sprache, keine Paragraphen-Zitate erfinden.
2. Mach klar, dass das Gesetz noch nicht in Kraft ist - keine falsche Dringlichkeit erzeugen.
3. Wenn der Stichtag oder die Preise noch nicht gepflegt sind, weise kurz darauf hin, dass er das schon jetzt vorbereiten kann.
4. Kein Small Talk, keine Anrede, keine Grußformel - direkt mit dem Inhalt anfangen.
5. Keine Rechtsberatung - immer als Planungshilfe formulieren, nicht als verbindliche Auskunft.`;
  } else {
    const zeilen = [];
    if (typeof facts.heuteAnzahl === "number") zeilen.push("Termine heute: " + facts.heuteAnzahl);
    if (Array.isArray(facts.heuteSchueler) && facts.heuteSchueler.length) {
      zeilen.push("Schüler mit Termin heute, je mit Ausbildungsstand:");
      facts.heuteSchueler.forEach((s) => {
        const teile = [];
        if (typeof s.fortschritt === "number") teile.push("ADK/Strecken " + s.fortschritt + "%");
        teile.push("Theorie " + (s.theorie ? "bestanden" : "offen"));
        if (s.stand) teile.push(s.stand);
        if (s.offenerBetrag > 0) teile.push("offener Betrag " + s.offenerBetrag.toFixed(2).replace(".", ",") + " €");
        if (s.notiz) teile.push("Notiz von der letzten Stunde: \"" + s.notiz + "\"");
        zeilen.push("- " + s.zeit + " " + s.name + ": " + teile.join(", "));
      });
    }
    if (typeof facts.pendingAnzahl === "number") zeilen.push("Offene Terminanfragen: " + facts.pendingAnzahl);
    if (typeof facts.abbruchAnzahl === "number" && facts.abbruchAnzahl > 0) {
      zeilen.push("Schüler mit erhöhtem Abbruch-Risiko (lange kein Termin + offener Betrag): " + facts.abbruchAnzahl
        + (Array.isArray(facts.abbruchNamen) && facts.abbruchNamen.length ? " (" + facts.abbruchNamen.join(", ") + ")" : ""));
    }
    if (typeof facts.fristenAnzahl === "number" && facts.fristenAnzahl > 0) zeilen.push("Bald ablaufende Fristen (TÜV/Löschfristen): " + facts.fristenAnzahl);
    if (typeof facts.offenAnzahl === "number" && facts.offenAnzahl > 0) zeilen.push("Schüler mit offenem Betrag: " + facts.offenAnzahl);
    datenText = zeilen.length ? zeilen.join("\n") : "Keine besonderen Punkte für heute.";
    system = `Du schreibst ein kurzes Tages-Briefing für den Fahrlehrer der Fahrschule "${schoolFacts.school_name}". Er sieht die reinen Zahlen bereits als Kacheln in seinem Dashboard - dein Mehrwert ist die Einordnung: was die heutigen Termine angesichts des Ausbildungsstands der jeweiligen Schüler bedeuten, und eine konkrete Empfehlung, was als Nächstes sinnvoll ist.

Regeln, unbedingt einhalten:
1. Nutze AUSSCHLIESSLICH die unten stehenden Daten. Erfinde niemals Namen, Zahlen, Ausbildungsstände oder Ereignisse, die dort nicht stehen.
2. Geh auf die Schüler mit Termin heute ein, wenn welche da sind: was fällt an ihrem Stand auf (z.B. kurz vor Prüfreife, Theorie noch offen, ein offener Betrag, eine Notiz von der letzten Stunde, die für die heutige Stunde relevant sein könnte)? Nicht jeden Schüler einzeln abarbeiten, sondern das Auffälligste herausgreifen.
3. Schließe mit EINER knappen, konkreten Handlungsempfehlung ab, was der Fahrlehrer als Nächstes tun sollte (z.B. "bei X die Praxisprüfung anmelden", "bei Y nach dem offenen Betrag fragen") - nur wenn sich das direkt aus den Daten ableiten lässt, sonst weglassen statt zu erfinden.
4. Wenn "Keine besonderen Punkte für heute" dabeisteht, schreib einen kurzen, entspannten Satz dazu - keine Sorge machen, wo keine Daten sind.
5. Priorisiere: Abbruch-Risiko und offene Anfragen vor reinen Terminzahlen.
6. Kein Small Talk, keine Anrede, keine Grußformel - direkt mit dem Inhalt anfangen. 3-4 Sätze insgesamt.
7. Keine Ratschläge zu Rechtsfragen erfinden.

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
      // letzten Satz mitten im Wort ab - 350 gab Luft. "morning" analysiert jetzt zusätzlich die
      // Schüler von heute samt Handlungsempfehlung (3-4 statt 2-3 Sätze) - 450 für denselben
      // Sicherheitsabstand wie beim 350er-Hotfix, gilt für alle "kind"s gemeinsam (kürzere Texte
      // brauchen die Reserve einfach nicht aus).
      // claude-sonnet-5 denkt ohne explizite Angabe standardmäßig nach, und max_tokens deckelt
      // Denken + Antwort zusammen - dabei kann das gesamte Budget fürs Denken draufgehen und
      // für die eigentliche Antwort nichts übrig lassen. Denken ist für diese kurzen Texte
      // nicht nötig.
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 450, thinking: { type: "disabled" }, system, messages: [{ role: "user", content: "Schreib den Text." }] }),
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
