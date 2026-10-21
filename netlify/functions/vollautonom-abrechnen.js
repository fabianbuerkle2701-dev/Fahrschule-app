// Netlify Function: Vollautonom „Jeden Monat selbst abrechnen“ (Allindrive Autopilot, Fabian 21.10.2026).
// Aufruf stündlich durch den pg_cron-Job "vollautonom-abrechnen" (nur wenn eine Fahrschule den Schalter hat), mit
// x-cron-secret. Abgerechnet wird in der ersten Woche des Monats werktags von 9 bis 15 Uhr Berliner Zeit.
// Je Fahrschule geprüft: Paket Vollautonom, Schalter „abrechnen“, KI und Bereich Rechnungen an, vollständige
// Rechnungsdaten (Name, Anschrift, Steuernummer oder USt-IdNr.) und ein verbundenes Postfach.
// Je Schüler höchstens eine Rechnung im Monat, über die Leistungen bis zum Ende des Vormonats: dieselben Zeilen wie
// „Abrechnen“ im Autopilot (lib/abrechnung.js), aber nur Fahrstunden vor dem 1., dazu offene Posten. Vorsichtiger als
// von Hand: nicht für archivierte Schüler und Firmenkunden, nur mit gültiger E-Mail, nur zwischen 1 und 2.000 €.
// Ablauf je Schüler: im Ausgang reservieren (ein Schlüssel je Schüler und Monat) → Rechnung anlegen (create_invoice,
// Schul-Weg) → PDF → per E-Mail senden. Geht das Senden schief, ist die Rechnung trotzdem da; sie steht im Ausgang
// als Fehler und wird nicht noch einmal automatisch geschickt (lieber gar nicht als doppelt).

const crypto = require("crypto");
const { dienst } = require("./lib/dienst");
const { antwortSenden, emailGueltig } = require("./lib/postfach");
const { autonomieAn } = require("./lib/pakete");
const R = require("./lib/rechnungen");
const A = require("./lib/abrechnung");
const { rechnungPdf, darstellbar } = require("./lib/rechnung-pdf");
const M = require("./lib/rechnung-mail");

const MAX_JE_SCHULE = 15;
const MIN_BETRAG = 1;
const MAX_BETRAG = 2000;
const RESTZEIT_MS = 7000;
const uhr = { jetzt: () => new Date() };

