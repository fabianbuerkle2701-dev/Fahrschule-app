// Netlify Function: Rechnung per E-Mail senden (Allindrive Autopilot, 21.10.2026). Admin und Büro, ohne KI-Paket
// (Verwaltung). Die Rechnung geht als PDF (dieselben Angaben wie die Druckansicht) über das Postfach der Fahrschule an
// den Schüler, bei Firmenkunden an die Rechnungs-E-Mail der Firma – die Adresse bestimmt immer der Server.
// Schutz vor Doppelversand wie nachricht-senden.js: ein Schlüssel je Klick in nachrichten_ausgang (art "rechnung",
// bezug Schüler:Rechnung); schon gesendet → ok ohne zweiten Versand. 100 Nachrichten je Fahrschule und Tag.

const { dienst, benutzerAusToken } = require("./lib/dienst");
const { antwortSenden } = require("./lib/postfach");
const R = require("./lib/rechnungen");
const A = require("./lib/abrechnung");
const M = require("./lib/rechnung-mail");
const { rechnungPdf } = require("./lib/rechnung-pdf");

const ADMIN_UID = "96530a9f-28ae-4ac6-9cfa-26de392ecf05";
const DEMO_UID = "114d1f0a-9947-459d-8009-06282799ca44";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAGESLIMIT = 100;
const NICHT_ERREICHBAR = "Die Daten sind gerade nicht erreichbar. Bitte versuch es gleich noch einmal.";

