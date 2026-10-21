// Netlify Function: neue E-Mails abholen (KI-Verwaltung · Posteingang, v2.126.0).
// Aufruf alle 5 Minuten durch den pg_cron-Job "posteingang-abruf" (nur wenn ein Postfach aktiv ist),
// mit demselben Geheimnis wie die Push-Jobs (x-cron-secret = CRON_SECRET). Holt je Lauf bis zu vier
// Postfächer (das am längsten nicht abgeholte zuerst), je Postfach höchstens zehn neue Mails, und
// legt sie in public.posteingang ab. Eingeordnet und beantwortet wird danach einzeln von
// posteingang-ki.js. Automatische Nachrichten (Abwesenheit, Rückläufer, Newsletter) gehen gar
// nicht erst an die KI. Ist die KI der Fahrschule aus, wird nichts abgeholt.

const { dienst } = require("./lib/dienst");
const { neueMails, mailZerlegen } = require("./lib/postfach");
const { automatischeNachricht, absenderUnsicher, textSaeubern, nurAdmin } = require("./lib/posteingang");

const ZEITBUDGET_MS = 8000;

exports.handler = async function (event) {
  const headers = { "Content-Type": "application/json" };
  const antwort = (statusCode, daten) => ({ statusCode, headers, body: JSON.stringify(daten) });
  if (event.httpMethod !== "POST") return antwort(405, { error: "Nur POST erlaubt" });
  const secret = process.env.CRON_SECRET;
  if (!secret || (event.headers && event.headers["x-cron-secret"]) !== secret) return antwort(401, { error: "Nicht autorisiert" });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return antwort(500, { error: "Kein Service-Role-Key hinterlegt." });
  const db = dienst(serviceKey);
  const start = Date.now();

  let faecher;
  try {
    faecher = (await db.lesen("postfaecher?aktiv=eq.true&select=*&order=letzter_abruf.asc.nullsfirst&limit=4")) || [];
  } catch (e) {
    return antwort(503, { error: "Postfächer nicht lesbar" });
  }

  let neu = 0;
  for (const pf of faecher) {
    if (Date.now() - start > ZEITBUDGET_MS - 3000) break;
    const jetzt = new Date().toISOString();
    try {
      // Ohne KI wird trotzdem abgeholt (Fabian 21.10.2026): Die Mails liegen dann ohne Entwurf bei „Braucht dich“
      const schule = ((await db.lesen("schools?id=eq." + pf.school_id + "&select=bereiche_aus")) || [])[0] || {};
      const bereiche = Array.isArray(schule.bereiche_aus) ? schule.bereiche_aus : [];
      if (bereiche.indexOf("posteingang") >= 0) {
        await db.aendern("postfaecher", "id=eq." + pf.id, { letzter_abruf: jetzt, letzter_fehler: "Der Posteingang ist für die Fahrschule ausgeschaltet – es wird nichts abgeholt." });
        continue;
      }
      const passwort = await db.rpc("postfach_passwort", { p_postfach: pf.id });
      if (!passwort) throw Object.assign(new Error("Kein Passwort hinterlegt – bitte das Postfach neu verbinden."), { eigen: true });
      const erg = await neueMails(pf, passwort, pf.letzte_uid, pf.uid_validity, 10);
      for (const m of erg.mails) {
        // Eine kaputte Mail darf den Abruf nicht dauerhaft blockieren: dann nur ein Hinweis-Eintrag
        let z, unlesbar = false;
        try {
          z = await mailZerlegen(m);
        } catch (e) {
          unlesbar = true;
          z = { von_name: "", von_email: "", betreff: "(nicht lesbare E-Mail)", text: "Diese E-Mail ließ sich nicht lesen – bitte direkt im Postfach öffnen.",
            message_id: "", antwort_auf: "", referenzen: "", datum: new Date().toISOString(), headers: {}, anhaenge: 0 };
        }
        const automatisch = unlesbar ? "" : automatischeNachricht(z.von_email, z.headers, pf.email);
        const datum = new Date(z.datum).getTime();
        const zeile = {
          school_id: pf.school_id, postfach_id: pf.id, quelle: "email",
          // Lohnpost nur für den Admin (Absenderliste, Stichworte); die KI kann später noch „personal“ ergänzen
          nur_admin: !unlesbar && nurAdmin({ vonEmail: z.von_email, betreff: z.betreff, text: z.text, regeln: pf.regeln }),
          message_id: z.message_id || ("uid:" + (erg.uidValidity || "") + ":" + m.uid),
          antwort_auf: z.antwort_auf || "", referenzen: z.referenzen || "",
          von_name: z.von_name || "", von_email: z.von_email || "", betreff: z.betreff || "",
          text: textSaeubern(z.text) + (z.anhaenge ? "\n\n(" + z.anhaenge + (z.anhaenge === 1 ? " Anhang" : " Anhänge") + " – bitte im Postfach ansehen.)" : ""),
          empfangen_am: new Date(Number.isFinite(datum) ? Math.min(datum, Date.now()) : Date.now()).toISOString(),
          status: unlesbar ? "braucht_dich" : automatisch ? "info" : "neu", grund: unlesbar ? "Ließ sich nicht lesen – bitte im Postfach ansehen." : automatisch || "",
          // Für Belege: woher die Mail kam, damit der Anhang später gezielt geholt werden kann
          imap_uid: m.uid, imap_validity: erg.uidValidity == null ? null : erg.uidValidity, anhaenge: Number(z.anhaenge) || 0,
          // Absender laut Mailserver nicht bestätigt (SPF/DMARC): merken - dann antwortet die KI nie selbst
          aktionen: [{ art: "abgeholt", zeit: jetzt, ...(!unlesbar && absenderUnsicher(z.headers) ? { unsicher: true } : {}) }],
        };
        // Schon vorhanden (gleiche Message-ID in diesem Postfach): überspringen. Der eindeutige
        // Index ist partiell, deshalb meldet PostgREST den Doppelten als 409 statt ihn still zu ignorieren.
        try {
          await db.einfuegen("posteingang", zeile, true);
          neu++;
        } catch (e) {
          if (!(e && e.status === 409)) throw e;
        }
      }
      await db.aendern("postfaecher", "id=eq." + pf.id, { letzte_uid: erg.letzteUid, uid_validity: erg.uidValidity, letzter_abruf: jetzt, letzter_fehler: "", fehler_seit: null });
    } catch (e) {
      // Drei Tage am Stück Fehler: Abruf ruhen lassen, bis der Admin neu verbindet
      const seit = pf.fehler_seit || jetzt;
      const lange = Date.now() - new Date(seit).getTime() > 3 * 86400000;
      try {
        await db.aendern("postfaecher", "id=eq." + pf.id, { letzter_abruf: jetzt, letzter_fehler: e && e.eigen ? e.message : "Abholen fehlgeschlagen.", fehler_seit: seit, aktiv: !lange });
      } catch (e2) { }
    }
  }
  return antwort(200, { postfaecher: faecher.length, neu });
};
