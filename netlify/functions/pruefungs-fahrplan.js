// Netlify Function: Weg zur Pruefung - konkreter Terminplan bis zu einem feststehenden Pruefungstag.
//
// Abgrenzung zum bestehenden Rueckwaerts-Fahrplan (rueckwaertsFahrplan() in index.html): der
// rechnet aus einem ZIELMONAT eine grobe Wochenfrequenz und schlaegt eine stumpfe Terminserie
// im Wochentakt vor - ohne zu wissen, was dem Schueler inhaltlich noch fehlt und wann der
// Fahrlehrer ueberhaupt Zeit hat. Hier geht es um einen FESTEN Pruefungstag: was fehlt noch
// (offene Sonderfahrten samt Pflicht-Doppelstunde, offene Ausbildungspunkte, Theorie), welche
// Fenster sind bis dahin wirklich frei - und in welcher Reihenfolge legt man die Stunden
// sinnvoll hinein.
//
// Arbeitsteilung wie bei den anderen Kalender-Functions: die App rechnet alle Zahlen und
// Fenster exakt aus und prueft JEDEN zurueckgegebenen Termin anschliessend noch einmal gegen
// Fenster, Ueberschneidungen und Limits nach. Claude waehlt aus den vorgegebenen Fenstern aus
// und begruendet - erfundene Zeiten fallen in der App durch die Pruefung.
//
// Bearer-Token-gated wie kalender-assistent.js: nur angemeldete Fahrlehrer mit aktivem Abo,
// Demo-Account gesperrt (Anthropic-Kosten).

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdnVmdGxmbmtudWN4dW9ydGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDQ2NDQsImV4cCI6MjA5Njg4MDY0NH0.5ZoBdQLnJw23dMZ4IKmAauycVcPoVPIZdmNamZ8MEv8";

const ARTEN = ["ÜST", "ÜL", "AB", "NF"];

const { kiSignal, istKiTimeout, kiTimeoutAntwort } = require("./lib/ki-timeout");