function berlinTagesbeginn(jetzt) {
  const d = jetzt || new Date();
  const t = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(d).forEach((p) => { t[p.type] = p.value; });
  const alsUtc = Date.UTC(+t.year, +t.month - 1, +t.day, +t.hour, +t.minute, +t.second);
  return new Date(Date.UTC(+t.year, +t.month - 1, +t.day) - (alsUtc - Math.floor(d.getTime() / 1000) * 1000)).toISOString();
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
  catch (e) { return antwort(400, { error: "Die Anfrage ließ sich nicht lesen." }); }
  const studentId = String(body.student_id || "").trim().toLowerCase();
  const invoiceId = typeof body.invoice_id === "string" ? body.invoice_id.trim() : "";
  const schluessel = String(body.schluessel || "").trim().toLowerCase();
  if (!UUID.test(studentId) || !/^[^\x00-\x1f]{1,100}$/.test(invoiceId) || !UUID.test(schluessel)) return antwort(400, { error: "Rechnung oder Kennung fehlt. Bitte lade die Seite neu." });

  const db = dienst(serviceKey);
  let ich, schule, konto, pf;
  try {
    ich = ((await db.lesen("profiles?id=eq." + encodeURIComponent(nutzer.id) + "&select=id,school_id,school_admin,school_office")) || [])[0];
    if (!(ich && ich.school_id && (ich.school_admin === true || ich.school_office === true || nutzer.id === ADMIN_UID)))
      return antwort(403, { error: "Rechnungen senden Fahrschul-Admin und Büro." });
    schule = ((await db.lesen("schools?id=eq." + ich.school_id + "&select=id,name,invoice_settings,zahlungsziel_tage")) || [])[0];
    konto = R.kontenAus(await db.rpc("school_rechnungen", { p_school_id: ich.school_id })).find((k) => k.student_id === studentId);
    pf = ((await db.lesen("postfaecher?school_id=eq." + ich.school_id + "&select=*")) || [])[0];
  } catch (e) {
    return antwort(503, { error: NICHT_ERREICHBAR });
  }
  if (!schule || !konto) return antwort(404, { error: "Diesen Schüler gibt es in deiner Fahrschule nicht." });
  const rechnung = konto.invoices.find((r) => String(r.id) === invoiceId);
  if (!rechnung) return antwort(404, { error: "Diese Rechnung gibt es nicht mehr." });
  const an = M.empfaenger(konto);
  if (!an) return antwort(400, { error: konto.firma ? "Für die Firma ist keine gültige Rechnungs-E-Mail hinterlegt." : "Für diesen Schüler ist keine gültige E-Mail-Adresse hinterlegt." });
  if (!pf || !pf.aktiv) return antwort(409, { error: "Kein Postfach verbunden – verbinde es im Autopilot unter Einstellungen." });

  const bezug = studentId + ":" + invoiceId;
  const ausgangPfad = "nachrichten_ausgang?school_id=eq." + schule.id + "&schluessel=eq." + schluessel + "&select=id,art,bezug,an,status";
  let alt, heute, passwort;
  try {
    alt = ((await db.lesen(ausgangPfad)) || [])[0];
    heute = await db.zaehlen("nachrichten_ausgang?school_id=eq." + schule.id + "&status=eq.gesendet&created_at=gte." + encodeURIComponent(berlinTagesbeginn()));
    passwort = await db.rpc("postfach_passwort", { p_postfach: pf.id });
  } catch (e) {
    return antwort(503, { error: NICHT_ERREICHBAR });
  }
  if (alt) {
    if (alt.art !== "rechnung" || alt.bezug !== bezug) return antwort(409, { error: "Diese Kennung gehört schon zu einer anderen Nachricht. Bitte lade die Seite neu." });
    if (alt.status === "gesendet") return antwort(200, { ok: true, schon: true, an: alt.an });
    if (alt.status === "reserviert") return antwort(409, { error: "Diese Rechnung wird gerade gesendet." });
  }
  if (heute >= TAGESLIMIT) return antwort(429, { error: "Heute sind schon " + TAGESLIMIT + " Nachrichten über das Postfach der Fahrschule rausgegangen. Weitere gehen erst morgen wieder." });
  if (!passwort) return antwort(409, { error: "Kein Postfach verbunden – verbinde es im Autopilot unter Einstellungen." });

  const betreff = M.betreff(rechnung, schule);
  let id = null;
  try {
    const r = alt
      ? await db.aendern("nachrichten_ausgang", "id=eq." + alt.id + "&status=eq.fehler", { an, betreff, status: "reserviert", fehler: null, gesendet_von: nutzer.id, created_at: new Date().toISOString() }, true)
      : await db.einfuegen("nachrichten_ausgang", { school_id: schule.id, art: "rechnung", schluessel, bezug, an, betreff, gesendet_von: nutzer.id, status: "reserviert" });
    id = Array.isArray(r) && r[0] ? r[0].id : null;
  } catch (e) {
    if (!(e && e.status === 409)) return antwort(503, { error: NICHT_ERREICHBAR });
  }
  if (!id) return antwort(409, { error: "Diese Rechnung wird gerade gesendet." });

  try {
    const offen = Math.max(0, Math.round(((Number(rechnung.total) || 0) - (R.angerechnet(konto)[rechnung.id] || 0)) * 100) / 100);
    const pdf = await rechnungPdf({ schule, konto, rechnung, offen });
    const zeitraum = A.rechnungsLeistungszeitraum({ drivenLessons: konto.lessons || [], invoices: konto.invoices }, rechnung);
    await antwortSenden(pf, passwort, {
      an, betreff, text: M.text({ konto, schule, rechnung, offen, zeitraum, automatisch: false }), automatisch: false,
      anhaenge: [{ name: M.dateiname(rechnung), daten: pdf, typ: "application/pdf" }],
      gesendet: async () => {
        try { await db.aendern("nachrichten_ausgang", "id=eq." + id, { status: "gesendet" }); }
        catch (e) { console.error("rechnung-senden: Ausgang nicht als gesendet markiert"); }
      },
    });
  } catch (e) {
    const grund = e && e.eigen ? e.message : "Das Senden ist fehlgeschlagen.";
    try { await db.aendern("nachrichten_ausgang", "id=eq." + id, { status: "fehler", fehler: grund }); } catch (e2) { /* egal */ }
    return antwort(502, { error: "Die Rechnung ging nicht raus. " + grund });
  }
  return antwort(200, { ok: true, an });
};
