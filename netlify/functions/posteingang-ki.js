// Netlify Function: Die KI bearbeitet den Posteingang (KI-Verwaltung, v2.126.0).
// Aufruf jede Minute durch den pg_cron-Job "posteingang-ki" (nur wenn etwas wartet), mit
// x-cron-secret wie die Push-Jobs. Je Lauf bis zu drei Einträge, einzeln reserviert über
// posteingang_naechster (zählt versuche hoch; nach drei Versuchen legt die App die Mail vor):
//  - status neu: Gesundheitsangaben, ausgeschaltete KI und Schulen ohne KI-Paket gehen ohne KI an den Admin. Sonst ordnet
//    Claude die Mail ein und schreibt einen Entwurf (feste JSON-Form, lib/posteingang.js SCHEMA).
//    Was damit passiert, entscheidet allein entscheiden() - nie die KI. Neue Interessenten legt
//    die Function an (Herkunft E-Mail), wenn die Regel dafür an ist.
//  - status zu_senden: nur noch senden (mit KI-Hinweis), danach beantwortet_ki.
// Doppelt senden ist schlimmer als gar nicht: Wurde ein Sendeversuch unterbrochen, ohne dass klar
// ist, ob die Mail raus ist, geht sie an den Admin statt ein zweites Mal an den Absender.
// Schülernamen werden nur zum Vergleich mit dem Absender gelesen und gehen nie an die KI.

const Anthropic = require("@anthropic-ai/sdk").default;
const { kiSignal } = require("./lib/ki-timeout");
const { dienst, APP_URL } = require("./lib/dienst");
const { antwortSenden } = require("./lib/postfach");
const P = require("./lib/posteingang");
const { PAKET_SPALTEN, paketGilt, autonomieAn } = require("./lib/pakete");

const MODELL = "claude-sonnet-5-5";
const MAX_JE_LAUF = 3;
const KI_RESTZEIT_MS = 8000;
const SENDEN_RESTZEIT_MS = 4000;

function restzeit(context) {
  return context && typeof context.getRemainingTimeInMillis === "function" ? Number(context.getRemainingTimeInMillis()) : 25000;
}
const SCHUL_FELDER = "name,subtitle,locations,klassen,price_hour,price_grundgebuehr,price_lehrmaterial,price_sonderfahrt,price_pruefungsvorstellung,packages,ki_steckbrief,ki_aus,bereiche_aus," + PAKET_SPALTEN;

// Beginn des heutigen Tages in Berlin als ISO-Zeit (für das Tageslimit des Autopiloten)
function berlinTagesbeginn(jetzt) {
  const d = jetzt || new Date();
  const t = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(d).forEach((p) => { t[p.type] = p.value; });
  const alsUtc = Date.UTC(+t.year, +t.month - 1, +t.day, +t.hour, +t.minute, +t.second);
  const versatz = alsUtc - Math.floor(d.getTime() / 1000) * 1000;
  return new Date(Date.UTC(+t.year, +t.month - 1, +t.day) - versatz).toISOString();
}

function kiAus(schule) {
  const b = Array.isArray(schule && schule.bereiche_aus) ? schule.bereiche_aus : [];
  return !!(schule && schule.ki_aus === true) || b.indexOf("ki") >= 0 || b.indexOf("posteingang") >= 0;
}

async function buchungsLink(db, pf, schule) {
  const b = Array.isArray(schule && schule.bereiche_aus) ? schule.bereiche_aus : [];
  if (!pf || !pf.verbunden_von || b.indexOf("anmeldung") >= 0) return "";
  const p = ((await db.lesen("profiles?id=eq." + pf.verbunden_von + "&select=booking_code")) || [])[0];
  return p && p.booking_code ? APP_URL + "/?buchen=" + encodeURIComponent(p.booking_code) : "";
}

// Der Eintrag ändert sich nur, solange er noch im erwarteten Status ist (der Admin kann ihn
// inzwischen selbst beantwortet oder erledigt haben). Liefert true, wenn er geändert wurde.
async function setzen(db, z, erwartet, daten) {
  const zeilen = await db.aendern("posteingang", "id=eq." + z.id + "&status=eq." + erwartet, { ...daten, updated_at: new Date().toISOString() }, true);
  return Array.isArray(zeilen) && zeilen.length > 0;
}

