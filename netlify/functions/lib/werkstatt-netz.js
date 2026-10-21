// Werkstatt-Termine (Allindrive Autopilot, 21.10.2026): Datenbank und Postfach – gemeinsam für die Function
// werkstatt-anfrage (Admin/Büro) und den Zeitjob vollautonom-werkstatt (Vollautonom).

const { antwortSenden, emailGueltig } = require("./postfach");
const W = require("./werkstatt");

const TAGE_VORAUS = 21;

function kiAus(schule) {
  const b = Array.isArray(schule && schule.bereiche_aus) ? schule.bereiche_aus : [];
  return !!(schule && schule.ki_aus === true) || b.indexOf("ki") >= 0 || b.indexOf("fuhrpark") >= 0;
}
function fahrzeugAus(schule, id) {
  const v = (Array.isArray(schule && schule.vehicles) ? schule.vehicles : []).find((x) => x && x.id === id);
  return v && !v.inactive ? v : null;
}
// Kalenderdatum in Berlin, n Tage verschoben
function berlinDatum(n, jetzt) {
  return W.tagPlus(W.berlinTeile((jetzt || new Date()).toISOString()).datum, n || 0);
}

// Wann ist das Fahrzeug verplant? Fahrstunden (appointments.fahrzeug) und Fahrzeug-Kalender (bookings)
async function belegtLaden(db, schoolId, fahrzeugId, vonIso, bisIso) {
  const id = encodeURIComponent(fahrzeugId);
  const [kalender, stunden, konten] = await Promise.all([
    db.lesen("bookings?school_id=eq." + schoolId + "&vehicle_id=eq." + id + "&start_at=lt." + encodeURIComponent(bisIso) + "&end_at=gt." + encodeURIComponent(vonIso) + "&select=start_at,end_at"),
    db.lesen("appointments?fahrzeug=eq." + id + "&start_at=lt." + encodeURIComponent(bisIso) + "&start_at=gte." + encodeURIComponent(new Date(new Date(vonIso).getTime() - 86400000).toISOString()) + "&select=owner,start_at,end_at"),
    db.lesen("profiles?school_id=eq." + schoolId + "&select=id"),
  ]);
  const eigene = new Set((konten || []).map((p) => p.id));
  return [
    ...(kalender || []).map((b) => ({ start: b.start_at, ende: b.end_at })),
    ...(stunden || []).filter((t) => eigene.has(t.owner)).map((t) => ({ start: t.start_at, ende: t.end_at || new Date(new Date(t.start_at).getTime() + 45 * 60000).toISOString() })),
  ];
}

// Anfrage vorbereiten: Fahrzeug, Werkstatt (mit gültiger E-Mail) und drei freie Zeiten ab übermorgen
async function vorbereiten(db, schule, fahrzeugId, anlass, jetzt) {
  if (!W.ANLASS[anlass]) return { fehler: "Unbekannter Anlass." };
  const fahrzeug = fahrzeugAus(schule, fahrzeugId);
  if (!fahrzeug) return { fehler: "Dieses Fahrzeug gibt es nicht (mehr)." };
  const werkstatt = ((await db.lesen("fahrzeug_werkstaetten?school_id=eq." + schule.id + "&fahrzeug_id=eq." + encodeURIComponent(fahrzeugId) + "&select=*")) || [])[0];
  if (!werkstatt) return { fehler: "Für dieses Fahrzeug ist noch keine Werkstatt hinterlegt." };
  if (!emailGueltig(String(werkstatt.email || "").trim())) return { fehler: "Bei der Werkstatt fehlt eine gültige E-Mail-Adresse." };
  const ab = berlinDatum(2, jetzt);
  const von = W.berlinZeit(ab, 0), bis = W.berlinZeit(W.tagPlus(ab, TAGE_VORAUS), 0);
  const vorschlaege = W.freieZeiten(await belegtLaden(db, schule.id, fahrzeugId, von, bis), ab, 3, TAGE_VORAUS);
  return {
    fahrzeug, werkstatt, an: String(werkstatt.email).trim(), vorschlaege,
    betreff: W.anfrageBetreff(anlass, fahrzeug),
    text: W.anfrageText({ schule, fahrzeug, werkstatt, anlass, vorschlaege }),
  };
}

// Anfrage senden: erst die Zeile anlegen (je Fahrzeug und Anlass nur eine offene – ein zweiter Klick oder Lauf
// schreibt die Werkstatt nicht noch einmal an), dann senden. Scheitert das Senden, ist die Anfrage abgebrochen.
async function senden(db, o) {
  let zeile;
  try {
    const r = await db.einfuegen("werkstatt_anfragen", {
      school_id: o.schule.id, fahrzeug_id: o.fahrzeug.id, werkstatt_id: o.werkstatt.id, anlass: o.anlass, status: "gesendet",
      an: o.an, betreff: o.betreff, text: o.text, vorschlaege: o.vorschlaege || [], von_ki: !!o.vonKi, erstellt_von: o.erstelltVon || null,
    });
    zeile = Array.isArray(r) ? r[0] : null;
  } catch (e) {
    if (e && e.status === 409) return { schon: true };
    throw e;
  }
  if (!zeile) return { schon: true };
  try {
    await antwortSenden(o.pf, o.passwort, {
      an: o.an, betreff: o.betreff, text: o.text, automatisch: false, erzeugt: !!o.vonKi,
      gesendet: async (info) => {
        const mid = String((info && info.messageId) || "").slice(0, 300);
        if (mid) {
          try { await db.aendern("werkstatt_anfragen", "id=eq." + zeile.id, { message_id: mid, updated_at: new Date().toISOString() }); }
          catch (e) { console.error("werkstatt: Message-ID nicht gespeichert (" + (e && e.status) + ")"); }
        }
      },
    });
  } catch (e) {
    try { await db.aendern("werkstatt_anfragen", "id=eq." + zeile.id, { status: "abgebrochen", updated_at: new Date().toISOString() }); } catch (e2) { /* egal */ }
    throw e;
  }
  return { anfrage: zeile };
}

// Gehört diese Mail zu einer offenen Anfrage? Über In-Reply-To/References, sonst: Absender ist die Werkstatt einer
// Anfrage der letzten 30 Tage
const ohneKlammern = (s) => String(s || "").trim().replace(/^<|>$/g, "").toLowerCase();
async function anfrageZuMail(db, mail) {
  const offen = (await db.lesen("werkstatt_anfragen?school_id=eq." + mail.school_id + "&status=in.(gesendet,antwort)&select=*&order=created_at.desc&limit=20")) || [];
  if (!offen.length) return null;
  const bezug = [mail.antwort_auf, ...String(mail.referenzen || "").split(/\s+/)].map(ohneKlammern).filter(Boolean);
  const perId = offen.find((a) => a.message_id && bezug.indexOf(ohneKlammern(a.message_id)) >= 0);
  if (perId) return perId;
  const von = String(mail.von_email || "").trim().toLowerCase();
  const seit = Date.now() - 30 * 86400000;
  return offen.find((a) => String(a.an || "").trim().toLowerCase() === von && new Date(a.created_at).getTime() >= seit) || null;
}

module.exports = { TAGE_VORAUS, kiAus, fahrzeugAus, berlinDatum, belegtLaden, vorbereiten, senden, anfrageZuMail };
