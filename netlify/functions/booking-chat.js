// Netlify Function: Chat-Assistent auf der öffentlichen Buchungsseite UND in der Fahrschüler-App.
// Beantwortet Standardfragen von Interessenten (Preise, Klassen, Anmeldung) automatisch,
// ohne dass jemand ans Telefon muss. Antwortet ausschließlich anhand der über public_chat_facts
// geladenen, für diese eine Fahrschule hinterlegten Fakten - keine erfundenen Preise, keine
// Rechts-/Prüfungsauskünfte.
//
// Diese Function ist bewusst OHNE Anmeldung erreichbar (Interessenten sind noch keine Schüler
// und haben keinen Login). Genau das war bei den anderen KI-Functions vor Task #76 die
// Sicherheitslücke - hier wird stattdessen über den Buchungscode + ein Tageslimit
// (public_chat_rate_limit) geschützt, damit die Function nicht zur offenen Kostenfalle wird.
//
// Ist ein Schüler eingeloggt, schickt der Client zusätzlich Name+PIN mit (Phase 1 des
// "Verwaltung ersetzen"-Fahrplans). Diese werden HIER serverseitig über dieselbe
// public_student_overview-RPC verifiziert, die auch StudentArea nutzt - dem Client wird
// nie vertraut, genau wie bei jeder anderen public_student_*-RPC in dieser App. Schlägt die
// Verifikation fehl (falscher PIN, kein Login), läuft der Chat einfach als anonymer
// Schulfakten-Chat weiter, ohne einen Fehler zurückzugeben - so lässt sich von außen nicht
// durch Fehlermeldungen erraten, ob ein Name/PIN existiert.
const crypto = require("crypto");

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdnVmdGxmbmtudWN4dW9ydGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDQ2NDQsImV4cCI6MjA5Njg4MDY0NH0.5ZoBdQLnJw23dMZ4IKmAauycVcPoVPIZdmNamZ8MEv8";

