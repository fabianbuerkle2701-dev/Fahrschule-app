// Netlify Function: Nachricht aus dem Allindrive Autopilot senden (21.10.2026).
// Fahrschul-Admin oder Büro schreibt im Autopilot eine E-Mail von Hand und schickt sie über das verbundene
// Postfach der Fahrschule (wie die Antworten im Posteingang, posteingang-senden.js). Genau zwei Fälle:
//  - art "erinnerung": Zahlungserinnerung zu einer Rechnung. Empfänger ist der Schüler, bei einem
//    Firmenkunden mit Rechnungs-E-Mail die Firma. Danach steht sie im Erinnerungs-Protokoll des Schülers
//    (school_erinnerung_vermerken, Weg „email“).
//  - art "nachfassen": Nachfassen bei einem Interessenten. Danach ist der nächste Kontakt in drei Tagen
//    fällig, und ein neuer Interessent („offen“) gilt als kontaktiert (school_interessent_speichern).
// Die Empfänger-Adresse bestimmt immer der Server aus den gespeicherten Daten, nie die App. Reiner Text,
// kein HTML, keine Anhänge, kein Bezug auf eine frühere Mail, kein KI-Hinweis (ein Mensch hat geschrieben).
// Vermerk und Interessent speichert die Function mit dem Token des Nutzers, damit auth.uid() er selbst ist.
//
// Schutz vor Doppelversand: Die App schickt je Nachricht einen Schlüssel (UUID). Vor dem Senden steht er in
// nachrichten_ausgang als „reserviert“ (eindeutig je Fahrschule) - zwei Klicks senden also nur einmal. Schon
// gesendet → ok ohne zweiten Versand; noch reserviert → 409; nach einem Sendefehler darf derselbe Schlüssel
// es noch einmal versuchen. Grenzen: 100 gesendete Mails je Fahrschule und Tag, 10 je Person und Minute.
// Datenschutz: Adressen, Betreff und Text kommen nie ins Log; gespeichert werden nur Empfänger und Betreff.

const { dienst, benutzerAusToken, rpcAlsBenutzer } = require("./lib/dienst");
const { nachrichtSenden, emailGueltig } = require("./lib/postfach");

const ADMIN_UID = "96530a9f-28ae-4ac6-9cfa-26de392ecf05";
const DEMO_UID = "114d1f0a-9947-459d-8009-06282799ca44";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAGESLIMIT = 100;     // gesendete Mails je Fahrschule und Tag (Berliner Zeit)
const MINUTENLIMIT = 10;    // Sendeversuche je Person und Minute
const HAENGT_NACH = 120000; // so alt wird keine echte Reservierung - eine Function läuft nur Sekunden
const SCHUELER_FELDER = "id,owner,email:data->>email,firmenkunde:data->istFirmenkunde,firma_email:data->>firmaEmail,invoices:data->invoices,reminders:data->reminders";
const AUSGANG_FELDER = "id,art,bezug,an,status,created_at";

const KEIN_RECHT = "Über das Postfach der Fahrschule senden nur Fahrschul-Admin und Büro dieser Fahrschule.";
const KEIN_POSTFACH = "Kein Postfach verbunden – verbinde es im Autopilot unter Einstellungen.";
const NICHT_ERREICHBAR = "Die Daten sind gerade nicht erreichbar. Bitte versuch es gleich noch einmal.";
const WIRD_GESENDET = "Diese Nachricht wird gerade gesendet.";

// Beginn des heutigen Tages in Berlin als Zeitpunkt (wie berlinTagesbeginn in posteingang-ki.js)
function berlinTagesbeginn(jetzt) {
  const d = jetzt || new Date();
  const t = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(d).forEach((p) => { t[p.type] = p.value; });
  const alsUtc = Date.UTC(+t.year, +t.month - 1, +t.day, +t.hour, +t.minute, +t.second);
  const versatz = alsUtc - Math.floor(d.getTime() / 1000) * 1000;
  return new Date(Date.UTC(+t.year, +t.month - 1, +t.day) - versatz).toISOString();
}