async function senden(db, z, pf, schule) {
  const aktionen = Array.isArray(z.aktionen) ? z.aktionen.slice() : [];
  const zeit = () => new Date().toISOString();
  const versucht = aktionen.filter((a) => a && a.art === "senden").length;
  const beendet = aktionen.filter((a) => a && (a.art === "senden_fehler" || a.art === "gesendet")).length;
  if (versucht > beendet) {
    await setzen(db, z, "zu_senden", { status: "braucht_dich", grund: "Das Senden wurde unterbrochen. Schau bitte im Ordner „Gesendet“ nach, ob die Antwort schon raus ist, bevor du sie noch einmal schickst.",
      aktionen: [...aktionen, { art: "vorgelegt", grund: "senden_unterbrochen", zeit: zeit() }] });
    return "unterbrochen";
  }
  if (!pf || !pf.aktiv) {
    await setzen(db, z, "zu_senden", { status: "braucht_dich", grund: P.OHNE_POSTFACH, aktionen: [...aktionen, { art: "vorgelegt", grund: "ohne_postfach", zeit: zeit() }] });
    return "ohne_postfach";
  }
  const passwort = await db.rpc("postfach_passwort", { p_postfach: pf.id });
  const mitVersuch = [...aktionen, { art: "senden", zeit: zeit() }];
  if (!passwort || !(await setzen(db, z, "zu_senden", { aktionen: mitVersuch }))) {
    if (!passwort)
      await setzen(db, z, "zu_senden", { status: "braucht_dich", grund: "Kein Passwort zum Postfach gespeichert – bitte das Postfach neu verbinden und die Antwort selbst senden." });
    return "nicht_gesendet";
  }
  const text = z.entwurf_text + P.kiHinweis(schule && schule.name);
  try {
    await antwortSenden(pf, passwort, {
      an: z.von_email, betreff: z.entwurf_betreff || P.antwortBetreff(z.betreff, ""), text,
      antwortAuf: /^uid:/.test(z.message_id || "") ? "" : z.message_id, referenzen: z.referenzen, automatisch: true,
      // sofort nach dem Senden vermerken (vor der Kopie in „Gesendet“)
      gesendet: () => setzen(db, z, "zu_senden", { status: "beantwortet_ki", antwort_text: text, gesendet_am: zeit(), gesendet_von: "ki", grund: "",
        aktionen: [...mitVersuch, { art: "gesendet", von: "ki", zeit: zeit() }] }),
    });
  } catch (e) {
    const endgueltig = (Number(z.versuche) || 0) >= 3;
    const grund = e && e.eigen ? e.message : "Senden fehlgeschlagen.";
    await setzen(db, z, "zu_senden", {
      ...(endgueltig ? { status: "braucht_dich", grund: "Automatisch senden ging nicht: " + grund + " Bitte selbst senden." } : {}),
      aktionen: [...mitVersuch, { art: "senden_fehler", grund, zeit: zeit() }],
    });
    return "senden_fehler";
  }
  return "gesendet";
}

async function interessentAnlegen(db, z, ki, pf, konten) {
  const i = ki.interessent || {};
  const owner = pf && pf.verbunden_von;
  if (!owner || !z.von_email || konten.indexOf(owner) < 0) return false;
  // Gibt es die Adresse in der Fahrschule schon, nicht noch einmal anlegen
  const da = await db.lesen("interessenten?owner=in.(" + konten.join(",") + ")&email=eq." + encodeURIComponent(z.von_email) + "&select=id&limit=1");
  if (Array.isArray(da) && da.length) return false;
  const teile = String(z.von_name || "").trim().split(/\s+/).filter(Boolean);
  const vorname = i.vorname || (teile.length > 1 ? teile.slice(0, -1).join(" ") : teile[0] || "");
  const name = i.name || (teile.length > 1 ? teile[teile.length - 1] : "");
  await db.einfuegen("interessenten", {
    owner, vorname: vorname.slice(0, 60), name: name.slice(0, 80), tel: i.telefon || null, klasse: i.klasse || null, email: z.von_email,
    quelle: "email", status: "offen", notiz: ("Per E-Mail: " + (i.wunsch || ki.zusammenfassung || z.betreff || "")).slice(0, 500),
  });
  return true;
}

