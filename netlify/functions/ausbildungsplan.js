// Ausbildungsnavigator (v2.113.0): KI ordnet den vom Code berechneten Fahrstundenplan didaktisch,
// begründet kurz und gibt Praxistipps - bzw. schlägt beim Abschluss "Das lief gut" / "Nächstes Mal" vor.
//
// Grundsatz: CODE BERECHNET FAKTEN, KI STRUKTURIERT, FAHRLEHRER ENTSCHEIDET.
// - Die KI wählt nur aus den mitgeschickten Kandidaten (key). Unbekannte keys werden verworfen.
// - Minuten werden serverseitig auf die verfügbare Zeit (Dauer minus Reserve) begrenzt.
// - Erzwungenes Werkzeug (tool_choice) statt Freitext-JSON, wie kalender-assistent.js.
// Der API-Schlüssel kommt aus den Netlify-Umgebungsvariablen (ANTHROPIC_API_KEY).

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdnVmdGxmbmtudWN4dW9ydGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDQ2NDQsImV4cCI6MjA5Njg4MDY0NH0.5ZoBdQLnJw23dMZ4IKmAauycVcPoVPIZdmNamZ8MEv8";
const { kiSignal, istKiTimeout, kiTimeoutAntwort } = require("./lib/ki-timeout");

