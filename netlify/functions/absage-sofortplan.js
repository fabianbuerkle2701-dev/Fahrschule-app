// Netlify Function: Absage-Sofortplan - wer rueckt fuer einen ausgefallenen Termin nach?
//
// Faellt kurzfristig eine Fahrstunde aus, steht der Fahrlehrer vor einer Liste wartender
// Schueler und muss in wenigen Minuten entscheiden, wen er anschreibt. Die App kennt dabei
// alle harten Fakten (Ausbildungsstand, offene Sonderfahrten, Pruefungstermin, wie lange die
// letzte Fahrstunde her ist, wann der naechste Termin steht) - aber sie kann sie nicht
// gegeneinander abwaegen. Genau das passiert hier: Claude bekommt die fertig gerechneten
// Fakten und liefert eine Reihenfolge mit je einem Satz Begruendung plus eine fertige
// Nachricht, die der Fahrlehrer mit einem Klick per WhatsApp verschicken kann.
//
// Verschickt wird NICHTS von hier aus - die Nachricht landet im WhatsApp-Entwurf des
// Fahrlehrers, er liest sie und schickt sie selbst ab.
//
// Bearer-Token-gated wie kalender-assistent.js: nur angemeldete Fahrlehrer mit aktivem Abo,
// Demo-Account gesperrt (Anthropic-Kosten).

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
  if (!requesterToken) return { statusCode: 401, headers, body: JSON.stringify({ error: "Nicht angemeldet" }) };

  try {
    const whoResp = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + requesterToken },
    });
    if (!whoResp.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: "Sitzung ungültig oder abgelaufen" }) };
    const whoData = await whoResp.json().catch(() => null);
    if (whoData && whoData.id === "114d1f0a-9947-459d-8009-06282799ca44") {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Diese Funktion ist im Demo-Modus deaktiviert." }) };
    }
    const kiGate = await require("./lib/ki-guard").subscriptionGate(whoData && whoData.id, requesterToken);
    if (!kiGate.ok) return { statusCode: kiGate.statusCode, headers, body: JSON.stringify({ error: kiGate.error }) };
  } catch (e) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Anmeldung konnte nicht geprüft werden" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "Kein API-Schlüssel hinterlegt (ANTHROPIC_API_KEY)." }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Ungültige Anfrage" }) }; }

  // Jedes Feld einzeln kappen wie in den uebrigen KI-Functions - sonst kann ein Aufruf
  // beliebig grosse Strings mitschicken und die Tokenkosten hochtreiben.
  const cs = (v, n) => (v == null ? "" : String(v)).slice(0, n);
  const cn = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const cnn = (v) => (v == null ? null : cn(v)); // null bleibt null: "nicht bekannt" ist etwas anderes als 0

  const roh = Array.isArray(body.kandidaten) ? body.kandidaten.slice(0, 25) : [];
  if (!roh.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine wartenden Schüler übergeben" }) };

  const kandidaten = roh.map((k) => ({
    id: cs(k && k.id, 60),
    name: cs(k && k.name, 120),
    klasse: cs(k && k.klasse, 20),
    fahrstunden: cn(k && k.fahrstunden),
    gefahreneUE: cn(k && k.gefahreneUE),
    letzteFahrstundeVorTagen: cnn(k && k.letzteFahrstundeVorTagen),
    naechsterTerminInTagen: cnn(k && k.naechsterTerminInTagen),
    termineNaechste14Tage: cn(k && k.termineNaechste14Tage),
    offeneSonderfahrten: Array.isArray(k && k.offeneSonderfahrten) ? k.offeneSonderfahrten.slice(0, 5).map((s) => cs(s, 40)) : [],
    brauchtGenauDieseSonderfahrt: !!(k && k.brauchtGenauDieseSonderfahrt),
    reife: cs(k && k.reife, 40),
    theorieBestanden: !!(k && k.theorieBestanden),
    pruefungInTagen: cnn(k && k.pruefungInTagen),
    pruefung: cs(k && k.pruefung, 80),
    wunschfenster: cs(k && k.wunschfenster, 120),
  }));

  const t = body.termin && typeof body.termin === "object" ? body.termin : {};
  const termin = {
    tag: cs(t.tag, 60),
    von: cs(t.von, 5),
    bis: cs(t.bis, 5),
    minuten: cn(t.minuten),
    inTagen: cnn(t.inTagen),
    art: cs(t.art, 60),
    sonderfahrt: t.sonderfahrt ? cs(t.sonderfahrt, 40) : null,
    klasse: cs(t.klasse, 20),
    abgesagtVon: cs(t.abgesagtVon, 120),
    heute: cs(t.heute, 40),
  };

  const system = `Du hilfst einem Fahrlehrer, einen kurzfristig ausgefallenen Termin schnell wieder zu besetzen. Er hat wenig Zeit und will nicht die ganze Warteliste durchdenken - du sagst ihm, wen er in welcher Reihenfolge anschreiben soll, und lieferst die Nachricht gleich mit.

WICHTIG ZUR ARBEITSTEILUNG: Alle Zahlen in den Daten sind bereits ausgerechnet - Ausbildungsstand, offene Sonderfahrten, Tage seit der letzten Fahrstunde, Tage bis zum nächsten geplanten Termin, Tage bis zur Prüfung. Rechne NICHTS nach und erfinde keine Zahlen, Termine oder Preise. Jeder Schüler in der Liste passt zeitlich bereits auf den freien Termin und hat keinen Terminkonflikt - das ist geprüft. Deine Aufgabe ist allein das Gewichten und Formulieren.

So gewichtest du, von stark nach schwach:
1. "brauchtGenauDieseSonderfahrt": true heißt, der freie Termin ist eine Pflicht-Sonderfahrt nach FahrschAusbO (Überland, Autobahn oder Dämmerung), die genau dieser Schüler noch offen hat. Solche Termine sind an Tageszeit und Streckenart gebunden und deshalb rar - das schlägt alles andere.
2. "pruefungInTagen": je näher die Prüfung, desto dringender. Wer in weniger als 21 Tagen zur Prüfung will und noch offene Punkte hat, braucht jede Stunde.
3. "naechsterTerminInTagen": null heißt, es ist überhaupt nichts geplant - dieser Schüler kommt sonst gar nicht voran. Ein weit entfernter nächster Termin wiegt ähnlich schwer.
4. "letzteFahrstundeVorTagen": wer lange nichts gefahren ist, verliert Routine und muss beim nächsten Mal wiederholen. Ab etwa drei Wochen ist das ein echtes Argument.
5. "reife" und "gefahreneUE": wer kurz vor der Prüfung steht ("Prüfungsreif"/"Fast so weit"), profitiert mehr von einer zusätzlichen Stunde als jemand ganz am Anfang. Ein blutiger Anfänger mit sehr wenigen Stunden ist umgekehrt selten die beste Wahl für eine kurzfristig frei gewordene Stunde, weil er den Stoff noch nicht einordnen kann.

Für jeden Schüler lieferst du:
- rang: 1 für den, den er zuerst anschreiben soll, dann aufsteigend. Jede Zahl genau einmal.
- grund: EIN kurzer Satz auf Deutsch, der den Ausschlag nennt, mit der konkreten Zahl. Keine Floskeln, kein Wiederholen des Termins. Beispiele: "Braucht noch die Dämmerungsfahrt - die gibt es nur abends." / "Prüfung in 9 Tagen, danach ist kein Termin mehr geplant." / "Seit 26 Tagen nicht gefahren."
- nachricht: eine fertige WhatsApp-Nachricht an genau diesen Schüler, per Du, mit Vornamen angesprochen. Nenne Tag und Uhrzeit des freien Termins. Höchstens drei Sätze, freundlich, ohne Emojis, ohne Betreffzeile, ohne Unterschrift. Mach klar, dass die Stunde zuerst kommt, wer zuerst zusagt - aber setz niemanden unter Druck. Wenn der Grund es hergibt, greif ihn in einem Nebensatz auf ("passt gut, weil dir die Autobahnfahrt noch fehlt"). Erfinde nichts dazu: keine Preise, keine Treffpunkte, keine weiteren Termine.

Dazu eine "zusammenfassung": ein bis zwei Sätze an den Fahrlehrer, wen er zuerst fragen sollte und warum - und ob es überhaupt einen wirklich guten Kandidaten gibt. Passt niemand richtig, sag das offen; der Fahrlehrer kann die Stunde dann auch einfach der ganzen Warteliste in der App anbieten, statt jemanden zu überreden.

Sprich den Fahrlehrer sachlich und knapp an. Er entscheidet, wen er anschreibt - du bereitest es vor.`;

  const werkzeug = {
    name: "absage_sofortplan",
    description: "Reihenfolge der wartenden Schüler mit Begründung und fertiger Nachricht.",
    input_schema: {
      type: "object",
      properties: {
        zusammenfassung: { type: "string", description: "Ein bis zwei Sätze an den Fahrlehrer." },
        kandidaten: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Die id des Schülers, unverändert übernommen." },
              rang: { type: "integer", description: "1 = zuerst anschreiben." },
              grund: { type: "string", description: "Ein kurzer Satz auf Deutsch, mit konkreter Zahl." },
              nachricht: { type: "string", description: "Fertige WhatsApp-Nachricht, per Du, höchstens drei Sätze." },
            },
            required: ["id", "rang", "grund", "nachricht"],
          },
        },
      },
      required: ["zusammenfassung", "kandidaten"],
    },
  };

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4000,
        system,
        tools: [werkzeug],
        tool_choice: { type: "tool", name: "absage_sofortplan" },
        messages: [{ role: "user", content: "Der freie Termin:\n" + JSON.stringify(termin, null, 2)
          + "\n\nWartende Schüler, die zeitlich auf diesen Termin passen:\n" + JSON.stringify(kandidaten, null, 2) }],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : "KI-Anfrage fehlgeschlagen";
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
    }
    const block = Array.isArray(data.content) ? data.content.find((c) => c && c.type === "tool_use") : null;
    if (!block || !block.input) return { statusCode: 502, headers, body: JSON.stringify({ error: "Leere Antwort erhalten" }) };

    // Nur ids zurueckgeben, die auch angefragt wurden - eine erfundene id wuerde in der App
    // sonst auf einen Schueler zeigen, den es nicht gibt.
    const erlaubt = new Set(kandidaten.map((k) => k.id));
    const raus = (Array.isArray(block.input.kandidaten) ? block.input.kandidaten : [])
      .filter((k) => k && erlaubt.has(String(k.id)))
      .map((k) => ({
        id: String(k.id),
        rang: cn(k.rang),
        grund: cs(k.grund, 300),
        nachricht: cs(k.nachricht, 700),
      }));
    return { statusCode: 200, headers, body: JSON.stringify({
      zusammenfassung: cs(block.input.zusammenfassung, 600),
      kandidaten: raus,
    }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