async function bearbeiten(db, client, z, context) {
  const aktionen = Array.isArray(z.aktionen) ? z.aktionen.slice() : [];
  const zeit = () => new Date().toISOString();
  const pf = z.postfach_id ? ((await db.lesen("postfaecher?id=eq." + z.postfach_id + "&select=*")) || [])[0] : null;
  const schule = ((await db.lesen("schools?id=eq." + z.school_id + "&select=" + SCHUL_FELDER)) || [])[0] || {};

  if (z.status === "zu_senden") return senden(db, z, pf, schule);

  if (kiAus(schule)) {
    await setzen(db, z, "neu", { status: "braucht_dich", grund: "Die KI ist für deine Fahrschule ausgeschaltet – bitte selbst ansehen.", aktionen: [...aktionen, { art: "vorgelegt", grund: "ki_aus", zeit: zeit() }] });
    return "ki_aus";
  }
  // Die KI im Autopilot gibt es nur mit KI-Paket (Fabian 21.10.2026: Verwaltung frei, KI kostet) – ohne Paket
  // kommt die Mail wie bei ausgeschalteter KI ungelesen zum Admin
  if (!paketGilt(schule)) {
    await setzen(db, z, "neu", { status: "braucht_dich", grund: "Ohne KI-Paket liest die KI nicht mit – bitte selbst ansehen.", aktionen: [...aktionen, { art: "vorgelegt", grund: "kein_paket", zeit: zeit() }] });
    return "kein_paket";
  }
  if (P.enthaeltGesundheit(z.betreff + "\n" + z.text)) {
    const e = P.entscheiden({ gesundheit: true });
    await setzen(db, z, "neu", { status: e.status, grund: e.grund, aktionen: [...aktionen, { art: "vorgelegt", grund: "gesundheit", zeit: zeit() }] });
    return "gesundheit";
  }

  let ki = null;
  const fakten = P.faktenText(schule, await buchungsLink(db, pf, schule));
  try {
    const msg = await client.messages.create({
      model: MODELL,
      max_tokens: 3000,
      output_config: { effort: "low", format: { type: "json_schema", schema: P.SCHEMA } },
      system: P.SYSTEM,
      messages: [{ role: "user", content: P.nachricht(fakten, schule.ki_steckbrief, z) }],
    }, { signal: kiSignal(context) });
    if (msg.stop_reason === "refusal") {
      ki = null;
    } else {
      const block = (msg.content || []).find((b) => b && b.type === "text");
      ki = P.kiErgebnisPruefen(JSON.parse(block ? block.text : ""));
    }
    if (!ki && msg.stop_reason !== "refusal") throw new Error("leer");
  } catch (e) {
    // Vorübergehend (Zeit, Überlastung, abgeschnitten): der nächste Lauf versucht es noch einmal
    if ((Number(z.versuche) || 0) < 3) {
      if (e && e.status) console.error("posteingang-ki: Anthropic " + e.status);
      return "ki_fehler";
    }
    ki = null;
  }

  const konten = ((await db.lesen("profiles?school_id=eq." + z.school_id + "&select=id")) || []).map((p) => p.id).filter(Boolean);
  const schueler = ki && ki.kategorie === "interessent" && konten.length
    ? (await db.lesen("students?owner=in.(" + konten.join(",") + ")&select=vorname:data->>vorname,name:data->>name,email:data->>email,firmaEmail:data->>firmaEmail&limit=5000")) || []
    : [];
  const interessent = !!(ki && ki.kategorie === "interessent");
  // Vollautonom „Alle E-Mails selbst beantworten“: auch Schüler, Eltern, Rechnungsfragen (KI ist hier schon geprüft an)
  const alleMails = autonomieAn(schule, "mails_alle");
  const automatisch = !!(ki && P.automatischErlaubt(ki.kategorie, alleMails));
  const heute = automatisch
    ? await db.zaehlen("posteingang?school_id=eq." + z.school_id + "&status=eq.beantwortet_ki&gesendet_am=gte." + encodeURIComponent(berlinTagesbeginn()))
    : 0;
  // Schutz vor Schleifen und Missbrauch: höchstens zwei automatische Antworten je Absender in 24 Stunden
  const anAbsender = automatisch && z.von_email
    ? await db.zaehlen("posteingang?school_id=eq." + z.school_id + "&von_email=eq." + encodeURIComponent(z.von_email) + "&status=eq.beantwortet_ki&gesendet_am=gte." + encodeURIComponent(new Date(Date.now() - 86400000).toISOString()))
    : 0;
  const e = P.entscheiden({
    ki, regeln: pf && pf.regeln, absenderIstSchueler: P.istSchueler(z.von_name, schueler, z.von_email),
    alt: Date.now() - new Date(z.empfangen_am).getTime() > 72 * 3600000, ohnePostfach: !pf || !pf.aktiv, heuteAutomatisch: heute,
    unsicher: aktionen.some((a) => a && a.art === "abgeholt" && a.unsicher),
    fremdeLinks: ki ? P.fremdeLinks(ki.antwort, fakten + "\n" + (schule.ki_steckbrief || "")) : [],
    antwortenAnAbsender: anAbsender, alleMails,
  });
  // Rechnung an die Fahrschule mit Anhang: als Beleg für die Buchhaltung vormerken (Allindrive Autopilot).
  // Geholt und ausgelesen wird er von buchhaltung-ki.js; gebucht wird erst nach dem OK des Admins.
  const bAus = Array.isArray(schule.bereiche_aus) ? schule.bereiche_aus : [];
  const belegVormerken = !!(ki && ki.eingangsrechnung && Number(z.anhaenge) > 0 && z.imap_uid != null && pf && bAus.indexOf("ausgaben") < 0);
  const neu = {
    status: e.status, grund: belegVormerken && e.status === "info" ? "Rechnung erkannt – der Beleg liegt in der Buchhaltung zur Prüfung bereit." : e.grund,
    kategorie: ki ? ki.kategorie : "", zusammenfassung: ki ? ki.zusammenfassung : "",
    nur_admin: !!(z.nur_admin || P.nurAdmin({ kategorie: ki && ki.kategorie, vonEmail: z.von_email, betreff: z.betreff, text: z.text, regeln: pf && pf.regeln })),
    entwurf_betreff: ki && ki.antwort_noetig ? P.antwortBetreff(z.betreff, ki.betreff) : "",
    entwurf_text: ki && ki.antwort_noetig ? ki.antwort : "",
    aktionen: [...aktionen, { art: "ki", status: e.status, zeit: zeit(), ...(alleMails && e.status === "zu_senden" && !interessent ? { vollautonom: "mails_alle" } : {}) }],
  };
  if (!(await setzen(db, z, "neu", neu))) return "inzwischen_bearbeitet";

  if (belegVormerken) {
    try {
      await db.einfuegen("beleg_vorschlaege", { school_id: z.school_id, posteingang_id: z.id, quelle: "email", status: "holen" }, true);
    } catch (err) {
      if (!(err && err.status === 409)) console.error("posteingang-ki: Beleg " + (err && err.status));
    }
  }
  const regeln = { ...P.STANDARD_REGELN, ...((pf && pf.regeln) || {}) };
  if (ki && ki.kategorie === "interessent" && regeln.interessenten_anlegen !== false && e.status !== "spam") {
    try { await interessentAnlegen(db, z, ki, pf, konten); } catch (err) { console.error("posteingang-ki: Interessent " + (err && err.status)); }
  }
  // Senden nur, wenn die Zeit dieses Laufs sicher reicht - sonst übernimmt der nächste Lauf
  if (e.status !== "zu_senden" || restzeit(context) < SENDEN_RESTZEIT_MS) return e.status;
  return senden(db, { ...z, ...neu }, pf, schule);
}

