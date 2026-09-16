// Netlify Function: Leerlauf verdichten - Wartezeit zwischen Fahrstunden zusammenschieben.
//
// Der Fahrlehrer sieht in seinem Kalender zwar, dass zwischen zwei Terminen zwei Stunden Luft
// sind - was er nicht sieht, ist, welche EINE Verschiebung den Tag wieder zusammenzieht, ohne
// einem Schueler eine Zeit zuzumuten, zu der er gar nicht kann. Genau das passiert hier.
//
// Zwei harte Regeln, die den Vorschlag ueberhaupt erst zumutbar machen:
//   1. Der TAG bleibt, nur die Uhrzeit rueckt. Ein Schueler, der sich den Dienstag freigenommen
//      hat, soll nicht auf den Mittwoch geschoben werden.
//   2. Die DAUER bleibt. Damit aendert sich an Tages-, Wochen- und Schuelerlimits nichts - die
//      App muss die gar nicht erst neu pruefen, weil sich die Summen nicht bewegen.
//
// Verschickt oder verschoben wird nichts von hier aus: die App prueft jeden Vorschlag noch
// einmal gegen Arbeitszeiten und Ueberschneidungen und legt ihn dem Fahrlehrer einzeln vor.
//
// Bearer-Token-gated wie die uebrigen KI-Functions, Demo-Account gesperrt.

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

  const cs = (v, n) => (v == null ? "" : String(v)).slice(0, n);
  const cn = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  const rohTage = Array.isArray(body.tage) ? body.tage.slice(0, 14) : [];
  if (!rohTage.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Tage mit Leerlauf übergeben" }) };

  const tage = rohTage.map((t) => ({
    datum: cs(t && t.datum, 10),
    tag: cs(t && t.tag, 30),
    arbeitszeit: cs(t && t.arbeitszeit, 30),
    leerlaufGesamtMin: cn(t && t.leerlaufGesamtMin),
    leerlauf: Array.isArray(t && t.leerlauf) ? t.leerlauf.slice(0, 8).map((l) => ({
      von: cs(l && l.von, 5), bis: cs(l && l.bis, 5), min: cn(l && l.min),
    })) : [],
    termine: Array.isArray(t && t.termine) ? t.termine.slice(0, 14).map((a) => ({
      id: cs(a && a.id, 60),
      schueler: cs(a && a.schueler, 120),
      von: cs(a && a.von, 5),
      bis: cs(a && a.bis, 5),
      minuten: cn(a && a.minuten),
      art: cs(a && a.art, 60),
      sonderfahrt: a && a.sonderfahrt ? cs(a.sonderfahrt, 40) : null,
      wunschfenster: cs(a && a.wunschfenster, 60),
      fest: !!(a && a.fest),
    })) : [],
  }));

  const k = body.kontext && typeof body.kontext === "object" ? body.kontext : {};
  const kontext = {
    heute: cs(k.heute, 40),
    minGewinnMin: Math.max(15, Math.min(180, cn(k.minGewinnMin) || 30)),
  };

  const system = `Du hilfst einem Fahrlehrer, Wartezeit aus seinem Kalender zu nehmen. Zwischen zwei Fahrstunden steht er sonst herum: die Zeit ist zu kurz zum Heimfahren und zu lang zum Warten. Du sagst ihm, welche EINZELNE Verschiebung den Tag wieder zusammenzieht.

WICHTIG ZUR ARBEITSTEILUNG: Die Zeiten, Lücken und Arbeitszeiten sind fertig gerechnet. Rechne nichts nach und erfinde keine Termine. Die App prüft jede Verschiebung anschließend erneut gegen Arbeitszeiten und Überschneidungen - was nicht passt, fällt heraus.

ZWEI REGELN, DIE DU NIE BRICHST:
1. Der TAG bleibt. Du verschiebst nur innerhalb desselben Tages, nie auf einen anderen. Ein Schüler, der sich diesen Nachmittag freigenommen hat, kann morgen vielleicht gar nicht.
2. Die DAUER bleibt. Du gibst nur eine neue Startzeit an; die Länge des Termins ändert sich nicht.

Weitere Grenzen:
- Termine mit "fest": true sind unverschiebbar (Urlaub, Theorieunterricht, private Termine, sonstige Tätigkeiten). Sie bleiben, wo sie sind - du musst um sie herum planen.
- Die neue Zeit muss vollständig innerhalb der Arbeitszeit des Tages liegen und darf sich mit KEINEM anderen Termin dieses Tages überschneiden - auch nicht mit einem, den du selbst gerade woanders hin verschiebst.
- Steht bei einem Termin ein "wunschfenster", hat der Schüler selbst angegeben, wann er kann. Verschiebe ihn nur innerhalb dieses Fensters.
- Eine Dämmerungsfahrt (Sonderfahrt "Dämmerungsfahrt") darf NICHT in den hellen Tag geschoben werden - sie ist an die Dämmerung gebunden. Überland- und Autobahnfahrten brauchen ihre Länge, die bleibt ohnehin.
- Schlage eine Verschiebung nur vor, wenn sie mindestens ${kontext.minGewinnMin} Minuten Leerlauf einspart. Für eine Viertelstunde bittet man keinen Schüler, seinen Tag umzustellen.
- Lieber EINE Verschiebung pro Tag als drei. Jede Verschiebung kostet Goodwill beim Schüler; wenn eine einzige die Lücke schließt, nimm die.
- Ein Tag mit nur einem Termin hat keinen Leerlauf, sondern nur einen kurzen Arbeitstag - dort gibt es nichts zu verdichten.

Für jede Verschiebung lieferst du:
- id: die id des Termins, unverändert übernommen
- neueVon: die neue Startzeit als HH:MM
- grund: EIN kurzer Satz an den Fahrlehrer, der den Gewinn benennt. Beispiel: "Schließt direkt an Timo um 10:00 an und spart 90 Minuten Wartezeit."
- nachricht: eine fertige WhatsApp-Nachricht an genau diesen Schüler, per Du, mit Vornamen. Nenne die alte und die neue Uhrzeit und frag, ob das passt. Höchstens drei Sätze, freundlich, ohne Emojis, ohne Unterschrift, ohne Druck - der Schüler darf ohne Weiteres Nein sagen. Erfinde keinen Grund, den du nicht kennst, und verspreche nichts.

Dazu eine "zusammenfassung": ein bis zwei Sätze, wie viel Wartezeit insgesamt wegfällt und an welchen Tagen. Findest du nichts Sinnvolles, sag das offen - ein Kalender ohne unnötige Lücken ist ein gutes Ergebnis, kein Versagen.

Sprich den Fahrlehrer sachlich und knapp an. Er entscheidet, wen er fragt.`;

  const werkzeug = {
    name: "leerlauf_plan",
    description: "Vorgeschlagene Verschiebungen innerhalb desselben Tages, mit Begründung und fertiger Nachricht.",
    input_schema: {
      type: "object",
      properties: {
        zusammenfassung: { type: "string", description: "Ein bis zwei Sätze an den Fahrlehrer." },
        verschiebungen: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Die id des Termins, unverändert übernommen." },
              neueVon: { type: "string", description: "Neue Startzeit HH:MM, gleicher Tag." },
              grund: { type: "string", description: "Ein kurzer Satz mit dem Gewinn." },
              nachricht: { type: "string", description: "Fertige WhatsApp-Nachricht, per Du, höchstens drei Sätze." },
            },
            required: ["id", "neueVon", "grund", "nachricht"],
          },
        },
      },
      required: ["zusammenfassung", "verschiebungen"],
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
        tool_choice: { type: "tool", name: "leerlauf_plan" },
        messages: [{ role: "user", content: "Rahmenbedingungen:\n" + JSON.stringify(kontext, null, 2)
          + "\n\nTage mit Leerlauf:\n" + JSON.stringify(tage, null, 2) }],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : "KI-Anfrage fehlgeschlagen";
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
    }
    const block = Array.isArray(data.content) ? data.content.find((c) => c && c.type === "tool_use") : null;
    if (!block || !block.input) return { statusCode: 502, headers, body: JSON.stringify({ error: "Leere Antwort erhalten" }) };

    // Nur ids, die auch angefragt wurden, und nur solche, die nicht als fest markiert waren -
    // ein "verschobener" Urlaubstag waere ein echter Schaden, kein Vorschlag.
    const beweglich = new Set();
    tage.forEach((t) => t.termine.forEach((a) => { if (!a.fest && a.id) beweglich.add(a.id); }));
    const verschiebungen = (Array.isArray(block.input.verschiebungen) ? block.input.verschiebungen : [])
      .filter((v) => v && beweglich.has(String(v.id)))
      .slice(0, 20)
      .map((v) => ({
        id: String(v.id),
        neueVon: cs(v.neueVon, 5),
        grund: cs(v.grund, 300),
        nachricht: cs(v.nachricht, 700),
      }));
    return { statusCode: 200, headers, body: JSON.stringify({
      zusammenfassung: cs(block.input.zusammenfassung, 600),
      verschiebungen,
    }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