// Kalenderdatum in Berlin (JJJJ-MM-TT), um tage Tage verschoben. Gerechnet wird über das Datum, nicht über
// Stunden - sonst landet „in drei Tagen“ bei der Zeitumstellung kurz nach Mitternacht einen Tag zu früh.
function berlinDatum(tage, jetzt) {
  const t = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(jetzt || new Date()).forEach((p) => { t[p.type] = p.value; });
  return new Date(Date.UTC(+t.year, +t.month - 1, +t.day + (tage || 0))).toISOString().slice(0, 10);
}

// Eingaben prüfen und vereinheitlichen. Liefert die Anfrage oder { fehler } (ein Satz für die Oberfläche).
function anfrageLesen(b) {
  const x = b && typeof b === "object" ? b : {};
  const art = x.art;
  if (art !== "erinnerung" && art !== "nachfassen")
    return { fehler: "Diese Art von Nachricht gibt es nicht. Möglich sind Zahlungserinnerung und Nachfassen." };
  const uuid = (v) => (typeof v === "string" && UUID.test(v.trim()) ? v.trim().toLowerCase() : "");
  const schluessel = uuid(x.schluessel);
  if (!schluessel)
    return { fehler: "Der Nachricht fehlt die Kennung. Bitte lade die Seite neu und versuch es noch einmal." };
  const betreff = (typeof x.betreff === "string" ? x.betreff : "").replace(/[\r\n]+/g, " ").trim();
  if (!betreff) return { fehler: "Bitte gib einen Betreff ein." };
  if (betreff.length > 200) return { fehler: "Der Betreff ist zu lang. Erlaubt sind höchstens 200 Zeichen." };
  const text = (typeof x.text === "string" ? x.text : "").replace(/\r\n?/g, "\n").trim();
  if (!text) return { fehler: "Die Nachricht ist leer." };
  if (text.length > 8000) return { fehler: "Die Nachricht ist zu lang. Erlaubt sind höchstens 8000 Zeichen." };
  if (/\[bitte ergänzen/i.test(text))
    return { fehler: "Im Text steht noch „[bitte ergänzen …]“. Ergänze die Stelle, bevor du sendest." };
  const a = { art, schluessel, betreff, text };
  if (art === "nachfassen") {
    a.interessent_id = uuid(x.interessent_id);
    if (!a.interessent_id) return { fehler: "Zu welchem Interessenten die Nachricht gehört, fehlt in der Anfrage." };
    return a;
  }
  a.student_id = uuid(x.student_id);
  if (!a.student_id) return { fehler: "Zu welchem Schüler die Erinnerung gehört, fehlt in der Anfrage." };
  a.invoice_id = typeof x.invoice_id === "string" ? x.invoice_id.trim() : "";
  if (!/^[^\x00-\x1f]{1,100}$/.test(a.invoice_id)) return { fehler: "Zu welcher Rechnung die Erinnerung gehört, fehlt in der Anfrage." };
  if (!(Number.isInteger(x.stufe) && x.stufe >= 1 && x.stufe <= 3)) return { fehler: "Die Stufe der Erinnerung muss 1, 2 oder 3 sein." };
  a.stufe = x.stufe;
  // Gleiche Grenzen wie school_erinnerung_vermerken - sonst ginge die Mail raus und der Vermerk scheiterte
  if (!(typeof x.betrag === "number" && Number.isFinite(x.betrag) && x.betrag > 0 && x.betrag <= 100000))
    return { fehler: "Der offene Betrag fehlt oder ist ungültig." };
  a.betrag = Math.round(x.betrag * 100) / 100;
  return a;
}

// Nach dem Versand vermerken - mit dem Token des Nutzers. true = gespeichert.
async function vermerken(token, a, ziel, schule) {
  try {
    if (a.art === "erinnerung")
      return (await rpcAlsBenutzer(token, "school_erinnerung_vermerken", {
        p_student_id: a.student_id, p_invoice_id: a.invoice_id, p_stufe: a.stufe, p_kanal: "email", p_betrag: a.betrag })) != null;
    const felder = { follow_up_am: berlinDatum(3) };
    if (!ziel.status || ziel.status === "offen") felder.status = "kontaktiert";
    return (await rpcAlsBenutzer(token, "school_interessent_speichern", {
      p_school_id: schule, p_id: a.interessent_id, p_owner: null, p_felder: felder })) != null;
  }
  catch (e) {
    return false;
  }
}

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
  const antwort = (statusCode, daten) => ({ statusCode, headers, body: JSON.stringify(daten) });
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return antwort(405, { error: "Nur POST ist erlaubt." });

  const token = ((event.headers && event.headers.authorization) || "").replace(/^Bearer\s+/i, "");
  const nutzer = await benutzerAusToken(token);
  if (!nutzer) return antwort(401, { error: "Du bist nicht angemeldet. Bitte melde dich neu an." });
  if (nutzer.id === DEMO_UID) return antwort(403, { error: "Im Demo-Modus wird nichts gesendet." });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return antwort(500, { error: "Das Senden ist gerade nicht eingerichtet." });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return antwort(400, { error: "Die Anfrage ließ sich nicht lesen. Bitte lade die Seite neu und versuch es noch einmal." }); }
  const a = anfrageLesen(body);
  if (a.fehler) return antwort(400, { error: a.fehler });
  const erinnerung = a.art === "erinnerung";
  const bezug = erinnerung ? a.student_id + ":" + a.invoice_id : a.interessent_id;
  const zentral = nutzer.id === ADMIN_UID;
  const db = dienst(serviceKey);

  // 1) Rechte: Fahrschul-Admin oder Büro der Fahrschule, zu der Schüler bzw. Interessent gehört
  //    (der zentrale Allindrive-Admin darf jede Fahrschule). Erst danach werden Schülerdaten gelesen.
  let ich, ziel, schule = null;
  try {
    ich = ((await db.lesen("profiles?id=eq." + encodeURIComponent(nutzer.id) + "&select=id,school_id,school_admin,school_office")) || [])[0];
    if (!zentral && !(ich && (ich.school_admin === true || ich.school_office === true)))
      return antwort(403, { error: KEIN_RECHT });
    ziel = ((await db.lesen(erinnerung
      ? "students?id=eq." + a.student_id + "&select=" + SCHUELER_FELDER
      : "interessenten?id=eq." + a.interessent_id + "&select=id,owner,email,status")) || [])[0];
    if (ziel && ziel.owner) {
      const besitzer = ich && ziel.owner === ich.id ? ich
        : ((await db.lesen("profiles?id=eq." + encodeURIComponent(ziel.owner) + "&select=school_id")) || [])[0];
      schule = (besitzer && besitzer.school_id) || null;
    }
  }
  catch (e) {
    return antwort(503, { error: NICHT_ERREICHBAR });
  }
  if (!ziel) return antwort(404, { error: erinnerung ? "Diesen Schüler gibt es nicht mehr." : "Diesen Interessenten gibt es nicht mehr." });
  if (!schule || !(zentral || ich.school_id === schule)) return antwort(403, { error: KEIN_RECHT });

  // 2) Gleicher Schlüssel schon da (zweiter Klick, Wiederholung nach einem Netzfehler)?
  const ausgang = "nachrichten_ausgang?school_id=eq." + schule + "&schluessel=eq." + a.schluessel + "&select=" + AUSGANG_FELDER;
  const vorhanden = (z) => {
    if (z.art !== a.art || z.bezug !== bezug)
      return antwort(409, { error: "Diese Kennung gehört schon zu einer anderen Nachricht. Bitte lade die Seite neu und versuch es noch einmal." });
    if (z.status === "gesendet") return antwort(200, { ok: true, schon: true, an: z.an });
    if (z.status === "reserviert")
      return antwort(409, { error: Date.now() - new Date(z.created_at).getTime() > HAENGT_NACH
        ? "Ob diese Nachricht rausging, ist unklar. Bitte sieh im Ordner „Gesendet“ des Postfachs nach, bevor du sie noch einmal schickst."
        : WIRD_GESENDET });
    return null; // "fehler": noch ein Versuch ist erlaubt
  };
  let alt;
  try { alt = ((await db.lesen(ausgang)) || [])[0]; }
  catch (e) { return antwort(503, { error: NICHT_ERREICHBAR }); }
  if (alt) {
    const r = vorhanden(alt);
    if (r) return r;
  }

  // 3) Empfänger aus den gespeicherten Daten - eine Adresse aus der Anfrage zählt nie
  let an, schonHeute = false;
  if (erinnerung) {
    const rechnung = (Array.isArray(ziel.invoices) ? ziel.invoices : []).find((r) => r && String(r.id) === a.invoice_id);
    if (!rechnung) return antwort(404, { error: "Diese Rechnung gibt es nicht mehr." });
    if (Object.prototype.hasOwnProperty.call(rechnung, "cancelledBy") || Object.prototype.hasOwnProperty.call(rechnung, "stornoOf"))
      return antwort(409, { error: "Diese Rechnung ist storniert. Dazu geht keine Zahlungserinnerung raus." });
    const heute = berlinDatum(0);
    schonHeute = (Array.isArray(ziel.reminders) ? ziel.reminders : []).some((r) => r && String(r.invoiceId) === a.invoice_id && r.date === heute);
    const firma = ziel.firmenkunde === true ? String(ziel.firma_email || "").trim() : "";
    an = firma || String(ziel.email || "").trim();
    if (!an) return antwort(400, { error: "Für diesen Schüler ist keine E-Mail-Adresse hinterlegt." });
    if (!emailGueltig(an))
      return antwort(400, { error: firma
        ? "Die Rechnungs-E-Mail der Firma ist ungültig. Bitte korrigiere sie in den Schülerdaten unter „Firmenkunde“."
        : "Die E-Mail-Adresse dieses Schülers ist ungültig. Bitte korrigiere sie in den Schülerdaten." });
  }
  else {
    an = String(ziel.email || "").trim();
    if (!an) return antwort(400, { error: "Für diesen Interessenten ist keine E-Mail-Adresse hinterlegt." });
    if (!emailGueltig(an)) return antwort(400, { error: "Die E-Mail-Adresse dieses Interessenten ist ungültig. Bitte korrigiere sie beim Interessenten." });
  }

  // 4) Postfach der Fahrschule, Grenzen, Passwort aus dem Tresor
  let pf, heuteGesendet, letzteMinute, passwort;
  try {
    pf = ((await db.lesen("postfaecher?school_id=eq." + schule + "&select=*")) || [])[0];
    if (!pf) return antwort(409, { error: KEIN_POSTFACH });
    [heuteGesendet, letzteMinute] = await Promise.all([
      db.zaehlen("nachrichten_ausgang?school_id=eq." + schule + "&status=eq.gesendet&created_at=gte." + encodeURIComponent(berlinTagesbeginn())),
      db.zaehlen("nachrichten_ausgang?school_id=eq." + schule + "&gesendet_von=eq." + encodeURIComponent(nutzer.id)
        + "&created_at=gte." + encodeURIComponent(new Date(Date.now() - 60000).toISOString())),
    ]);
    if (heuteGesendet >= TAGESLIMIT)
      return antwort(429, { error: "Heute sind schon " + TAGESLIMIT + " Nachrichten über das Postfach der Fahrschule rausgegangen. Weitere gehen erst morgen wieder." });
    if (letzteMinute >= MINUTENLIMIT)
      return antwort(429, { error: "Du hast in der letzten Minute schon " + MINUTENLIMIT + " Nachrichten gesendet. Bitte warte einen Moment und versuch es dann noch einmal." });
    passwort = await db.rpc("postfach_passwort", { p_postfach: pf.id });
  }
  catch (e) {
    return antwort(503, { error: NICHT_ERREICHBAR });
  }
  if (!passwort) return antwort(409, { error: KEIN_POSTFACH });

  // 5) Reservieren: neue Zeile, oder nach einem Fehler dieselbe Zeile wieder - beides nur einmal möglich.
  //    Ein neuer Versuch zählt mit neuem Zeitpunkt, damit die Grenzen auch für Wiederholungen gelten.
  const zeile = { an, betreff: a.betreff, gesendet_von: nutzer.id, status: "reserviert", fehler: null };
  let id = null;
  try {
    const r = alt
      ? await db.aendern("nachrichten_ausgang", "id=eq." + alt.id + "&status=eq.fehler", { ...zeile, created_at: new Date().toISOString() }, true)
      : await db.einfuegen("nachrichten_ausgang", { school_id: schule, art: a.art, schluessel: a.schluessel, bezug, ...zeile });
    id = Array.isArray(r) && r[0] ? r[0].id : null;
  }
  catch (e) {
    if (!(e && e.status === 409)) return antwort(503, { error: NICHT_ERREICHBAR });
  }
  if (!id) {
    // Ein zweiter Klick war schneller - dessen Stand gilt
    let stand = null;
    try { stand = ((await db.lesen(ausgang)) || [])[0]; } catch (e) { }
    return (stand && vorhanden(stand)) || antwort(409, { error: WIRD_GESENDET });
  }

  // 6) Senden. Direkt nach dem SMTP-Erfolg (vor der Kopie in „Gesendet“): Versand festhalten, dann vermerken.
  //    Scheitert danach etwas, ist die Mail trotzdem raus - der Schlüssel steht auf „gesendet“ bzw. bleibt
  //    reserviert, und nichts geht ein zweites Mal raus.
  let vermerk = false;
  try {
    await nachrichtSenden(pf, passwort, {
      an, betreff: a.betreff, text: a.text,
      gesendet: async () => {
        try { await db.aendern("nachrichten_ausgang", "id=eq." + id, { status: "gesendet" }); }
        catch (e) { console.error("nachricht-senden: Ausgang nicht als gesendet markiert (" + (e && e.status) + ")"); }
        vermerk = await vermerken(token, a, ziel, schule);
      },
    });
  }
  catch (e) {
    const grund = e && e.eigen ? e.message : "Das Senden ist fehlgeschlagen.";
    try { await db.aendern("nachrichten_ausgang", "id=eq." + id, { status: "fehler", fehler: grund }); }
    catch (e2) { console.error("nachricht-senden: Fehler nicht vermerkt (" + (e2 && e2.status) + ")"); }
    return antwort(502, { error: "Die Nachricht ging nicht raus. " + grund });
  }

  if (vermerk) return antwort(200, { ok: true, an, vermerk: true });
  const hinweis = !erinnerung
    ? "Die E-Mail ist raus. Status und nächster Kontakt ließen sich aber nicht speichern – bitte trag beides beim Interessenten von Hand ein."
    : schonHeute
      ? "Die E-Mail ist raus. Im Erinnerungs-Protokoll steht für heute schon eine Erinnerung zu dieser Rechnung, deshalb wurde diese nicht zusätzlich vermerkt."
      : "Die E-Mail ist raus, steht aber noch nicht im Erinnerungs-Protokoll. Bitte vermerke sie bei der Rechnung von Hand (Weg: E-Mail).";
  return antwort(200, { ok: true, an, vermerk: false, hinweis });
};

exports.berlinDatum = berlinDatum;
exports.berlinTagesbeginn = berlinTagesbeginn;