exports.handler = async function (event, context) {
  const headers = { "Content-Type": "application/json" };
  const antwort = (statusCode, daten) => ({ statusCode, headers, body: JSON.stringify(daten) });
  if (event.httpMethod !== "POST") return antwort(405, { error: "Nur POST erlaubt" });
  const secret = process.env.CRON_SECRET;
  if (!secret || (event.headers && event.headers["x-cron-secret"]) !== secret) return antwort(401, { error: "Nicht autorisiert" });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!serviceKey || !apiKey) return antwort(500, { error: "Nicht eingerichtet." });
  const db = dienst(serviceKey);
  const client = new Anthropic({ apiKey, maxRetries: 0 });

  const ergebnis = [];
  for (let i = 0; i < MAX_JE_LAUF && restzeit(context) > KI_RESTZEIT_MS; i++) {
    let z;
    try {
      z = ((await db.rpc("posteingang_naechster", {})) || [])[0];
    } catch (e) {
      break;
    }
    if (!z) break;
    let e;
    try {
      e = await bearbeiten(db, client, z, context);
    } catch (err) {
      console.error("posteingang-ki: " + ((err && err.status) || "Fehler"));
      e = "fehler";
    }
    ergebnis.push(e);
    // Nach einem Fehler nicht gleich weiter: dieselbe Mail käme sofort wieder an die Reihe und
    // verbrauchte ihre drei Versuche in Sekunden (z. B. bei kurzer Überlastung). Der nächste Lauf
    // kommt in einer Minute.
    if (e === "ki_fehler" || e === "senden_fehler" || e === "fehler") break;
  }
  return antwort(200, { bearbeitet: ergebnis.length, ergebnis });
};

exports.berlinTagesbeginn = berlinTagesbeginn;
