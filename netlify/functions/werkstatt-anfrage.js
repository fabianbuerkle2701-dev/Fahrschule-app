// Netlify Function: Termin bei der Werkstatt ausmachen (Allindrive Autopilot, Fabian 21.10.2026). Admin und Büro.
// Teil des KI-Pakets (Teilautonom und Vollautonom); ohne Paket oder mit ausgeschalteter KI gibt es sie nicht.
//  - aktion "vorschau": Anfrage-Entwurf mit drei freien Zeiten des Fahrzeugs (die Werkstatt hat der Admin hinterlegt)
//  - aktion "senden":   den (bearbeiteten) Entwurf über das Postfach der Fahrschule an die Werkstatt schicken
//  - aktion "eintragen": den Termin ins Fahrzeug-Kalender eintragen (RPC werkstatt_termin_eintragen mit dem Token des
//    Nutzers – nur, wenn das Fahrzeug frei ist) und auf Wunsch der Werkstatt kurz bestätigen
// Die Empfänger-Adresse kommt immer aus der hinterlegten Werkstatt, nie aus der Anfrage.

const { dienst, benutzerAusToken, rpcAlsBenutzerMitMeldung } = require("./lib/dienst");
const { antwortSenden } = require("./lib/postfach");
const { paketGilt } = require("./lib/pakete");
const W = require("./lib/werkstatt");
const N = require("./lib/werkstatt-netz");

const ADMIN_UID = "96530a9f-28ae-4ac6-9cfa-26de392ecf05";
const DEMO_UID = "114d1f0a-9947-459d-8009-06282799ca44";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHUL_FELDER = "id,name,invoice_settings,locations,vehicles,ki_aus,bereiche_aus,autopilot_paket,autopilot_paket_bis,ki_autonomie";
const NICHT_ERREICHBAR = "Die Daten sind gerade nicht erreichbar. Bitte versuch es gleich noch einmal.";

