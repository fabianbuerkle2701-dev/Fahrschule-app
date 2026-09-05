// Netlify Function: KI-Helfer für die Fahrschul-App.
// Nimmt eine Anweisung in normaler Sprache + eine Schülerliste entgegen
// und gibt strukturiert zurück, welche Aktion ausgeführt werden soll.
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

  // Nur angemeldete Fahrlehrer dürfen den Assistenten nutzen - er kostet pro Aufruf echtes
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

  // Netlify liefert den Body bis in den Megabyte-Bereich aus. Vorher wurde davon alles
  // ungeprüft in den Prompt geschrieben - ein einziger aufgeblähter Request konnte damit
  // Anthropic-Guthaben im Dollarbereich verbrennen (und lief obendrein in den Timeout, die
  // Kosten waren also nicht einmal an einer Antwort erkennbar). Grobe Obergrenze deshalb schon
  // vor dem Parsen; ein echter Roster dieser App liegt um Größenordnungen darunter.
  if ((event.body || "").length > 2000000) {
    return { statusCode: 413, headers, body: JSON.stringify({ error: "Die Anfrage ist zu groß." }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Ungültige Anfrage" }) }; }

  // Feldweise Kappung wie in den Schwesterfunctions (booking-chat.js: message.slice(0,800),
  // draft-lesson-entry.js: phrase.slice(0,500), eltern-update.js: clampStr) - assistant.js war
  // die einzige KI-Function ganz ohne Begrenzung und hat message/students/adk/strecken
  // unverändert in den Prompt übernommen, Länge und Tokenkosten pro Aufruf waren unbegrenzt.
  // Steuerzeichen fliegen dabei raus, damit ein Datenfeld den Datenblock unten nicht optisch
  // verlassen kann.
  const clampStr = (v, n) => (v == null ? "" : String(v)).replace(/[\x00-\x1f\x7f]/g, " ").slice(0, n);
  // Für Felder, die über die öffentliche Selbstanmeldung (public_enroll_student) von außen
  // beschreibbar sind, zusätzlich spitze Klammern entfernen: sonst könnte ein selbst
  // angemeldeter "Schüler" mit einem gefälschten End-Tag im Namen aus <schuelerdaten>
  // ausbrechen und dem Modell Text als Anweisung unterschieben.
  const clampName = (v, n) => clampStr(v, n).replace(/[<>]/g, " ").trim();
  const clampNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  // Kappt eine Liste doppelt: auf maxAnzahl Einträge UND auf ein Zeichenbudget des fertigen
  // JSON. Ohne das Budget käme ein böswillig gefüllter Request trotz Feldkappung immer noch
  // auf mehrere hundert Kilobyte Prompt; echte Rosters und Kataloge dieser App bleiben weit
  // unter den Budgets und werden nie angeschnitten.
  const kappeListe = (arr, maxAnzahl, budget, mapFn) => {
    const quelle = (Array.isArray(arr) ? arr : []).slice(0, maxAnzahl);
    const out = [];
    let laenge = 0;
    for (let i = 0; i < quelle.length; i++) {
      const eintrag = mapFn(quelle[i]);
      laenge += JSON.stringify(eintrag).length + 1;
      if (laenge > budget) break;
      out.push(eintrag);
    }
    return out;
  };

  const message = (body.message || "").toString().slice(0, 2000);
  const today = clampStr(body.today, 20).trim();
  const studentsRaw = Array.isArray(body.students) ? body.students : [];
  // Schülerliste wird bereits reichhaltig übergeben (inkl. offen, bezahlt, Prozente, Theorie)
  const roster = kappeListe(studentsRaw, 300, 200000, (s) => ({
    id: clampName(s && s.id, 80),
    vorname: clampName(s && s.vorname, 80),
    name: clampName(s && s.name, 80),
    telefon: clampName(s && s.telefon, 40),
    theorie: !!(s && s.theorie),
    adkProzent: clampNum(s && s.adkProzent),
    streckenProzent: clampNum(s && s.streckenProzent),
    gesamtProzent: clampNum(s && s.gesamtProzent),
    abschnitte: kappeListe(s && s.abschnitte, 80, 20000, (a) => ({
      art: clampStr(a && a.art, 20),
      titel: clampStr(a && a.titel, 120),
      prozent: clampNum(a && a.prozent),
    })),
    wiederkehrendeSchwaechen: kappeListe(s && s.wiederkehrendeSchwaechen, 12, 4000, (w) => ({
      feld: clampStr(w && w.feld, 80),
      schnitt: clampNum(w && w.schnitt),
      schlechtCount: clampNum(w && w.schlechtCount),
      bewertungen: clampNum(w && w.bewertungen),
    })),
    letzteNotizen: kappeListe(s && s.letzteNotizen, 4, 4000, (n) => ({
      datum: clampStr(n && n.datum, 20),
      thema: clampStr(n && n.thema, 300),
      gut: clampStr(n && n.gut, 300),
      schlecht: clampStr(n && n.schlecht, 300),
    })),
    fahrstunden: clampNum(s && s.fahrstunden),
    gefahreneMinuten: clampNum(s && s.gefahreneMinuten),
    berechnet: clampNum(s && s.berechnet),
    bezahlt: clampNum(s && s.bezahlt),
    offen: clampNum(s && s.offen),
  }));
  const rosterGekuerzt = roster.length < studentsRaw.length;
  const katalogEintrag = (it) => ({
    id: clampName(it && it.id, 80),
    label: clampStr(it && it.label, 200),
    count: clampNum(it && it.count),
  });
  const adk = kappeListe(body.adk, 4000, 250000, katalogEintrag);
  const strecken = kappeListe(body.strecken, 4000, 250000, katalogEintrag);
  if (!message.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Anweisung übergeben" }) };

  const system = `Du bist der Assistent einer Fahrschul-App für den Fahrlehrer. Du kannst zwei Dinge: (A) Fragen frei beantworten und Übersichten geben, und (B) Eintragungen vorbereiten, die der Fahrlehrer dann bestätigt. Antworte immer mit reinem JSON, kein Text drumherum, keine Backticks.

Heutiges Datum: ${today || "unbekannt"}

Verfügbare Schüler mit ihren aktuellen Daten (alle Beträge in Euro):
${JSON.stringify(roster)}
${rosterGekuerzt ? "\nACHTUNG: Diese Schülerliste ist wegen ihrer Größe gekürzt und UNVOLLSTÄNDIG. Wenn nach einem bestimmten Schüler gefragt wird, der hier nicht auftaucht, oder nach einer Zahl über ALLE Schüler (z.B. Gesamtsumme), sag das ausdrücklich dazu - erfinde keine Angabe für fehlende Schüler." : ""}

Bedeutung der Felder: vorname, name, telefon; theorie (Theorieprüfung bestanden true/false); adkProzent (Fortschritt Ausbildungsnachweis); streckenProzent; gesamtProzent; fahrstunden (Anzahl gefahrener Fahrstunden); gefahreneMinuten; berechnet (Summe der Kosten); bezahlt (Summe der Zahlungen); offen (offener Betrag, negativ bedeutet Guthaben); abschnitte (Fortschritt JE Abschnitt, z.B. [{"art":"ADK","titel":"Grundstufe","prozent":94},{"art":"Strecken","titel":"Autobahn","prozent":0}] – nutze das für konkrete Trainingsvorschläge statt nur die Gesamtprozent zu nennen); wiederkehrendeSchwaechen (bereits serverseitig über die letzten bis zu 8 Fahrstunden-Tagebucheinträge berechnete, ECHTE Muster – jedes Element z.B. {"feld":"Verkehrsbeobachtung","schnitt":1.3,"schlechtCount":3,"bewertungen":4} bedeutet: von den letzten Bewertungen dieses Feldes waren schlechtCount davon "schlecht" bewertet, schnitt ist der Notenschnitt auf einer Skala 1=schlecht/2=mittel/3=gut; ist das Array leer, gibt es KEIN belastbares Muster); letzteNotizen (die letzten Tagebucheinträge mit Freitext, je [{"datum":"...","thema":"...","gut":"...","schlecht":"..."}], für konkrete Beispiele in der Antwort).

Verfügbare ADK-Punkte (id, label, count=Soll):
${JSON.stringify(adk)}

Verfügbare Strecken-Punkte (id, label, count=Soll):
${JSON.stringify(strecken)}

Du gibst IMMER ein JSON-Objekt zurück. Entscheide zuerst, ob die Nachricht eine FRAGE ist (dann antwortest du) oder eine AUFGABE/EINTRAGUNG (dann bereitest du eine Aktion vor).

Format:
{
  "action": "antwort" | "fahrstunde" | "termin" | "zahlung" | "adk" | "strecken" | "schueler" | "unknown",
  "answer": "<bei action antwort: deine Antwort in klarem, freundlichem Deutsch>",
  "studentId": "<id des Schülers, bei Aktionen>",
  "studentName": "<Name zur Anzeige>",
  "date": "JJJJ-MM-TT",
  "time": "HH:MM",
  "minutes": <Zahl>,
  "amount": <Zahl, nur bei zahlung>,
  "title": "<nur bei termin>",
  "targetId": "<nur bei adk/strecken>",
  "targetLabel": "<label>",
  "value": "voll" | <Zahl> | "<neuer Textwert bei schueler>",
  "field": "tel" | "anschrift" | "bemerkungen",
  "mode": "ersetzen" | "anhaengen",
  "needsClarification": <true|false>,
  "clarification": "<Rückfrage falls nötig>",
  "summary": "<ein Satz zur Bestätigung bei Aktionen>"
}

Regeln für action "antwort" (FRAGEN und ÜBERSICHTEN):
- Nutze die Schülerdaten oben, um die Frage konkret zu beantworten. Beispiele: "Wer hat offene Beträge?" -> liste die Schüler mit offen > 0 samt Betrag. "Wie viele haben die Theorie?" -> zähle theorie true. "Wie weit ist Clara?" -> nenne ihre Prozentwerte und offenen Betrag.
- Schreibe natürlich und auf den Punkt. Bei Listen darfst du Namen mit Beträgen in Zeilen auflisten. Keine Tabellen, keine erfundenen Zahlen, nur die vorhandenen Daten.
- Wenn die Daten für eine Antwort nicht ausreichen, sag das ehrlich.
- Beträge mit zwei Nachkommastellen und Euro-Zeichen, z.B. 65,00 €.

Regeln für TRAININGSVORSCHLÄGE (Fragen wie "Was sollte X als nächstes üben?", "Trainingsvorschlag für X", "Womit weitermachen?"):
- Schau in abschnitte des Schülers nach dem Abschnitt mit dem NIEDRIGSTEN Prozentwert (0% zuerst). Bevorzuge dabei "Strecken"-Abschnitte mit 0% (Überlandfahrten, Autobahn, Dämmerung/Nacht) vor ADK-Feinheiten, weil das die Pflicht-Sonderfahrten sind, die am längsten Vorlauf brauchen.
- Nenne IMMER den konkreten Abschnittsnamen und seinen Prozentwert, nicht nur "sie sollte weiterüben". Beispiel: "Clara steht bei Autobahn und Überlandfahrten noch bei 0%, dort würde ich als Nächstes ansetzen – Theorie ist bestanden, die Grundstufe läuft mit 94% schon gut."
- Ist gesamtProzent bereits bei 100% oder alle Strecken-Pflichtabschnitte >0%, sag das ehrlich statt eine Pflichtübung zu erfinden, und weise stattdessen auf den nächsten sinnvollen Feinschliff hin (niedrigster verbleibender Abschnitt).
- Erfinde keine Übungsinhalte, die nicht in abschnitte auftauchen.

Regeln für MUSTERERKENNUNG (Fragen wie "Gibt es wiederkehrende Schwächen bei X?", "Woran hapert es bei X?", "Muster aus den Fahrstunden?"):
- Nutze AUSSCHLIESSLICH das vorberechnete Feld wiederkehrendeSchwaechen. Ist es leer, sag ehrlich, dass sich noch kein wiederkehrendes Muster in den letzten Fahrstunden zeigt (nicht raten, keine Schwäche erfinden).
- Ist es nicht leer, nenne das/die Feld(er) mit dem niedrigsten schnitt zuerst, und wie oft es "schlecht" bewertet wurde (schlechtCount von bewertungen). Beispiel: "Bei Clara zeigt sich ein wiederkehrendes Muster bei der Verkehrsbeobachtung – 3 von 4 der letzten Bewertungen waren 'schlecht'."
- Wenn in letzteNotizen ein passender Freitext (thema/gut/schlecht) zum selben Bereich existiert, zitiere ihn kurz als konkretes Beispiel, statt nur die Zahl zu nennen.
- Erfinde keine Vorfälle oder Notizen, die nicht in letzteNotizen stehen.

Regeln für Aktionen (EINTRAGUNGEN), wie bisher:
- Schüler eindeutig über die Namen zuordnen. Bei mehreren/keinem Treffer needsClarification true.
- "fahrstunde": Schüler immer nötig; ohne Uhrzeit oder Dauer needsClarification true.
- "termin": title setzen; ohne Uhrzeit oder Dauer needsClarification true.
- "zahlung": Schüler und amount nötig; ohne Datum heutiges Datum (keine Rückfrage). Komma als Dezimaltrennzeichen.
- "adk"/"strecken": passenden Punkt aus dem Katalog finden, targetId und targetLabel zurückgeben. "erledigt"/"fertig"/"voll" -> value "voll", sonst konkrete Zahl.
- "schueler": Stammdaten eines Schülers ändern. Setze field auf "tel" (Telefonnummer), "anschrift" (Adresse) oder "bemerkungen" (Notizen). Setze value auf den neuen Textwert. Bei Notizen: wenn der Fahrlehrer etwas HINZUFÜGEN will ("füge hinzu", "ergänze", "notiere noch"), setze mode auf "anhaengen", sonst "ersetzen". Schüler eindeutig zuordnen, sonst needsClarification true. Andere Felder als diese drei kannst du nicht ändern; sage das in clarification mit action unknown.
- Relative Datumsangaben in JJJJ-MM-TT umrechnen.
- Wenn unklar, ob Frage oder Aktion, und es klingt nach einer Information: nimm "antwort".

Regeln für BEDIENUNGSFRAGEN zur App selbst (z.B. "Wie füge ich einen Schüler hinzu?", "Wie sage ich einen Termin ab?") - IMMER action "antwort":
- Nutze AUSSCHLIESSLICH die folgende Liste als Wissensquelle. Erfinde keine Menüpunkte, Knöpfe oder Abläufe, die hier nicht stehen - beschreibe stattdessen ehrlich das, was du sicher weißt, oder verweise auf "Mehr" als Ausgangspunkt.
- Antworte als kurze, nummerierte Schritt-für-Schritt-Anleitung (max. 5 Schritte), in du-Form, wie ein hilfsbereiter Kollege.

App-Wissen (Stand aktuelle Version):
- Neuen Schüler anlegen: Reiter "Schüler" → oben rechts "+ Schüler" → Vor-/Nachname eingeben, weitere Felder folgen automatisch.
- Fahrstunde eintragen: Schüler öffnen → Reiter "Ausbildung" (ADK-Karte) → Punkte antippen/abhaken, oder im Kalender einen bestätigten Termin nach der Fahrt mit "✓ Min bestätigen" abschließen (erscheint automatisch nach dem Termin, auch gesammelt unter Mehr → Tagesabschluss).
- Termin anlegen: Reiter "Kalender" → freie Zeit antippen, Schüler und Art wählen. Für mehrere Termine auf einmal: im Formular "Terminserie anlegen" aktivieren.
- Termin krankheitsbedingt absagen: Mehr → "Fahrlehrer krank" → Tag wählen → "Alle Fahrstunden absagen" → für jeden Schüler öffnet sich ein WhatsApp-Text zum Verschicken.
- Rechnung erstellen: Schüler öffnen → Reiter "Fahrten & Kosten" → offene Posten prüfen → "Rechnung erstellen".
- Buchungslink für Schüler: der Fahrschul-Code und der teilbare Buchungslink stehen NICHT in den Einstellungen, sondern beim einzelnen Schüler unter „Schülerdaten“ (Kasten „Fahrschülerbereich“); von dort an den Schüler senden, er kann damit offene Termine selbst anfragen.
- Ausbildungslimit / Limit je Schüler einstellen: Mehr → Einstellungen → Mein Bereich → Arbeit & Ausbildung → Karten "Mein Ausbildungslimit" (dein eigenes Tages-/Wochenlimit) bzw. "Limit je Fahrschüler" (Obergrenze pro einzelnem Schüler).
- Fahrtenbuch exportieren: Mehr → Einstellungen → Mein Bereich → Daten & Sicherung → "Fahrtenbuch als CSV exportieren".
- Prüfreife-Ampel: rot = noch viel offen, gelb = fast fertig, grün = prüfungsreif (ADK/Strecken komplett und Theorie bestanden). Sichtbar beim Schüler und gesammelt unter Mehr → Prüfungsplanung.
- Interessenten/Warteliste vor der Einschreibung erfassen: Mehr → "Interessenten" → "+ Interessent".
- Statistik (Umsatz, Erfolgsquote, Prüfreife): Mehr → "Statistik".`;

  const payload = {
    model: "claude-sonnet-5",
    max_tokens: 4096,
    // claude-sonnet-5 denkt ohne explizite Angabe standardmäßig nach (anders als
    // Vorgängermodelle), und max_tokens deckelt Denken + Antwort zusammen - bei
    // dieser kurzen JSON-Klassifizierungsaufgabe wird die Antwort dadurch sonst
    // knapp und kann abgeschnitten werden. Denken ist hier nicht nötig.
    thinking: { type: "disabled" },
    system,
    messages: [{ role: "user", content: message }],
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
    // Manche Antworten enthalten trotz Anweisung noch Text vor/nach dem JSON-Objekt
    // (z.B. eine kurze Einleitung) - robuster ist, den Bereich zwischen der ersten
    // öffnenden und letzten schließenden geschweiften Klammer zu extrahieren, statt
    // nur Markdown-Codezäune am Anfang/Ende zu entfernen.
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) {
      const first = text.indexOf("{");
      const last = text.lastIndexOf("}");
      if (first !== -1 && last > first) {
        try { parsed = JSON.parse(text.slice(first, last + 1)); }
        catch (e2) { parsed = null; }
      }
      if (!parsed) {
        // Bei Abbruch mitten im JSON (z.B. Antwortlänge ausgeschöpft) ist stop_reason
        // "max_tokens" - das dem Fahrlehrer statt eines generischen Fehlers zu sagen
        // hilft beim Einordnen, ob es ein einmaliger Ausrutscher war.
        const truncated = data && data.stop_reason === "max_tokens";
        const msg = truncated
          ? "Die Antwort wurde mitten im Satz abgeschnitten (zu lang). Bitte nochmal versuchen oder die Frage präziser stellen."
          : "Antwort konnte nicht gelesen werden";
        return { statusCode: 502, headers, body: JSON.stringify({ error: msg, raw: text }) };
      }
    }
    // Die Modell-Antwort wurde bisher ungeprüft durchgereicht. Der Client ordnet eine Aktion
    // ausschließlich über studentId zu (index.html z.B. students.find(s => s.id === p.studentId)),
    // zeigt im Bestätigungsdialog aber studentName an - fallen die beiden auseinander (Verwechslung
    // durch das Modell, oder gezielt über einen selbst angemeldeten Schülernamen als Prompt-
    // Injection provoziert), bestätigt der Fahrlehrer eine Aktion für die falsche Person, ohne es zu
    // merken. Deshalb hier serverseitig nachvalidieren, bevor die Antwort den Client erreicht.
    const AKTIONEN = ["antwort", "fahrstunde", "termin", "zahlung", "adk", "strecken", "schueler", "unknown"];
    const FELDER = ["tel", "anschrift", "bemerkungen"];
    const MODI = ["ersetzen", "anhaengen"];
    if (parsed && typeof parsed === "object") {
      if (!AKTIONEN.includes(parsed.action)) parsed.action = "unknown";
      if (parsed.action !== "antwort" && parsed.action !== "unknown") {
        const hit = roster.find((s) => s.id === parsed.studentId);
        if (!hit) {
          // Keine oder eine unbekannte studentId - lieber eine Rückfrage als eine Aktion auf einen
          // nicht existierenden bzw. nicht wirklich gemeinten Schüler anzubieten.
          parsed.needsClarification = true;
          parsed.clarification = parsed.clarification || "Ich bin mir nicht sicher, welchen Schüler du meinst - kannst du den Namen genauer nennen?";
        } else {
          // Anzeigename immer aus dem echten Datensatz nehmen, nie aus dem Modell-Text übernehmen -
          // so kann eine Verwechslung nicht mehr unbemerkt durch die Bestätigung rutschen.
          parsed.studentName = (hit.vorname + " " + hit.name).trim();
        }
      }
      if (parsed.action === "schueler") {
        if (!FELDER.includes(parsed.field)) { parsed.needsClarification = true; parsed.clarification = parsed.clarification || "Welches Feld soll ich ändern - Telefonnummer, Anschrift oder Bemerkungen?"; }
        if (parsed.mode != null && !MODI.includes(parsed.mode)) parsed.mode = "ersetzen";
      }
      if (parsed.action === "zahlung") {
        const n = Number(parsed.amount);
        parsed.amount = Number.isFinite(n) ? n : null;
        if (parsed.amount == null) { parsed.needsClarification = true; parsed.clarification = parsed.clarification || "Welcher Betrag wurde bezahlt?"; }
      }
      if (parsed.action === "fahrstunde" || parsed.action === "termin") {
        if (parsed.minutes != null) {
          const n = Number(parsed.minutes);
          parsed.minutes = Number.isFinite(n) ? n : null;
        }
      }
    }
    return { statusCode: 200, headers, body: JSON.stringify({ result: parsed }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
