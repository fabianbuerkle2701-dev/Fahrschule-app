// Allindrive Autopilot · KI-Buchhaltung: die zwei Arbeitsschritte eines Beleg-Vorschlags (mit Netz).
//   holen: den Rechnungs-Anhang einer Posteingang-Mail aus dem Postfach holen und im Speicher „belege“ ablegen
//   lesen: den abgelegten Beleg (PDF/Foto) von der KI auslesen lassen
// Genutzt vom Zeitjob buchhaltung-ki.js und von beleg-lesen.js (sofortiges Auslesen nach einem Upload).
// Beide Schritte ändern den Vorschlag nur, solange er noch im erwarteten Status ist.

const crypto = require("crypto");
const B = require("./buchhaltung");
const { mailAnhaenge } = require("./postfach");
const { kiSignal } = require("./ki-timeout");

const MODELL = "claude-sonnet-5-5";

async function setzen(db, v, erwartet, daten) {
  const zeilen = await db.aendern("beleg_vorschlaege", "id=eq." + v.id + "&status=eq." + erwartet, { ...daten, updated_at: new Date().toISOString() }, true);
  return Array.isArray(zeilen) && zeilen[0] ? zeilen[0] : null;
}
function endgueltig(v) {
  return (Number(v.versuche) || 0) >= 3;
}

// Schritt 1: Anhang holen. Liefert "gelesen-bereit" | "fehler" | "nochmal"
async function holen(db, v) {
  const mail = v.posteingang_id ? ((await db.lesen("posteingang?id=eq." + v.posteingang_id + "&select=postfach_id,imap_uid,imap_validity")) || [])[0] : null;
  if (!mail || mail.imap_uid == null) {
    await setzen(db, v, "holen", { status: "fehler", grund: "Die E-Mail zu diesem Beleg gibt es nicht mehr – bitte den Beleg selbst hochladen." });
    return "fehler";
  }
  const pf = mail.postfach_id ? ((await db.lesen("postfaecher?id=eq." + mail.postfach_id + "&select=*")) || [])[0] : null;
  const passwort = pf ? await db.rpc("postfach_passwort", { p_postfach: pf.id }) : null;
  if (!pf || !passwort) {
    await setzen(db, v, "holen", { status: "fehler", grund: "Das Postfach ist nicht mehr verbunden – bitte den Beleg selbst hochladen." });
    return "fehler";
  }
  let anhaenge;
  try {
    anhaenge = await mailAnhaenge(pf, passwort, mail.imap_uid, mail.imap_validity);
  } catch (e) {
    if (!endgueltig(v)) return "nochmal";
    await setzen(db, v, "holen", { status: "fehler", grund: "Der Anhang ließ sich nicht holen: " + (e && e.eigen ? e.message : "Verbindung fehlgeschlagen.") + " Bitte den Beleg selbst hochladen." });
    return "fehler";
  }
  if (anhaenge === null) {
    await setzen(db, v, "holen", { status: "fehler", grund: "Die E-Mail liegt nicht mehr im Posteingang des Postfachs – bitte den Beleg selbst hochladen." });
    return "fehler";
  }
  const a = B.belegAnhangWaehlen(anhaenge);
  if (!a) {
    await setzen(db, v, "holen", { status: "fehler", grund: "Kein lesbarer Anhang (PDF oder Foto bis 8 MB) – bitte den Beleg selbst hochladen." });
    return "fehler";
  }
  const pfad = v.school_id + "/mail-" + crypto.randomUUID() + "." + B.endungFuer(a.typ);
  try {
    await db.speichern("belege", pfad, a.inhalt, a.typ);
  } catch (e) {
    if (!endgueltig(v)) return "nochmal";
    await setzen(db, v, "holen", { status: "fehler", grund: "Der Beleg ließ sich nicht ablegen – bitte selbst hochladen." });
    return "fehler";
  }
  // Fürs Lesen wieder drei Versuche
  await setzen(db, v, "holen", { status: "lesen", beleg_pfad: pfad, beleg_typ: a.typ, beleg_name: a.name, versuche: 0 });
  return "geholt";
}

// Schritt 2: Beleg lesen. Liefert den geänderten Vorschlag, "nochmal" oder "fehler"
async function lesen(db, client, v, schule, context) {
  const bAus = Array.isArray(schule && schule.bereiche_aus) ? schule.bereiche_aus : [];
  if (!schule || schule.ki_aus === true || bAus.indexOf("ki") >= 0) {
    await setzen(db, v, "lesen", { status: "fehler", grund: "Die KI ist für deine Fahrschule ausgeschaltet – bitte die Werte selbst eintragen." });
    return "fehler";
  }
  if (B.BELEG_TYPEN.indexOf(v.beleg_typ) < 0 || !v.beleg_pfad) {
    await setzen(db, v, "lesen", { status: "fehler", grund: "Dieses Dateiformat kann die KI nicht lesen – bitte die Werte selbst eintragen." });
    return "fehler";
  }
  let datei;
  try {
    datei = await db.laden("belege", v.beleg_pfad);
  } catch (e) {
    if (!endgueltig(v)) return "nochmal";
    await setzen(db, v, "lesen", { status: "fehler", grund: "Die Datei ließ sich nicht öffnen – bitte die Werte selbst eintragen." });
    return "fehler";
  }
  if (datei.length > B.MAX_BELEG_BYTES) {
    await setzen(db, v, "lesen", { status: "fehler", grund: "Die Datei ist größer als 8 MB – bitte die Werte selbst eintragen." });
    return "fehler";
  }
  let b = null, verweigert = false;
  try {
    const msg = await client.messages.create({
      model: MODELL,
      max_tokens: 1500,
      output_config: { effort: "low", format: { type: "json_schema", schema: B.SCHEMA } },
      system: B.SYSTEM,
      messages: [{ role: "user", content: B.belegInhalt(datei.toString("base64"), v.beleg_typ) }],
    }, { signal: kiSignal(context) });
    if (msg.stop_reason === "refusal")
      verweigert = true;
    else {
      const block = (msg.content || []).find((x) => x && x.type === "text");
      b = B.belegPruefen(JSON.parse(block ? block.text : ""));
    }
  } catch (e) {
    if (e && e.status) console.error("belege: Anthropic " + e.status);
    if (!endgueltig(v)) return "nochmal";
  }
  const r = B.lesenErgebnis(verweigert ? null : b);
  const felder = b ? { lieferant: b.lieferant, rechnungsnummer: b.rechnungsnummer, datum: b.datum, faellig_am: b.faellig_am, betrag: b.betrag,
    ust_satz: b.ust_satz, kategorie: b.kategorie, beschreibung: B.belegBeschreibung(b), zahlart: b.zahlart, hinweis: b.hinweis } : {};
  const neu = await setzen(db, v, "lesen", { status: r.status, grund: r.grund, ...felder });
  return neu || "fehler";
}

module.exports = { holen, lesen, MODELL };