function restzeit(context) {
  return context && typeof context.getRemainingTimeInMillis === "function" ? Number(context.getRemainingTimeInMillis()) : 25000;
}
function berlin(jetzt) {
  const t = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short", hourCycle: "h23" })
    .formatToParts(jetzt).forEach((p) => { t[p.type] = p.value; });
  const alsUtc = Date.UTC(+t.year, +t.month - 1, +t.day, +t.hour, +t.minute, +t.second);
  const versatz = alsUtc - Math.floor(jetzt.getTime() / 1000) * 1000;
  return {
    datum: t.year + "-" + t.month + "-" + t.day, tag: +t.day, stunde: +t.hour, monat: t.year + "-" + t.month,
    werktag: ["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(t.weekday) >= 0,
    monatsbeginn: new Date(Date.UTC(+t.year, +t.month - 1, 1) - versatz).toISOString(),
  };
}
// In der ersten Woche des Monats, werktags 9–15 Uhr (Berlin)
function abrechnungszeit(jetzt) {
  const b = berlin(jetzt);
  return b.werktag && b.tag <= 7 && b.stunde >= 9 && b.stunde < 15;
}
function kiAus(schule) {
  const b = Array.isArray(schule && schule.bereiche_aus) ? schule.bereiche_aus : [];
  return !!(schule && schule.ki_aus === true) || b.indexOf("ki") >= 0 || b.indexOf("rechnungen") >= 0;
}
// § 14 UStG: Name und Anschrift der Fahrschule und Steuernummer oder USt-IdNr.
function rechnungsdatenVollstaendig(schule) {
  const iv = (schule && schule.invoice_settings) || {};
  return !!((iv.firma || schule.name) && iv.strasse && iv.plzOrt && (iv.steuernummer || iv.ustId))
    && [iv.firma || schule.name, iv.strasse, iv.plzOrt, iv.steuernummer, iv.ustId, iv.iban, iv.hinweis].every(darstellbar);
}
function abrSchueler(k) {
  return { drivenLessons: k.lessons || [], costItems: k.cost_items || [], packages: k.packages || [], invoices: k.invoices || [], abrechnungsModell: k.abrechnungs_modell };
}
// Was dieser Schüler diesen Monat in Rechnung bekäme. Fahrstunden ab dem 1. fallen heraus; abgerechnete bleiben drin,
// damit die Paket-Anrechnung der früheren genau wie im Autopilot läuft (sie geht nach Datum).
function monatsEntwurf(k, schule, monatsanfang) {
  const abr = abrSchueler(k);
  const vorher = { ...abr, drivenLessons: abr.drivenLessons.filter((l) => l && (l.invoiced || (/^\d{4}-\d{2}-\d{2}/.test(String(l.date || "")) && String(l.date).slice(0, 10) < monatsanfang))) };
  const preis = Number(schule.price_hour) || 0;
  const zeilen = A.rechnungsEntwurfZeilen(vorher, preis, ((schule.invoice_settings || {}).abrechnungsModell), true);
  const summe = Math.round(zeilen.reduce((x, z) => x + (Number(z.amount) || 0), 0) * 100) / 100;
  return { vorher, preis, zeilen, summe };
}
function kandidat(k, entwurf) {
  if (k.archiviert || k.firma) return false;
  if (!emailGueltig(String(k.email || "").trim())) return false;
  if (entwurf.zeilen.some((z) => z.kind === "cost" && !z.id)) return false; // alte Posten ohne Kennung: der Mensch
  // Name, Anschrift und Posten müssen sich im PDF zeigen lassen (sonst stünde dort „?“)
  if (![k.vorname, k.name, k.anschrift, ...entwurf.zeilen.map((z) => z.label)].every(darstellbar)) return false;
  return entwurf.summe >= MIN_BETRAG && entwurf.summe <= MAX_BETRAG;
}
function schluesselFuer(studentId, monat) {
  const h = crypto.createHash("sha256").update("vollautonom-rechnung:" + studentId + ":" + monat).digest("hex");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-8" + h.slice(17, 20) + "-" + h.slice(20, 32);
}

async function schuleBearbeiten(db, schule, b, context, protokoll) {
  if (!rechnungsdatenVollstaendig(schule)) return "rechnungsdaten_fehlen";
  const pf = ((await db.lesen("postfaecher?school_id=eq." + schule.id + "&select=*")) || [])[0];
  if (!pf || !pf.aktiv || pf.letzter_fehler) return "kein_postfach";
  const konten = R.kontenAus(await db.rpc("school_rechnungen", { p_school_id: schule.id }));
  const monatsanfang = b.monat + "-01";
  const liste = konten.map((k) => ({ k, e: monatsEntwurf(k, schule, monatsanfang) })).filter((x) => kandidat(x.k, x.e));
  if (!liste.length) return "nichts";
  // Wer diesen Monat schon eine automatische Rechnung hat (auch eine, die nicht rausging), bekommt keine zweite.
  // Nur ein Versuch, bei dem gar keine Rechnung entstand, zählt nicht – der wird im nächsten Lauf wiederholt.
  const schon = new Set(((await db.lesen("nachrichten_ausgang?school_id=eq." + schule.id + "&art=eq.rechnung&created_at=gte." + encodeURIComponent(b.monatsbeginn) + "&select=bezug,status,fehler")) || [])
    .filter((z) => z.status !== "fehler" || /^Rechnung RE-/.test(String(z.fehler || "")))
    .map((z) => String(z.bezug || "").split(":")[0]));
  const passwort = await db.rpc("postfach_passwort", { p_postfach: pf.id });
  if (!passwort) return "kein_postfach";
  const faellig = R.faelligAm({ date: b.datum }, R.zahlungsziel(schule));
  let n = 0;
  for (const { k, e } of liste) {
    if (n >= MAX_JE_SCHULE || restzeit(context) < RESTZEIT_MS) break;
    if (schon.has(k.student_id)) continue;
    const an = String(k.email).trim();
    // 1) reservieren – ein Schlüssel je Schüler und Monat
    let ausgang = null;
    try {
      const r = await db.einfuegen("nachrichten_ausgang", { school_id: schule.id, art: "rechnung", schluessel: schluesselFuer(k.student_id, b.monat), bezug: k.student_id + ":" + b.monat,
        an, betreff: "Rechnung " + b.monat, gesendet_von: null, status: "reserviert", fehler: null }, true);
      ausgang = Array.isArray(r) && r[0] ? r[0].id : null;
    } catch (err) {
      ausgang = null;
    }
    if (!ausgang) continue;
    // 2) Rechnung anlegen (die Datenbank lehnt schon Abgerechnetes ab)
    const lessonIds = [];
    e.zeilen.filter((z) => z.kind === "lessongroup").forEach((z) => (z.ids || []).forEach((id) => lessonIds.push(id)));
    let rechnung;
    try {
      rechnung = await db.rpc("create_invoice", {
        p_student_id: k.student_id, p_school_id: schule.id, p_items: A.rechnungsPostenAusZeilen(e.zeilen), p_lesson_ids: lessonIds,
        p_cost_ids: e.zeilen.filter((z) => z.kind === "cost").map((z) => z.id), p_note: "",
        p_lesson_extra: A.rechnungsSchnappschuss(e.vorher, e.preis, lessonIds), p_faellig: faellig, p_schulweg: true,
      });
    } catch (err) {
      // Nichts angelegt: den Schlüssel freigeben, damit der nächste Lauf es noch einmal versucht
      try { await db.aendern("nachrichten_ausgang", "id=eq." + ausgang, { status: "fehler", fehler: "Rechnung ließ sich nicht anlegen.", schluessel: crypto.randomUUID() }); } catch (e2) { /* egal */ }
      console.error("vollautonom-abrechnen: Rechnung nicht angelegt (" + ((err && err.status) || "Fehler") + ")");
      continue;
    }
    n++;
    const betreff = M.betreff(rechnung, schule);
    // Ab jetzt gehört der Eintrag zur Rechnung (so findet „Per E-Mail senden“ im Autopilot ihn wieder)
    try { await db.aendern("nachrichten_ausgang", "id=eq." + ausgang, { betreff, bezug: k.student_id + ":" + rechnung.id }); } catch (e2) { /* egal */ }
    // 3) PDF und Mail – mit dem frischen Stand (umgebuchte Zahlungen und Guthaben zählen schon)
    try {
      const frisch = ((await db.lesen("students?id=eq." + k.student_id + "&select=invoices:data->invoices,payments:data->payments,lessons:data->drivenLessons")) || [])[0] || {};
      const konto = R.kontenAus([{ ...k, invoices: frisch.invoices || [...k.invoices, rechnung], payments: frisch.payments || k.payments, lessons: frisch.lessons || k.lessons }])[0];
      const offen = Math.max(0, Math.round(((Number(rechnung.total) || 0) - (R.angerechnet(konto)[rechnung.id] || 0)) * 100) / 100);
      const pdf = await rechnungPdf({ schule, konto, rechnung, offen, erstelltAm: b.datum });
      const zeitraum = A.rechnungsLeistungszeitraum(abrSchueler(konto), rechnung);
      await antwortSenden(pf, passwort, {
        an, betreff, text: M.text({ konto, schule, rechnung, offen, zeitraum, automatisch: true }), erzeugt: true,
        anhaenge: [{ name: M.dateiname(rechnung), daten: pdf, typ: "application/pdf" }],
        gesendet: async () => {
          try { await db.aendern("nachrichten_ausgang", "id=eq." + ausgang, { status: "gesendet" }); }
          catch (e2) { console.error("vollautonom-abrechnen: Ausgang nicht als gesendet markiert"); }
        },
      });
      protokoll.push({ schule: schule.id, nummer: rechnung.number, gesendet: true });
    } catch (err) {
      const grund = err && err.eigen ? err.message : "Das Senden ist fehlgeschlagen.";
      try { await db.aendern("nachrichten_ausgang", "id=eq." + ausgang, { status: "fehler", fehler: "Rechnung " + rechnung.number + " erstellt, aber nicht verschickt: " + grund }); } catch (e2) { /* egal */ }
      protokoll.push({ schule: schule.id, nummer: rechnung.number, gesendet: false });
      if (err && err.eigen) return "senden_fehler"; // Postfach-Problem: bei dieser Fahrschule nicht weiter
    }
  }
  return n ? "abgerechnet" : "nichts";
}

exports.handler = async function (event, context) {
  const headers = { "Content-Type": "application/json" };
  const antwort = (statusCode, daten) => ({ statusCode, headers, body: JSON.stringify(daten) });
  if (event.httpMethod !== "POST") return antwort(405, { error: "Nur POST erlaubt" });
  const secret = process.env.CRON_SECRET;
  if (!secret || (event.headers && event.headers["x-cron-secret"]) !== secret) return antwort(401, { error: "Nicht autorisiert" });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return antwort(500, { error: "Nicht eingerichtet." });
  const jetzt = uhr.jetzt();
  if (!abrechnungszeit(jetzt)) return antwort(200, { ruhe: true });
  const b = berlin(jetzt);
  const db = dienst(serviceKey);
  let schulen;
  try {
    schulen = (await db.lesen("schools?autopilot_paket=eq.vollautonom&select=id,name,invoice_settings,price_hour,zahlungsziel_tage,ki_aus,bereiche_aus,autopilot_paket,autopilot_paket_bis,ki_autonomie")) || [];
  } catch (e) {
    return antwort(503, { error: "Fahrschulen nicht lesbar" });
  }
  const ergebnis = {};
  const protokoll = [];
  for (const schule of schulen) {
    if (restzeit(context) < RESTZEIT_MS) break;
    if (!autonomieAn(schule, "abrechnen", jetzt.getTime()) || kiAus(schule)) continue;
    try {
      ergebnis[schule.id] = await schuleBearbeiten(db, schule, b, context, protokoll);
    } catch (e) {
      console.error("vollautonom-abrechnen: " + ((e && e.status) || "Fehler"));
      ergebnis[schule.id] = "fehler";
    }
  }
  return antwort(200, { rechnungen: protokoll.length, ergebnis });
};

exports.uhr = uhr;
exports.abrechnungszeit = abrechnungszeit;
exports.monatsEntwurf = monatsEntwurf;
exports.kandidat = kandidat;
exports.rechnungsdatenVollstaendig = rechnungsdatenVollstaendig;
