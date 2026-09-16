// Netlify Function: KI-Kalenderassistent fuer offene Terminvorschlaege.
//
// Aufgabenteilung, bewusst so geschnitten:
//   Die APP rechnet alle harten Fakten selbst aus - Ueberschneidungen, Tages-/Wochenlimit,
//   Arbeitszeiten, Feiertage, Leerlauf zwischen Terminen. Das sind exakte Rechnungen, und ein
//   Sprachmodell rechnet Zeiten nachweislich schlechter als Code.
//   CLAUDE bekommt diese fertigen Fakten und macht das, was Code nicht kann: abwaegen,
//   gewichten und in einem Satz begruenden, warum ein Vorschlag angenommen oder abgelehnt
//   werden sollte - und in welcher Reihenfolge man sie am besten bestaetigt.
//
// Die Antwort ist strukturiert (erzwungenes Tool), damit die App sie direkt in Haekchen
// uebersetzen kann, statt Prosa zu parsen.
//
// Bearer-Token-gated wie pruefreife-einschaetzung.js: nur angemeldete Fahrlehrer mit aktivem
// Abo, Demo-Account gesperrt (Anthropic-Kosten).

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

  // Jedes Feld einzeln kappen, wie in den uebrigen KI-Functions: sonst kann ein Aufruf
  // beliebig grosse Strings mitschicken und die Tokenkosten hochtreiben.
  const cs = (v, n) => (v == null ? "" : String(v)).slice(0, n);
  const cn = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  const roh = Array.isArray(body.vorschlaege) ? body.vorschlaege.slice(0, 40) : [];
  if (!roh.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Terminvorschläge übergeben" }) };

  const vorschlaege = roh.map((v) => ({
    id: cs(v && v.id, 60),
    schueler: cs(v && v.schueler, 120),
    tag: cs(v && v.tag, 30),
    von: cs(v && v.von, 5),
    bis: cs(v && v.bis, 5),
    minuten: cn(v && v.minuten),
    art: cs(v && v.art, 60),
    sonderfahrt: v && v.sonderfahrt ? cs(v.sonderfahrt, 40) : null,
    klasse: cs(v && v.klasse, 20),
    hinweise: Array.isArray(v && v.hinweise) ? v.hinweise.slice(0, 8).map((h) => cs(h, 200)) : [],
    leerlaufDavorMin: v && v.leerlaufDavorMin == null ? null : cn(v.leerlaufDavorMin),
    leerlaufDanachMin: v && v.leerlaufDanachMin == null ? null : cn(v.leerlaufDanachMin),
    bestaetigteAmTag: cn(v && v.bestaetigteAmTag),
    minutenAmTag: cn(v && v.minutenAmTag),
    schuelerFahrstunden: cn(v && v.schuelerFahrstunden),
    schuelerStand: cs(v && v.schuelerStand, 120),
  }));

  // Die Woche drumherum: Arbeitszeit, schon belegte Minuten und freie Luecken je Tag.
  // Damit kann der Assistent sagen, wo noch Platz waere, statt nur Vorschlag fuer Vorschlag
  // zu urteilen.
  const woche = (Array.isArray(body.woche) ? body.woche.slice(0, 18) : []).map((t) => ({
    tag: cs(t && t.tag, 30),
    arbeitszeit: cs(t && t.arbeitszeit, 30),
    bestaetigteMinuten: cn(t && t.bestaetigteMinuten),
    freieLuecken: Array.isArray(t && t.freieLuecken) ? t.freieLuecken.slice(0, 6).map((l) => cs(l, 20)) : [],
  }));

  const k = body.kontext && typeof body.kontext === "object" ? body.kontext : {};
  const kontext = {
    heute: cs(k.heute, 30),
    arbeitszeiten: cs(k.arbeitszeiten, 400),
    tageslimitMin: cn(k.tageslimitMin),
    wochenlimitMin: cn(k.wochenlimitMin),
    leerlaufGrenzeMin: cn(k.leerlaufGrenzeMin) || 60,
  };

  const system = `Du bist der Kalenderassistent eines Fahrlehrers. Vor dir liegen offene Terminvorschläge, die Fahrschüler über den Buchungslink geschickt haben. Der Fahrlehrer will sie NICHT einzeln im Kalender durchgehen - du sagst ihm, welche er annehmen sollte und welche nicht, damit er einmal bestätigt und fertig ist.

WICHTIG ZUR ARBEITSTEILUNG: Alle harten Prüfungen sind bereits erledigt und stehen als Fakten in den Daten - Überschneidungen, Tages- und Wochenlimit, Arbeitszeiten, Feiertage sowie der Leerlauf zwischen den Terminen ("leerlaufDavorMin"/"leerlaufDanachMin", in Minuten, null wenn es an dem Tag keinen Nachbartermin gibt). Rechne NICHTS davon selbst nach und erfinde keine Zeiten. Deine Aufgabe ist das Abwägen und Begründen.

So entscheidest du:
- Steht in "hinweise" ein harter Konflikt (Überschneidung, Limit überschritten, außerhalb der Arbeitszeit, Feiertag/Sonntag), dann "ablehnen". Das ist nicht verhandelbar.
- SONDERFAHRTEN SIND DIE WICHTIGSTE AUSNAHME. Steht in "sonderfahrt" ein Wert (Überland, Autobahn, Dämmerungsfahrt), dann ist das eine nach FahrschAusbO vorgeschriebene Pflichtfahrt, die an eine Tageszeit oder Streckenart gebunden ist. Eine Dämmerungsfahrt MUSS abends oder in der Dämmerung stattfinden, Überland- und Autobahnfahrten brauchen lange Strecken am Stück. Dass so ein Termin weit weg von den übrigen liegt, ist dort völlig normal und KEIN Ablehnungsgrund - empfiehl sie im Zweifel "annehmen" und erwähne den Leerlauf höchstens als Nebensatz. Lehne eine Sonderfahrt nur ab, wenn ein echter harter Konflikt in "hinweise" steht.
- Ist der Leerlauf davor oder danach größer als ${kontext.leerlaufGrenzeMin} Minuten, ist ein NORMALER Termin wirtschaftlich fragwürdig: der Fahrlehrer wartet dann zwischen zwei Fahrstunden herum. Empfiehl dann "ablehnen" und sag im Grund, wie lang die Lücke ist - es sei denn, es ist der einzige Termin an dem Tag (dann gibt es keinen Leerlauf, sondern nur einen kurzen Arbeitstag) oder der Schüler braucht den Termin dringend.
- Termine, die sich nahtlos oder mit kurzer Pause an bestehende anschließen, sind besonders wertvoll - hebe das hervor.
- Wer erst wenige Fahrstunden hat oder laut "schuelerStand" bald zur Prüfung will, bekommt im Zweifel den Vorzug.
- Bleibt ein Vorschlag ohne jeden Einwand, dann "annehmen" - ohne lange Begründung.

Für jeden Vorschlag lieferst du:
- empfehlung: "annehmen" oder "ablehnen"
- grund: EIN kurzer, konkreter Satz auf Deutsch, der den Ausschlag nennt. Keine Floskeln, keine Wiederholung des Termins. Beispiele: "Schließt direkt an die Fahrstunde um 10:00 an." / "Danach 2,5 Stunden Leerlauf bis zum nächsten Termin." / "Überschneidet sich mit Lena Berger um 14:00."
- reihenfolge: 1 für den Vorschlag, den er zuerst bestätigen sollte, dann aufsteigend. Abgelehnte bekommen die hohen Zahlen.

Dazu eine "zusammenfassung": zwei bis drei Sätze zur ganzen Woche, nicht nur zu den einzelnen Vorschlägen. Nenne Zahlen (wie viele annehmen, wie viele ablehnen) und nutze die Wochenübersicht: wenn ein Tag nach dem Bestätigen noch große freie Lücken hat oder auffällig leer bleibt, sag das - der Fahrlehrer kann dann gezielt jemanden nachrücken lassen. Ist die Woche dagegen gut gefüllt, sag auch das.

Steht bei einem Tag "nicht hinterlegt", dann sind für diesen Wochentag schlicht keine Arbeitszeiten eingetragen - dann sind auch die freien Lücken unbekannt. Sag in diesem Fall NICHT, der Tag sei frei oder leer, und leite daraus keine Empfehlung ab. Trifft das auf die ganze Woche zu, erwähne einmal beiläufig, dass hinterlegte Arbeitszeiten (Einstellungen) die Planung deutlich genauer machen würden.

Der Fahrlehrer kann jede deiner Empfehlungen im Anschluss einzeln umdrehen. Schreib deshalb so, dass er die Entscheidung nachvollziehen und bewusst anders entscheiden kann - nicht so, als wäre sie schon getroffen.

Sprich den Fahrlehrer direkt an, sachlich und knapp. Die Entscheidung trifft am Ende er - du bereitest sie vor.`;

  const werkzeug = {
    name: "kalender_empfehlung",
    description: "Die Empfehlung je Terminvorschlag plus eine Gesamtzusammenfassung.",
    input_schema: {
      type: "object",
      properties: {
        zusammenfassung: { type: "string", description: "Zwei Sätze zur Gesamtlage, mit Zahlen." },
        termine: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Die id des Vorschlags, unverändert übernommen." },
              empfehlung: { type: "string", enum: ["annehmen", "ablehnen"] },
              grund: { type: "string", description: "Ein kurzer Satz auf Deutsch." },
              reihenfolge: { type: "integer", description: "1 = zuerst bestätigen." },
            },
            required: ["id", "empfehlung", "grund", "reihenfolge"],
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
      // Abwaegen ueber mehrere Termine hinweg ist genau die Art Aufgabe, bei der Nachdenken
      // hilft - anders als bei den Prosa-Functions hier also NICHT abgeschaltet. max_tokens
      // deckelt Denken und Antwort zusammen, deshalb grosszuegig bemessen.
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 8000,
        system,
        tools: [werkzeug],
        tool_choice: { type: "tool", name: "kalender_empfehlung" },
        messages: [{ role: "user", content: "Rahmenbedingungen:\n" + JSON.stringify(kontext, null, 2)
          + "\n\nDie Woche drumherum (Arbeitszeit, schon belegte Minuten, freie Lücken je Tag):\n" + JSON.stringify(woche, null, 2)
          + "\n\nOffene Terminvorschläge:\n" + JSON.stringify(vorschlaege, null, 2) }],
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
    // sonst auf einen Termin zeigen, den es nicht gibt.
    const erlaubt = new Set(vorschlaege.map((v) => v.id));
    const termine = (Array.isArray(block.input.termine) ? block.input.termine : [])
      .filter((t) => t && erlaubt.has(String(t.id)))
      .map((t) => ({
        id: String(t.id),
        empfehlung: t.empfehlung === "ablehnen" ? "ablehnen" : "annehmen",
        grund: cs(t.grund, 300),
        reihenfolge: cn(t.reihenfolge),
      }));
    return { statusCode: 200, headers, body: JSON.stringify({
      zusammenfassung: cs(block.input.zusammenfassung, 600),
      termine,
    }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