exports.handler = async function (event, context) {
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

  const rohTage = Array.isArray(body.tage) ? body.tage.slice(0, 60) : [];
  if (!rohTage.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "Bis zur Prüfung sind keine Tage mit freien Fenstern übergeben worden." }) };

  const tage = rohTage.map((t) => ({
    datum: cs(t && t.datum, 10),
    tag: cs(t && t.tag, 30),
    freieFenster: Array.isArray(t && t.freieFenster) ? t.freieFenster.slice(0, 6).map((f) => cs(f, 20)) : [],
    sonnenuntergang: t && t.sonnenuntergang ? cs(t.sonnenuntergang, 5) : null,
    hinweis: t && t.hinweis ? cs(t.hinweis, 60) : null,
  }));

  const s = body.schueler && typeof body.schueler === "object" ? body.schueler : {};
  const schueler = {
    name: cs(s.name, 120),
    klasse: cs(s.klasse, 20),
    fahrstunden: cn(s.fahrstunden),
    gefahreneUE: cn(s.gefahreneUE),
    reife: cs(s.reife, 40),
    theorieBestanden: !!s.theorieBestanden,
  };

  const p = body.pruefung && typeof body.pruefung === "object" ? body.pruefung : {};
  const pruefung = { tag: cs(p.tag, 60), datum: cs(p.datum, 10), inTagen: cn(p.inTagen), art: cs(p.art, 40) };

  const o = body.offen && typeof body.offen === "object" ? body.offen : {};
  const offen = {
    sonderfahrten: Array.isArray(o.sonderfahrten) ? o.sonderfahrten.slice(0, 6).map((x) => ({
      art: cs(x && x.art, 40),
      code: ARTEN.indexOf(cs(x && x.code, 5)) >= 0 ? cs(x.code, 5) : "",
      offeneUE: cn(x && x.offeneUE),
      langeFahrtFehlt: !!(x && x.langeFahrtFehlt),
    })) : [],
    adkPunkte: Array.isArray(o.adkPunkte) ? o.adkPunkte.slice(0, 25).map((x) => cs(x, 120)) : [],
    streckenPunkte: Array.isArray(o.streckenPunkte) ? o.streckenPunkte.slice(0, 25).map((x) => cs(x, 120)) : [],
    theorieOffen: !!o.theorieOffen,
    restUEGeschaetzt: cnn(o.restUEGeschaetzt),
  };

  const geplant = (Array.isArray(body.geplant) ? body.geplant.slice(0, 40) : []).map((g) => ({
    tag: cs(g && g.tag, 30), datum: cs(g && g.datum, 10), von: cs(g && g.von, 5),
    minuten: cn(g && g.minuten), art: cs(g && g.art, 40),
  }));

  const k = body.kontext && typeof body.kontext === "object" ? body.kontext : {};
  const kontext = {
    heute: cs(k.heute, 40),
    tageslimitMin: cn(k.tageslimitMin),
    wochenlimitMin: cn(k.wochenlimitMin),
    maxTermine: Math.max(1, Math.min(20, cn(k.maxTermine) || 14)),
  };

  const system = `Du planst für einen Fahrlehrer den Weg eines Fahrschülers bis zu einem feststehenden Prüfungstag. Der Prüfungstermin ist gesetzt - deine Aufgabe ist, die verbleibende Zeit so zu belegen, dass der Schüler bis dahin fertig wird, und ehrlich zu sagen, wenn das nicht mehr aufgeht.

WICHTIG ZUR ARBEITSTEILUNG: Die freien Fenster in "tage" sind bereits fertig gerechnet - Arbeitszeiten des Fahrlehrers, bestehende Termine, Feiertage und Urlaub sind darin schon berücksichtigt. Rechne NICHTS nach. Du darfst AUSSCHLIESSLICH Termine vorschlagen, die vollständig in eines dieser Fenster passen: "datum" muss eines der vorgegebenen Daten sein, und "von" plus "minuten" müssen komplett innerhalb EINES Fensters dieses Tages liegen. Die App prüft jeden Termin anschließend erneut gegen Fenster, Überschneidungen und Limits - alles, was nicht passt, fällt heraus und der Plan hat eine Lücke. Erfinde also nichts.

Was der Schüler noch braucht, steht in "offen":
- "sonderfahrten" sind Pflichtfahrten nach FahrschAusbO. Ohne sie ist keine Prüfungszulassung möglich - sie haben Vorrang vor allem anderen. "offeneUE" ist die noch fehlende Menge (1 UE = 45 Minuten). Steht "langeFahrtFehlt" auf true, muss davon mindestens einmal eine Doppelstunde von mindestens 90 Minuten am Stück dabei sein - plane dann ausdrücklich einen Block von 90 Minuten oder mehr.
- Eine Dämmerungsfahrt (Code NF) MUSS in der Dämmerung oder danach stattfinden. Bei jedem Tag steht der Sonnenuntergang; plane NF frühestens etwa zur Sonnenuntergangszeit. Steht dort null, ist der Sonnenuntergang nicht bekannt - lege die Fahrt dann auf das späteste freie Fenster des Tages.
- Überland (ÜL) und Autobahn (AB) brauchen lange Strecken am Stück: mindestens 90 Minuten, in kurzen 45-Minuten-Häppchen sind sie fachlich wertlos.
- Steht bei einem Tag ein "hinweis" (etwa ein Feiertag), plane dort nur, wenn es sonst nicht aufgeht - und sag es dann in der Einschätzung.
- "adkPunkte" und "streckenPunkte" sind noch nicht vollständig geübte Ausbildungsinhalte. Dafür sind normale Übungsfahrten (Code ÜST) da.
- Ist "theorieOffen" true, fehlt noch die bestandene Theorieprüfung. Das kannst du nicht einplanen, aber erwähne es in der Einschätzung - ohne sie gibt es keine praktische Prüfung.

So planst du:
- Sonderfahrten zuerst, und zwar früh: sie brauchen lange Blöcke und passende Tageszeiten, freie Fenster dafür sind rar. Je näher die Prüfung, desto unwahrscheinlicher findet sich noch ein 135-Minuten-Fenster.
- Die letzten etwa fünf Tage vor der Prüfung gehören der Prüfungsvorbereitung: normale Übungsfahrten (ÜST) auf dem Prüfungsniveau, keine erstmalige Sonderfahrt mehr.
- Am Prüfungstag selbst und danach planst du nichts.
- Höchstens zwei Termine pro Tag für denselben Schüler, und nicht an jedem einzelnen Tag - zwischen den Fahrstunden braucht der Schüler Zeit zum Setzen des Gelernten. Zwei bis drei Termine pro Woche sind ein gutes Maß, mehr nur, wenn die Zeit sonst nicht reicht.
- Höchstens ${kontext.maxTermine} Termine insgesamt.
- Übliche Längen: 45, 90 oder 135 Minuten. Nimm 90 als Standard.

Für jeden Termin lieferst du:
- datum (YYYY-MM-DD, exakt eines der vorgegebenen), von (HH:MM), minuten (ganze Zahl), art (genau einer der Codes ÜST, ÜL, AB, NF)
- inhalt: worum es in dieser Stunde geht, halber Satz. Beispiele: "Autobahn: Auffahren, Spurwechsel, Richtgeschwindigkeit" / "Prüfungsnahe Übungsfahrt im Prüfgebiet"
- grund: warum genau hier, EIN kurzer Satz. Beispiel: "Einziges 135-Minuten-Fenster vor der Prüfung." / "Nach Sonnenuntergang um 19:12."

Dazu:
- machbar: "ja", wenn alles Pflichtige bis zur Prüfung sicher untergebracht ist; "knapp", wenn es rechnerisch aufgeht, aber ohne Puffer für Ausfälle; "nein", wenn Pflichtinhalte nicht mehr hineinpassen.
- einschaetzung: zwei bis drei Sätze an den Fahrlehrer. Nenne Zahlen. Bei "nein" sag klar, was fehlt und was die Alternative ist (Prüfungstermin schieben, zusätzliche Arbeitszeiten, mehr Termine pro Woche). Beschönige nichts - ein Schüler, der unvorbereitet zur Prüfung geht, kostet ihn mehr als eine unangenehme Nachricht heute.

Sprich den Fahrlehrer direkt an, sachlich und knapp. Er entscheidet, welche Termine er wirklich anlegt - du bereitest sie vor.`;

  const werkzeug = {
    name: "pruefungs_fahrplan",
    description: "Konkreter Terminplan bis zum Prüfungstag plus Einschätzung, ob der Termin zu halten ist.",
    input_schema: {
      type: "object",
      properties: {
        machbar: { type: "string", enum: ["ja", "knapp", "nein"] },
        einschaetzung: { type: "string", description: "Zwei bis drei Sätze mit Zahlen." },
        termine: {
          type: "array",
          items: {
            type: "object",
            properties: {
              datum: { type: "string", description: "YYYY-MM-DD, exakt eines der vorgegebenen Daten." },
              von: { type: "string", description: "HH:MM, innerhalb eines freien Fensters dieses Tages." },
              minuten: { type: "integer", description: "Dauer in Minuten, üblich 45, 90 oder 135." },
              art: { type: "string", enum: ARTEN },
              inhalt: { type: "string", description: "Worum es in dieser Stunde geht, halber Satz." },
              grund: { type: "string", description: "Warum genau hier, ein kurzer Satz." },
            },
            required: ["datum", "von", "minuten", "art", "inhalt", "grund"],
          },
        },
      },
      required: ["machbar", "einschaetzung", "termine"],
    },
  };

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      signal: kiSignal(context),
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      // Wie beim Kalenderassistenten: das Einpassen mehrerer Pflichtfahrten in begrenzte Fenster
      // ist genau die Art Aufgabe, bei der Nachdenken hilft - deshalb nicht abgeschaltet.
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 8000,
        system,
        tools: [werkzeug],
        tool_choice: { type: "tool", name: "pruefungs_fahrplan" },
        messages: [{ role: "user", content: "Rahmenbedingungen:\n" + JSON.stringify(kontext, null, 2)
          + "\n\nSchüler:\n" + JSON.stringify(schueler, null, 2)
          + "\n\nPrüfung:\n" + JSON.stringify(pruefung, null, 2)
          + "\n\nWas noch offen ist:\n" + JSON.stringify(offen, null, 2)
          + "\n\nBereits geplante Termine dieses Schülers bis zur Prüfung:\n" + JSON.stringify(geplant, null, 2)
          + "\n\nFreie Fenster je Tag bis zur Prüfung:\n" + JSON.stringify(tage, null, 2) }],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : "KI-Anfrage fehlgeschlagen";
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
    }
    const block = Array.isArray(data.content) ? data.content.find((c) => c && c.type === "tool_use") : null;
    if (!block || !block.input) return { statusCode: 502, headers, body: JSON.stringify({ error: "Leere Antwort erhalten" }) };

    // Nur Tage zurueckgeben, die auch angefragt wurden, und nur bekannte Art-Codes - alles
    // Weitere prueft die App noch einmal gegen Fenster, Ueberschneidungen und Limits.
    const erlaubteTage = new Set(tage.map((t) => t.datum));
    const termine = (Array.isArray(block.input.termine) ? block.input.termine : [])
      .filter((t) => t && erlaubteTage.has(String(t.datum)) && ARTEN.indexOf(String(t.art)) >= 0)
      .slice(0, kontext.maxTermine)
      .map((t) => ({
        datum: String(t.datum),
        von: cs(t.von, 5),
        minuten: Math.max(15, Math.min(480, cn(t.minuten) || 45)),
        art: String(t.art),
        inhalt: cs(t.inhalt, 200),
        grund: cs(t.grund, 200),
      }));
    const machbar = ["ja", "knapp", "nein"].indexOf(block.input.machbar) >= 0 ? block.input.machbar : "knapp";
    return { statusCode: 200, headers, body: JSON.stringify({
      machbar,
      einschaetzung: cs(block.input.einschaetzung, 800),
      termine,
    }) };
  } catch (e) {
    if (istKiTimeout(e)) return kiTimeoutAntwort(headers);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
