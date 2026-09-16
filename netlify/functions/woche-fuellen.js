// Netlify Function: Woche aktiv fuellen - freie Fenster mit den Schuelern besetzen, die es
// am noetigsten haben.
//
// Abgrenzung zum Luecken-Radar in der App: der findet ein freies Fenster und bietet es allen
// passenden Wartelisten-Schuelern an - wer zuerst zusagt, bekommt es. Das ist reaktiv und
// blind fuer den Ausbildungsstand. Hier geht es um die ganze Woche und um die Frage, WER in
// welches Fenster gehoert: wer seit Wochen nicht gefahren ist, wessen Pruefung naeher rueckt,
// wem noch eine Pflichtfahrt fehlt.
//
// Angelegt werden daraus VORSCHLAEGE (status "pending"), die der Schueler selbst bestaetigt -
// kein Termin wird ihm ungefragt in den Kalender gesetzt.
//
// Bearer-Token-gated wie die uebrigen KI-Functions, Demo-Account gesperrt.

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdnVmdGxmbmtudWN4dW9ydGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDQ2NDQsImV4cCI6MjA5Njg4MDY0NH0.5ZoBdQLnJw23dMZ4IKmAauycVcPoVPIZdmNamZ8MEv8";

const ARTEN = ["ÜST", "ÜL", "AB", "NF"];

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

  const cs = (v, n) => (v == null ? "" : String(v)).slice(0, n);
  const cn = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const cnn = (v) => (v == null ? null : cn(v));

  const rohTage = Array.isArray(body.tage) ? body.tage.slice(0, 10) : [];
  if (!rohTage.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "In dieser Woche ist kein Fenster frei." }) };
  const rohSchueler = Array.isArray(body.schueler) ? body.schueler.slice(0, 30) : [];
  if (!rohSchueler.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Schüler übergeben" }) };

  const tage = rohTage.map((t) => ({
    datum: cs(t && t.datum, 10),
    tag: cs(t && t.tag, 30),
    arbeitszeit: cs(t && t.arbeitszeit, 30),
    bestaetigteMinuten: cn(t && t.bestaetigteMinuten),
    freieFenster: Array.isArray(t && t.freieFenster) ? t.freieFenster.slice(0, 6).map((f) => cs(f, 20)) : [],
    sonnenuntergang: t && t.sonnenuntergang ? cs(t.sonnenuntergang, 5) : null,
    hinweis: t && t.hinweis ? cs(t.hinweis, 60) : null,
  }));

  const schueler = rohSchueler.map((s) => ({
    id: cs(s && s.id, 60),
    name: cs(s && s.name, 120),
    klasse: cs(s && s.klasse, 20),
    gefahreneUE: cn(s && s.gefahreneUE),
    reife: cs(s && s.reife, 40),
    theorieBestanden: !!(s && s.theorieBestanden),
    letzteFahrstundeVorTagen: cnn(s && s.letzteFahrstundeVorTagen),
    naechsterTerminInTagen: cnn(s && s.naechsterTerminInTagen),
    termineDieseWoche: cn(s && s.termineDieseWoche),
    offeneSonderfahrten: Array.isArray(s && s.offeneSonderfahrten) ? s.offeneSonderfahrten.slice(0, 5).map((x) => cs(x, 40)) : [],
    pruefungInTagen: cnn(s && s.pruefungInTagen),
    wunschfenster: cs(s && s.wunschfenster, 120),
    aufWarteliste: !!(s && s.aufWarteliste),
  }));

  const k = body.kontext && typeof body.kontext === "object" ? body.kontext : {};
  const kontext = {
    heute: cs(k.heute, 40),
    tageslimitMin: cn(k.tageslimitMin),
    wochenlimitMin: cn(k.wochenlimitMin),
    freiMinutenGesamt: cn(k.freiMinutenGesamt),
    maxTermine: Math.max(1, Math.min(20, cn(k.maxTermine) || 10)),
  };

  const system = `Du füllst für einen Fahrlehrer die freien Zeiten der kommenden Woche. Er hat Lücken im Kalender und eine Liste eigener Fahrschüler - du sagst ihm, wer in welche Lücke gehört und warum.

WICHTIG ZUR ARBEITSTEILUNG: Die freien Fenster in "tage" sind fertig gerechnet; Arbeitszeiten, bestehende Termine, Urlaub und Feiertage sind darin schon berücksichtigt. Rechne nichts nach. Du darfst NUR Termine vorschlagen, die vollständig in eines dieser Fenster passen: "datum" muss eines der vorgegebenen Daten sein, "von" plus "minuten" müssen komplett innerhalb EINES Fensters dieses Tages liegen. Und du darfst nur die vorgegebenen "schuelerId" verwenden. Die App prüft anschließend jeden Vorschlag erneut gegen Fenster, Überschneidungen und Limits - was nicht passt, fällt heraus.

Wen du bevorzugst, von stark nach schwach:
1. "naechsterTerminInTagen": null heißt, der Schüler hat überhaupt keinen Termin mehr. Der kommt sonst gar nicht voran und steht ganz oben.
2. "pruefungInTagen": je näher die Prüfung, desto dringender jede Stunde.
3. "offeneSonderfahrten": fehlende Pflichtfahrten nach FahrschAusbO blockieren die Prüfungszulassung. Plane sie mit mindestens 90 Minuten - in 45-Minuten-Häppchen sind Überland und Autobahn fachlich wertlos. Eine Dämmerungsfahrt (NF) frühestens etwa zur Sonnenuntergangszeit des Tages; steht dort null, nimm das späteste Fenster.
4. "letzteFahrstundeVorTagen": ab etwa drei Wochen ohne Fahrstunde geht Routine verloren.
5. "aufWarteliste": true heißt, der Schüler hat selbst gesagt, dass er kurzfristig kann - bei sonst gleicher Lage ist er die bessere Wahl, weil er wahrscheinlich zusagt.

Grenzen, die du einhältst:
- Steht bei einem Schüler ein "wunschfenster", plane ihn NUR in diesem Zeitfenster. Das ist seine eigene Angabe, wann er kann.
- Höchstens zwei neue Termine pro Schüler in dieser Woche, nie zwei am selben Tag. Wer schon "termineDieseWoche" hat, bekommt höchstens noch einen dazu.
- Höchstens ${kontext.maxTermine} Vorschläge insgesamt.
- Übliche Längen: 45, 90 oder 135 Minuten. 90 ist der Standard.
- Steht bei einem Tag ein "hinweis" (etwa ein Feiertag), plane dort nur, wenn es sonst nicht aufgeht.
- Du musst nicht jedes Fenster füllen. Ein Vorschlag ohne Grund ist schlechter als eine Lücke: der Fahrlehrer verbrennt damit Anrufe und der Schüler sagt ab. Schlage nur vor, wo du den Grund in einem Satz benennen kannst.

Für jeden Vorschlag lieferst du:
- datum (YYYY-MM-DD, exakt eines der vorgegebenen), von (HH:MM), minuten (ganze Zahl), art (genau einer der Codes ÜST, ÜL, AB, NF), schuelerId (exakt eine der vorgegebenen ids)
- grund: EIN kurzer Satz an den Fahrlehrer, mit der konkreten Zahl. Beispiele: "Seit 24 Tagen nicht gefahren und kein Termin geplant." / "Prüfung in 11 Tagen, Autobahnfahrt fehlt noch."

Dazu eine "zusammenfassung": ein bis zwei Sätze - wie viele Stunden du belegst, wie viel frei bleibt und wer trotz Bedarf leer ausgeht, weil kein passendes Fenster da war. Findest du kaum etwas, sag das offen.

Sprich den Fahrlehrer sachlich und knapp an. Er entscheidet, was wirklich vorgeschlagen wird.`;

  const werkzeug = {
    name: "wochen_plan",
    description: "Vorschläge, welcher Schüler in welches freie Fenster der Woche gehört.",
    input_schema: {
      type: "object",
      properties: {
        zusammenfassung: { type: "string", description: "Ein bis zwei Sätze an den Fahrlehrer." },
        termine: {
          type: "array",
          items: {
            type: "object",
            properties: {
              datum: { type: "string", description: "YYYY-MM-DD, exakt eines der vorgegebenen Daten." },
              von: { type: "string", description: "HH:MM, innerhalb eines freien Fensters dieses Tages." },
              minuten: { type: "integer", description: "Dauer in Minuten, üblich 45, 90 oder 135." },
              art: { type: "string", enum: ARTEN },
              schuelerId: { type: "string", description: "Die id des Schülers, unverändert übernommen." },
              grund: { type: "string", description: "Ein kurzer Satz mit der konkreten Zahl." },
            },
            required: ["datum", "von", "minuten", "art", "schuelerId", "grund"],
          },
        },
      },
      required: ["zusammenfassung", "termine"],
    },
  };

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 8000,
        system,
        tools: [werkzeug],
        tool_choice: { type: "tool", name: "wochen_plan" },
        messages: [{ role: "user", content: "Rahmenbedingungen:\n" + JSON.stringify(kontext, null, 2)
          + "\n\nFreie Fenster in der Woche:\n" + JSON.stringify(tage, null, 2)
          + "\n\nEigene Fahrschüler:\n" + JSON.stringify(schueler, null, 2) }],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : "KI-Anfrage fehlgeschlagen";
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
    }
    const block = Array.isArray(data.content) ? data.content.find((c) => c && c.type === "tool_use") : null;
    if (!block || !block.input) return { statusCode: 502, headers, body: JSON.stringify({ error: "Leere Antwort erhalten" }) };

    // Nur vorgegebene Tage, Arten und Schueler-ids - alles Weitere prueft die App noch einmal
    // gegen Fenster, Ueberschneidungen und Limits.
    const erlaubteTage = new Set(tage.map((t) => t.datum));
    const erlaubteIds = new Set(schueler.map((s) => s.id));
    const termine = (Array.isArray(block.input.termine) ? block.input.termine : [])
      .filter((t) => t && erlaubteTage.has(String(t.datum)) && erlaubteIds.has(String(t.schuelerId)) && ARTEN.indexOf(String(t.art)) >= 0)
      .slice(0, kontext.maxTermine)
      .map((t) => ({
        datum: String(t.datum),
        von: cs(t.von, 5),
        minuten: Math.max(15, Math.min(480, cn(t.minuten) || 45)),
        art: String(t.art),
        schuelerId: String(t.schuelerId),
        grund: cs(t.grund, 300),
      }));
    return { statusCode: 200, headers, body: JSON.stringify({
      zusammenfassung: cs(block.input.zusammenfassung, 600),
      termine,
    }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
