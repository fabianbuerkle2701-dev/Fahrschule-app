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

  const rawStudent = body.student && typeof body.student === "object" ? body.student : null;
  if (!rawStudent || !rawStudent.name) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Schülerdaten übergeben" }) };
  // Wie student-handover-summary.js/eltern-update.js: jedes Feld einzeln kappen statt
  // body.student ungeprüft in den Prompt zu übernehmen - sonst kann ein Aufruf beliebig große
  // Strings/Arrays mitschicken und die Tokenkosten pro Anfrage unbegrenzt hochtreiben.
  const clampStr = (v, n) => (v == null ? "" : String(v)).slice(0, n);
  const clampNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const bes = rawStudent.besonderheiten && typeof rawStudent.besonderheiten === "object" ? rawStudent.besonderheiten : {};
  const abschnitte = Array.isArray(rawStudent.abschnitte) ? rawStudent.abschnitte.slice(0, 60).map((a) => ({
    art: clampStr(a && a.art, 20),
    titel: clampStr(a && a.titel, 150),
    prozent: clampNum(a && a.prozent),
  })) : [];
  const wiederkehrendeSchwaechen = Array.isArray(rawStudent.wiederkehrendeSchwaechen) ? rawStudent.wiederkehrendeSchwaechen.slice(0, 20).map((w) => ({
    feld: clampStr(w && w.feld, 100),
    schnitt: clampNum(w && w.schnitt),
    schlechtCount: clampNum(w && w.schlechtCount),
    bewertungen: clampNum(w && w.bewertungen),
  })) : [];
  const letzteFahrstundenNotizen = Array.isArray(rawStudent.letzteFahrstundenNotizen) ? rawStudent.letzteFahrstundenNotizen.slice(0, 10).map((l) => ({
    datum: clampStr(l && l.datum, 20),
    thema: clampStr(l && l.thema, 300),
    gut: clampStr(l && l.gut, 300),
    schlecht: clampStr(l && l.schlecht, 300),
  })) : [];
  const psRaw = rawStudent.pruefungssimulation && typeof rawStudent.pruefungssimulation === "object" ? rawStudent.pruefungssimulation : null;
  const gesamtRaw = psRaw && psRaw.gesamt && typeof psRaw.gesamt === "object" ? psRaw.gesamt : null;
  const pruefungssimulation = psRaw ? {
    anzahl: clampNum(psRaw.anzahl),
    letzteAm: clampStr(psRaw.letzteAm, 20),
    gesamt: gesamtRaw ? { leicht: clampNum(gesamtRaw.leicht), erheblich: clampNum(gesamtRaw.erheblich), gefaehrdung: clampNum(gesamtRaw.gefaehrdung) } : null,
  } : null;
  const skRaw = rawStudent.schaltkompetenz && typeof rawStudent.schaltkompetenz === "object" ? rawStudent.schaltkompetenz : null;
  const schaltkompetenz = skRaw ? {
    letzteAm: clampStr(skRaw.letzteAm, 20), gut: clampNum(skRaw.gut), schlecht: clampNum(skRaw.schlecht),
    offen: clampNum(skRaw.offen), notiz: clampStr(skRaw.notiz, 300),
  } : null;
  const clampRecurringList = (list) => Array.isArray(list) ? list.slice(0, 30).map((x) => ({
    id: clampStr(x && x.id, 60), label: clampStr(x && x.label, 150),
    erheblich: clampNum(x && x.erheblich), gefaehrdung: clampNum(x && x.gefaehrdung), total: clampNum(x && x.total),
  })) : [];
  const wsRaw = rawStudent.wiederkehrendeSchwerePruefungssimFehler && typeof rawStudent.wiederkehrendeSchwerePruefungssimFehler === "object" ? rawStudent.wiederkehrendeSchwerePruefungssimFehler : null;
  const wiederkehrendeSchwerePruefungssimFehler = wsRaw ? {
    fahraufgaben: clampRecurringList(wsRaw.fahraufgaben),
    kompetenzbereiche: clampRecurringList(wsRaw.kompetenzbereiche),
  } : null;
  const sonderfahrten = Array.isArray(rawStudent.sonderfahrten) ? rawStudent.sonderfahrten.slice(0, 20).map((x) => ({
    art: clampStr(x && x.art, 60), ue: clampNum(x && x.ue), sollUe: clampNum(x && x.sollUe), erfuellt: !!(x && x.erfuellt),
  })) : null;
  const tuRaw = rawStudent.theorieUebungsstand && typeof rawStudent.theorieUebungsstand === "object" ? rawStudent.theorieUebungsstand : null;
  const theorieUebungsstand = tuRaw ? {
    gemeistertProzent: clampNum(tuRaw.gemeistertProzent), beantwortet: clampNum(tuRaw.beantwortet), gesamtFragen: clampNum(tuRaw.gesamtFragen),
  } : null;
  const student = {
    name: clampStr(rawStudent.name, 200),
    klasse: clampStr(rawStudent.klasse, 20),
    theorie: !!rawStudent.theorie,
    adkProzent: clampNum(rawStudent.adkProzent),
    streckenProzent: clampNum(rawStudent.streckenProzent),
    gesamtProzent: clampNum(rawStudent.gesamtProzent),
    abschnitte,
    fahrstunden: clampNum(rawStudent.fahrstunden),
    gefahreneMinuten: clampNum(rawStudent.gefahreneMinuten),
    besonderheiten: {
      sehhilfe: !!bes.sehhilfe,
      bemerkungen: clampStr(bes.bemerkungen, 1000),
      letzteNotizZumStand: clampStr(bes.letzteNotizZumStand, 1000),
      streckenNotizen: Array.isArray(bes.streckenNotizen) ? bes.streckenNotizen.slice(0, 20).map((n) => clampStr(n, 300)) : [],
    },
    wiederkehrendeSchwaechen,
    letzteFahrstundenNotizen,
    pruefungssimulation,
    schaltkompetenz,
    ampelStufe: clampStr(rawStudent.ampelStufe, 30),
    ampelText: clampStr(rawStudent.ampelText, 200),
    offenePunkteAnzahl: clampNum(rawStudent.offenePunkteAnzahl),
    theorieOffen: clampNum(rawStudent.theorieOffen),
    wiederkehrendeSchwerePruefungssimFehler,
    sonderfahrten,
    theorieUebungsstand,
  };

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