// Nach außen gehen nur diese festen Sätze - der Rohtext der Anthropic-API bzw. einer Exception
// wäre für den anonymen Aufrufer englischer Jargon und würde nebenbei den Betriebszustand des
// KI-Kontos verraten (Schlüssel ungültig, Kontingent erschöpft). Der Originaltext landet
// stattdessen per console.error in den Netlify-Logs.
const FEHLER_ALLGEMEIN = "Der Assistent ist gerade nicht erreichbar. Bitte versuch es in ein paar Minuten noch einmal.";
const FEHLER_AUSLASTUNG = "Gerade sind sehr viele Anfragen unterwegs. Bitte versuch es in einer Minute noch einmal.";
const FEHLER_TAGESLIMIT = "Für heute sind schon viele Fragen gestellt worden. Bitte versuch es morgen wieder oder nutze das Anmeldeformular.";

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
  if (!apiKey) {
    // Welche Umgebungsvariable fehlt, geht den anonymen Aufrufer nichts an - nur ins Log.
    console.error("booking-chat: ANTHROPIC_API_KEY fehlt");
    return { statusCode: 500, headers, body: JSON.stringify({ error: FEHLER_ALLGEMEIN }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Ungültige Anfrage" }) }; }

  const code = (body.code || "").toString().trim();
  const message = (body.message || "").toString().trim().slice(0, 800);
  const studentName = (body.name || "").toString().trim().slice(0, 200);
  const pin = (body.pin || "").toString().trim().slice(0, 50);
  // Nur die letzten paar Runden mitschicken - reicht für Rückfragen im Kontext, hält die
  // Anfrage aber klein (jede Runde kostet, und die Fragen sind kurze Standardthemen).
  //
  // Der Verlauf des Clients wird dabei normalisiert statt ihm zu vertrauen: Die Messages-API
  // verlangt, dass die ERSTE Nachricht die Rolle "user" hat, und lehnt leere Textblöcke ab.
  // Der Client hängt bei einem fehlgeschlagenen Senden nur die Frage an, nie eine Antwort -
  // dadurch kippte die Parität der Liste dauerhaft, und sobald sie länger als 6 wurde, begann
  // der Ausschnitt auf einem assistant-Eintrag. Ab da lief jede weitere Frage in einen 400 der
  // API, der Chat war bis zum Neuladen der Seite tot, und jeder Versuch zählte trotzdem gegen
  // das Tageslimit.
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.trim())
    .slice(-6);
  while (history.length && history[0].role !== "user") history.shift();
  if (!code) return { statusCode: 400, headers, body: JSON.stringify({ error: "Kein Buchungscode übergeben" }) };
  if (!message) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Nachricht übergeben" }) };

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
  const facts = Array.isArray(factsRows) ? factsRows[0] : null;
  if (!facts || !facts.school_name) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: "Unbekannter Buchungslink" }) };
  }

  // Zweite, an den Aufrufer gebundene Zähldimension. Vorher hing das Tageslimit allein am
  // Buchungscode, und der ist kein Geheimnis (er steht in jedem verschickten Buchungslink):
  // eine curl-Schleife von einem einzigen Rechner konnte damit in Sekunden das gesamte
  // Tageskontingent einer Fahrschule aufbrauchen und den Chat für Interessenten UND für
  // eingeloggte Schüler bis Mitternacht abschalten.
  //
  // Gezählt wird nicht die IP selbst, sondern nur eines von 64 Fächern, in das ihr Hash fällt.
  // Das bindet den Zähler an den Aufrufer, ohne eine personenbeziehbare Kennung zu speichern,
  // und deckelt die Zeilen in public_chat_usage auf 64 pro Schule und Tag (die Tabelle wird
  // nirgends aufgeräumt). Bewusst VOR dem Schul-Limit geprüft: sonst würden die hier
  // abgewiesenen Anfragen das gemeinsame Kontingent trotzdem verbrauchen.
  const reqHeaders = event.headers || {};
  const ipRoh = reqHeaders["x-nf-client-connection-ip"] || reqHeaders["client-ip"] || reqHeaders["x-forwarded-for"] || "";
  // x-forwarded-for kann eine Kette sein - der erste Eintrag ist der ursprüngliche Aufrufer.
  const clientIp = ipRoh.toString().split(",")[0].trim();
  if (clientIp) {
    const fach = parseInt(crypto.createHash("sha256").update(clientIp).digest("hex").slice(0, 8), 16) % 64;
    const ipAllowed = await rpc("public_chat_rate_limit", { code, max_per_day: 25, p_feature: "booking-chat-ip" + fach });
    if (ipAllowed !== true) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: FEHLER_TAGESLIMIT }) };
    }
  }

  // Erhöht gegenüber v1.103.0 (40), weil jetzt auch eingeloggte Schüler mitzählen, nicht nur
  // Interessenten - beide teilen sich weiterhin ein gemeinsames Tageslimit pro Fahrschule.
  const allowed = await rpc("public_chat_rate_limit", { code, max_per_day: 60, p_feature: "booking-chat" });
  if (allowed !== true) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: FEHLER_TAGESLIMIT }) };
  }

  const packages = Array.isArray(facts.packages) ? facts.packages : [];
  const klassen = Array.isArray(facts.klassen) && facts.klassen.length ? facts.klassen.join(", ") : "keine hinterlegt";
  const packagesText = packages.length
    ? packages.map((p) => "- " + (p.name || p.label || "Paket") + (p.price != null ? ": " + p.price + " €" : "")).join("\n")
    : "keine Pakete hinterlegt";

  // Persönlicher Block: nur wenn Name+PIN mitgeschickt wurden UND die Verifikation hier
  // serverseitig erfolgreich war (dieselbe RPC + derselbe PIN-Check wie beim normalen Login
  // in StudentArea). Bewusst OHNE Finanzdaten/Prozent-Fortschritt - die Berechnung dafür lebt
  // clientseitig (sumCharges/calcLern) und würde serverseitig dupliziert schnell auseinanderlaufen;
  // stattdessen verweist der Assistent bei solchen Fragen ehrlich auf "Mein Fortschritt" in der App.
  let personalBlock = "";
  if (studentName && pin) {
    const overviewRows = await rpc("public_student_overview", { code, p_name: studentName, p_pin: pin });
    const overview = Array.isArray(overviewRows) ? overviewRows[0] : null;
    const vorname = overview && overview.student && overview.student.vorname;
    if (vorname) {
      const appts = Array.isArray(overview.appointments) ? overview.appointments : [];
      const jetzt = new Date().toISOString();
      const kommend = appts
        .filter((a) => a && a.status === "confirmed" && (a.end_at || a.start_at) >= jetzt)
        .sort((a, b) => a.start_at.localeCompare(b.start_at));
      const naechster = kommend[0];
      const naechsterText = naechster
        ? new Date(naechster.start_at).toLocaleString("de-DE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) + " Uhr"
        : "kein bestätigter Termin eingetragen";
      const offers = Array.isArray(overview.offers) ? overview.offers.length : 0;
      personalBlock = `

Zusätzlich bist du gerade mit ${vorname} verbunden (eingeloggt, PIN geprüft) - nutze das NUR, wenn die Frage erkennbar die eigene Person betrifft, sonst antworte wie gewohnt allgemein:
- Nächster bestätigter Termin: ${naechsterText}
- Anzahl bestätigter, künftiger Termine: ${kommend.length}
- Offene Warteliste-Angebote: ${offers > 0 ? offers + " (im Reiter Termine sichtbar)" : "keine"}
- Theorie laut Fahrlehrer bestanden: ${overview.student.theorie ? "ja" : "nein"}
Für genauen Ausbildungsstand in Prozent oder offene Beträge hast du keine Daten - verweise dafür freundlich auf den Reiter "Mein Fortschritt" bzw. direkt auf den Fahrlehrer, rate niemals eine Zahl.`;
    }
  }

  const system = `Du bist der automatische Chat-Assistent der Fahrschule "${facts.school_name}", erreichbar auf der Buchungsseite und in der Fahrschüler-App. Interessenten und Fahrschüler stellen dir Fragen. Antworte kurz, freundlich, auf Deutsch, in 2-4 Sätzen.

Das sind die EINZIGEN allgemeinen Fakten, die du verwenden darfst:
- Fahrschule: ${facts.school_name}${facts.subtitle ? " (" + facts.subtitle + ")" : ""}
- Standort: ${facts.city || "nicht hinterlegt"}
- Angebotene Klassen: ${klassen}
- Preis pro Fahrstunde: ${facts.price_hour != null ? facts.price_hour + " €" : "nicht hinterlegt"}
- Pakete:
${packagesText}
- Anmeldung: über den Reiter "Neu anmelden" auf dieser Seite, unverbindlich, die Fahrschule meldet sich dann${personalBlock}

Regeln, unbedingt einhalten:
1. Erfinde NIEMALS Preise, Zeiten, Erfolgsquoten oder Aussagen, die oben nicht stehen.
2. Keine Rechtsberatung, keine Zusagen zu Prüfungsterminen oder -ergebnissen.
3. Wenn eine Frage nicht aus den Fakten oben beantwortbar ist (z.B. konkrete freie Termine, individuelle Beratung, Sonderfälle), sag das ehrlich und verweise auf das Anmeldeformular oder den direkten Kontakt zur Fahrschule.
4. Wenn nach Preis/Klasse gefragt wird, die hier "nicht hinterlegt" ist, sag das ebenso ehrlich statt zu raten.
5. Du bist kein Mensch - wenn danach gefragt wird, sag klar, dass du ein automatischer Assistent bist.`;

  const messages = [
    // history ist oben schon gefiltert und auf einen user-Anfang gebracht; hier bleibt nur noch
    // das Kürzen. Getrimmt wird vor dem Kürzen, damit aus einem führenden Leerzeichen-Block kein
    // leerer Textblock wird - den lehnt die API ebenfalls mit 400 ab.
    ...history.map((m) => ({ role: m.role, content: m.text.trim().slice(0, 800) })),
    { role: "user", content: message },
  ];

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      // claude-sonnet-5 denkt ohne explizite Angabe standardmäßig nach, und max_tokens deckelt
      // Denken + Antwort zusammen - dabei kann das gesamte Budget fürs Denken draufgehen und
      // für die eigentliche Antwort nichts übrig lassen. Denken ist für diese kurzen Chat-
      // Antworten nicht nötig.
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 400, thinking: { type: "disabled" }, system, messages }),
    });
    // Ein Fehler der Gegenseite muss nicht zwingend JSON sein (Infrastruktur-Seite, leerer Body),
    // deshalb hier auffangen statt in den catch unten laufen zu lassen - so bleibt wenigstens der
    // HTTP-Status für das Log erhalten.
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      console.error("booking-chat: Anthropic-Fehler", resp.status, (data && data.error && data.error.message) || "(kein JSON-Fehlertext)");
      const msg = (resp.status === 429 || resp.status === 529) ? FEHLER_AUSLASTUNG : FEHLER_ALLGEMEIN;
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
    }
    let text = "";
    if (data && Array.isArray(data.content)) text = data.content.map((c) => (c && c.type === "text" ? c.text : "")).join("").trim();
    if (!text) {
      console.error("booking-chat: leere oder unlesbare Antwort der KI");
      return { statusCode: 502, headers, body: JSON.stringify({ error: FEHLER_ALLGEMEIN }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ reply: text }) };
  } catch (e) {
    // Auch e.message bleibt intern: bei Netzwerkfehlern stehen darin Host- und DNS-Angaben.
    console.error("booking-chat: unerwarteter Fehler", e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: FEHLER_ALLGEMEIN }) };
  }
};