const cs = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const cn = (v, lo, hi) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : null; };

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
    const whoResp = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + requesterToken } });
    if (!whoResp.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: "Sitzung ungültig oder abgelaufen" }) };
    const whoData = await whoResp.json().catch(() => null);
    if (whoData && whoData.id === "114d1f0a-9947-459d-8009-06282799ca44")
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Diese Funktion ist im Demo-Modus deaktiviert." }) };
    const kiGate = await require("./lib/ki-guard").subscriptionGate(whoData && whoData.id, requesterToken);
    if (!kiGate.ok) return { statusCode: kiGate.statusCode, headers, body: JSON.stringify({ error: kiGate.error }) };
  } catch (e) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Anmeldung konnte nicht geprüft werden" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "KI ist nicht eingerichtet" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Ungültige Anfrage" }) }; }
  const modus = body.modus === "abschluss" ? "abschluss" : "plan";
  const d = body.daten && typeof body.daten === "object" ? body.daten : {};
  const vorname = cs(d.vorname, 40) || "der Schüler";

  // Fakten aufbereiten (nur, was der Code geschickt hat - alles gekürzt)
  const letzte = (Array.isArray(d.letzteStunden) ? d.letzteStunden : []).slice(0, 5).map(l => ({
    datum: cs(l.datum, 10), thema: cs(l.thema, 160), gut: cs(l.gut, 200), schlecht: cs(l.schlecht, 200) }));
  const schwaechen = (Array.isArray(d.schwaechen) ? d.schwaechen : []).slice(0, 5).map(x => cs(x, 80));

  let werkzeug, prompt, maxTokens;
  if (modus === "plan") {
    const dauer = cn(d.dauer, 30, 240) || 90;
    const reserve = cn(d.reserve, 0, 30) || 10;
    const verfuegbar = dauer - reserve;
    const kandidaten = (Array.isArray(d.kandidaten) ? d.kandidaten : []).slice(0, 12).map(k => ({
      key: cs(k.key, 80), titel: cs(k.titel, 100), bereich: cs(k.sektion, 60), art: cs(k.art, 20), grund: cs(k.grund, 200), minuten: cn(k.minuten, 5, 120) }))
      .filter(k => k.key && k.titel);
    if (!kandidaten.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Planpunkte übergeben" }) };
    werkzeug = {
      name: "fahrstundenplan",
      description: "Didaktisch geordneter Plan für die nächste Fahrstunde aus den vorgegebenen Kandidaten.",
      input_schema: { type: "object", properties: {
        zusammenfassung: { type: "string", description: "1–2 kurze Sätze: Warum dieser Plan? Nur aus den Fakten." },
        plan: { type: "array", items: { type: "object", properties: {
          key: { type: "string", description: "Exakt ein key aus den Kandidaten" },
          minuten: { type: "integer" },
          grund: { type: "string", description: "Ein kurzer Satz, warum dieser Punkt heute sinnvoll ist" },
          tipp: { type: "string", description: "Ein konkreter Praxistipp für den Fahrlehrer, auf diesen Schüler bezogen" },
        }, required: ["key", "minuten", "grund"] } },
      }, required: ["zusammenfassung", "plan"] },
    };
    prompt = "Du hilfst einem Fahrlehrer, die nächste Fahrstunde mit " + vorname + " vorzubereiten.\n"
      + "Die Kandidaten hat die App aus der ADK und den bisherigen Fahrstunden berechnet. Wähle NUR aus diesen Kandidaten (key exakt übernehmen), "
      + "bringe sie in eine didaktisch sinnvolle Reihenfolge (Wiederholung vor Neuem, Anwendung zum Schluss), verteile die Minuten (zusammen höchstens " + verfuegbar + " Minuten) "
      + "und gib je Punkt einen kurzen Grund und einen konkreten, praktischen Tipp. Du darfst Punkte weglassen, aber keine neuen erfinden. "
      + "Erfinde keine Fakten, Termine, ADK-Inhalte oder rechtlichen Anforderungen; die Prüfungsreife legst du nicht fest. Kurz und ohne Floskeln.\n\n"
      + "FAKTEN:\n" + JSON.stringify({ klasse: cs(d.klasse, 6), ausbildungsstand: cn(d.pct, 0, 100), phase: cs(d.phase, 20), dauer, reserve,
        pruefungInTagen: d.pruefInTagen == null ? null : cn(d.pruefInTagen, -400, 400), notizNaechsteStunde: cs(d.lastNote, 300),
        wiederkehrendeSchwaechen: schwaechen, letzteStunden: letzte, hinweise: (Array.isArray(d.hinweise) ? d.hinweise : []).slice(0, 4).map(x => cs(x, 160)), kandidaten });
    maxTokens = 1400;
    body.__kandidaten = kandidaten; body.__verfuegbar = verfuegbar;
  } else {
    const erg = (Array.isArray(d.ergebnisse) ? d.ergebnisse : []).slice(0, 10).map(r => ({ titel: cs(r.titel, 100), status: ["sitzt", "weiter", "nicht"].indexOf(r.status) >= 0 ? r.status : "nicht" }));
    if (!erg.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Ergebnisse übergeben" }) };
    werkzeug = {
      name: "fahrstunden_abschluss",
      description: "Kurze Texte für das Fahrstunden-Tagebuch.",
      input_schema: { type: "object", properties: {
        gut: { type: "string", description: "Das lief gut – 1 Satz, nur aus Punkten mit Status sitzt" },
        naechstes: { type: "string", description: "Nächstes Mal – 1 Satz aus weiter/nicht" },
      }, required: ["gut", "naechstes"] },
    };
    prompt = "Formuliere für das Fahrstunden-Tagebuch von " + vorname + " je einen kurzen Satz für „Das lief gut“ und „Nächstes Mal“. "
      + "Nutze ausschließlich diese Ergebnisse (sitzt = gut, weiter = weiter üben, nicht = nicht behandelt) und die genannten Schwächen. Nichts erfinden, kein Lob ohne Grundlage.\n\n"
      + JSON.stringify({ ergebnisse: erg, wiederkehrendeSchwaechen: schwaechen });
    maxTokens = 400;
  }

  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: kiSignal(context),
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: maxTokens, thinking: { type: "disabled" },
        tools: [werkzeug], tool_choice: { type: "tool", name: werkzeug.name },
        messages: [{ role: "user", content: prompt }] }),
    });
  } catch (e) {
    if (istKiTimeout(e)) return kiTimeoutAntwort(headers);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "KI nicht erreichbar" }) };
  }
  const out = await resp.json().catch(() => null);
  if (!resp.ok || !out) return { statusCode: 502, headers, body: JSON.stringify({ error: (out && out.error && out.error.message) || "KI-Fehler" }) };
  const block = (out.content || []).find(b => b.type === "tool_use");
  const inp = block && block.input;
  if (!inp) return { statusCode: 502, headers, body: JSON.stringify({ error: "Antwort konnte nicht gelesen werden" }) };

  if (modus === "abschluss")
    return { statusCode: 200, headers, body: JSON.stringify({ gut: cs(inp.gut, 300), naechstes: cs(inp.naechstes, 300) }) };

  // Serverseitig prüfen: nur bekannte keys, jeder höchstens einmal, Minuten begrenzt, Summe <= verfügbar
  const bekannt = new Map(body.__kandidaten.map(k => [k.key, k]));
  const gesehen = new Set();
  let plan = (Array.isArray(inp.plan) ? inp.plan : []).filter(p => p && bekannt.has(p.key) && !gesehen.has(p.key) && gesehen.add(p.key))
    .map(p => ({ key: p.key, minuten: cn(p.minuten, 5, 120) || bekannt.get(p.key).minuten || 15, grund: cs(p.grund, 220), tipp: cs(p.tipp, 260) }));
  let summe = plan.reduce((s, p) => s + p.minuten, 0);
  if (summe > body.__verfuegbar && summe > 0) {
    const f = body.__verfuegbar / summe;
    plan = plan.map(p => ({ ...p, minuten: Math.max(5, Math.floor(p.minuten * f / 5) * 5) }));
    summe = plan.reduce((s, p) => s + p.minuten, 0);
    while (summe > body.__verfuegbar && plan.length) { const last = plan[plan.length - 1]; if (last.minuten > 5) { last.minuten -= 5; summe -= 5; } else { plan.pop(); summe -= last.minuten; } }
  }
  if (!plan.length) return { statusCode: 502, headers, body: JSON.stringify({ error: "KI lieferte keinen gültigen Plan" }) };
  return { statusCode: 200, headers, body: JSON.stringify({ zusammenfassung: cs(inp.zusammenfassung, 300), plan }) };
};