function vorschlaegeLesen(x) {
  return (Array.isArray(x) ? x : []).slice(0, 5).filter((z) => z && !isNaN(Date.parse(z.start)) && !isNaN(Date.parse(z.ende)) && Date.parse(z.ende) > Date.parse(z.start))
    .map((z) => ({ start: new Date(z.start).toISOString(), ende: new Date(z.ende).toISOString() }));
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
  if (!serviceKey) return antwort(500, { error: "Das ist gerade nicht eingerichtet." });
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return antwort(400, { error: "Die Anfrage ließ sich nicht lesen." }); }

  const db = dienst(serviceKey);
  let ich, schule;
  try {
    ich = ((await db.lesen("profiles?id=eq." + encodeURIComponent(nutzer.id) + "&select=id,school_id,school_admin,school_office")) || [])[0];
    if (ich && ich.school_id) schule = ((await db.lesen("schools?id=eq." + ich.school_id + "&select=" + SCHUL_FELDER)) || [])[0];
  } catch (e) {
    return antwort(503, { error: NICHT_ERREICHBAR });
  }
  if (!ich || !schule || !(ich.school_admin === true || ich.school_office === true || nutzer.id === ADMIN_UID))
    return antwort(403, { error: "Termine bei der Werkstatt machen Fahrschul-Admin und Büro aus." });
  if (N.kiAus(schule)) return antwort(403, { error: "Die KI ist für deine Fahrschule ausgeschaltet." });
  if (!paketGilt(schule)) return antwort(402, { error: "Termine bei der Werkstatt macht die KI mit einem KI-Paket aus." });

  const aktion = body.aktion;
  if (aktion === "vorschau" || aktion === "senden") {
    const fahrzeugId = String(body.fahrzeug_id || "").slice(0, 80);
    const anlass = body.anlass === "hu" || body.anlass === "service" ? body.anlass : "";
    if (!fahrzeugId || !anlass) return antwort(400, { error: "Fahrzeug oder Anlass fehlt." });
    let v;
    try { v = await N.vorbereiten(db, schule, fahrzeugId, anlass); }
    catch (e) { return antwort(503, { error: NICHT_ERREICHBAR }); }
    if (v.fehler) return antwort(409, { error: v.fehler });
    if (aktion === "vorschau") return antwort(200, { an: v.an, betreff: v.betreff, text: v.text, vorschlaege: v.vorschlaege, werkstatt: v.werkstatt.name });

    const betreff = String(body.betreff || "").replace(/[\r\n]+/g, " ").trim();
    const text = String(body.text || "").replace(/\r\n?/g, "\n").trim();
    if (!betreff || betreff.length > 200) return antwort(400, { error: "Bitte einen Betreff mit höchstens 200 Zeichen." });
    if (!text || text.length > 4000) return antwort(400, { error: "Die Nachricht ist leer oder zu lang (höchstens 4000 Zeichen)." });
    if (/\[bitte ergänzen/i.test(text)) return antwort(400, { error: "Im Text steht noch „[bitte ergänzen …]“." });
    let pf, passwort;
    try {
      pf = ((await db.lesen("postfaecher?school_id=eq." + schule.id + "&select=*")) || [])[0];
      if (pf) passwort = await db.rpc("postfach_passwort", { p_postfach: pf.id });
    } catch (e) {
      return antwort(503, { error: NICHT_ERREICHBAR });
    }
    if (!pf || !passwort) return antwort(409, { error: "Kein Postfach verbunden – verbinde es im Autopilot unter Einstellungen." });
    try {
      const r = await N.senden(db, { schule, pf, passwort, fahrzeug: v.fahrzeug, werkstatt: v.werkstatt, anlass, an: v.an, betreff, text,
        vorschlaege: vorschlaegeLesen(body.vorschlaege), erstelltVon: nutzer.id, vonKi: false });
      if (r.schon) return antwort(409, { error: "Für dieses Fahrzeug ist schon eine Anfrage an die Werkstatt offen." });
      return antwort(200, { ok: true, anfrage: { id: r.anfrage.id, status: r.anfrage.status, an: v.an } });
    } catch (e) {
      return antwort(502, { error: "Die Anfrage ging nicht raus. " + (e && e.eigen ? e.message : "Das Senden ist fehlgeschlagen.") });
    }
  }

  if (aktion === "eintragen") {
    const id = String(body.anfrage_id || "");
    if (!UUID.test(id) || isNaN(Date.parse(body.start)) || isNaN(Date.parse(body.ende))) return antwort(400, { error: "Termin oder Anfrage fehlt." });
    const start = new Date(body.start).toISOString(), ende = new Date(body.ende).toISOString();
    let a;
    try { a = ((await db.lesen("werkstatt_anfragen?id=eq." + id + "&school_id=eq." + schule.id + "&select=*")) || [])[0]; }
    catch (e) { return antwort(503, { error: NICHT_ERREICHBAR }); }
    if (!a) return antwort(404, { error: "Diese Anfrage gibt es nicht mehr." });
    let r;
    try { r = await rpcAlsBenutzerMitMeldung(token, "werkstatt_termin_eintragen", { p_anfrage: id, p_start: start, p_ende: ende }); }
    catch (e) { return antwort(503, { error: NICHT_ERREICHBAR }); }
    if (!r.ok) return antwort(409, { error: r.meldung && r.status < 500 ? r.meldung : "Der Termin ließ sich nicht eintragen." });
    // Auf Wunsch der Werkstatt bestätigen – als Antwort auf ihre Mail, sonst neu an die Werkstatt
    let bestaetigt = false;
    if (body.bestaetigen === true) {
      try {
        const [pf, mail, werkstatt] = await Promise.all([
          db.lesen("postfaecher?school_id=eq." + schule.id + "&select=*").then((x) => (x || [])[0]),
          a.antwort_mail_id ? db.lesen("posteingang?id=eq." + a.antwort_mail_id + "&select=message_id,referenzen,betreff").then((x) => (x || [])[0]) : Promise.resolve(null),
          a.werkstatt_id ? db.lesen("fahrzeug_werkstaetten?id=eq." + a.werkstatt_id + "&select=*").then((x) => (x || [])[0]) : Promise.resolve(null),
        ]);
        const passwort = pf ? await db.rpc("postfach_passwort", { p_postfach: pf.id }) : null;
        if (pf && passwort) {
          await antwortSenden(pf, passwort, {
            an: a.an, betreff: mail && mail.betreff ? (/^re:/i.test(mail.betreff) ? mail.betreff : "Re: " + mail.betreff) : "Termin bestätigt · " + a.betreff,
            text: W.bestaetigungText({ schule, werkstatt, fahrzeug: N.fahrzeugAus(schule, a.fahrzeug_id) || { name: "" }, start, ende }),
            antwortAuf: mail ? mail.message_id : a.message_id || undefined, referenzen: mail ? mail.referenzen : undefined, automatisch: false,
          });
          bestaetigt = true;
        }
      } catch (e) {
        console.error("werkstatt-anfrage: Bestätigung nicht gesendet");
      }
    }
    return antwort(200, { ok: true, bestaetigt });
  }
  return antwort(400, { error: "Unbekannte Aktion." });
};
