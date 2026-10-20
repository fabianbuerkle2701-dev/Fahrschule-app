// Netlify Function: Antwort aus dem Posteingang von Hand senden (KI-Verwaltung, v2.126.0).
// Fahrschul-Admin oder Büro schickt einen (meist von der KI vorbereiteten, ggf. bearbeiteten)
// Entwurf ab - über das verbundene Postfach der Fahrschule und nur an den Absender der Mail.
// Ohne KI-Hinweis: Ein Mensch hat die Antwort geprüft und schickt sie selbst.
// Schutz vor Doppelversand: Vor dem Senden wird der Eintrag mit Status- und Zeitwächter
// reserviert (zwei gleichzeitige Klicks senden nur einmal); ein noch neuer Eintrag verlässt
// dabei den Status "neu", damit die KI ihn nicht parallel selbst beantwortet.

const { dienst, benutzerAusToken, rpcAlsBenutzer } = require("./lib/dienst");
const { antwortSenden } = require("./lib/postfach");

const DEMO_UID = "114d1f0a-9947-459d-8009-06282799ca44";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAGESLIMIT = 300;

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
  const antwort = (statusCode, daten) => ({ statusCode, headers, body: JSON.stringify(daten) });
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return antwort(405, { error: "Nur POST erlaubt" });

  const token = ((event.headers && event.headers.authorization) || "").replace(/^Bearer\s+/i, "");
  const nutzer = await benutzerAusToken(token);
  if (!nutzer) return antwort(401, { error: "Nicht angemeldet" });
  if (nutzer.id === DEMO_UID) return antwort(403, { error: "Im Demo-Modus wird nichts gesendet." });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return antwort(500, { error: "Der Posteingang ist gerade nicht eingerichtet." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return antwort(400, { error: "Ungültige Anfrage" }); }
  const id = String(body.id || "");
  const text = String(body.text || "").replace(/\r\n?/g, "\n").trim();
  const betreff = String(body.betreff || "").replace(/[\r\n]+/g, " ").trim().slice(0, 250);
  if (!UUID.test(id)) return antwort(400, { error: "Ungültige Anfrage" });
  if (!text) return antwort(400, { error: "Die Antwort ist leer." });
  if (text.length > 10000) return antwort(400, { error: "Die Antwort ist zu lang." });
  if (/\[bitte ergänzen/i.test(text)) return antwort(400, { error: "Im Text steht noch „[bitte ergänzen …]“. Ergänze die Stelle, bevor du sendest." });

  const db = dienst(serviceKey);
  let z;
  try {
    z = ((await db.lesen("posteingang?id=eq." + id + "&select=*")) || [])[0];
  } catch (e) {
    return antwort(503, { error: "Der Posteingang ist gerade nicht erreichbar. Bitte versuch es gleich noch einmal." });
  }
  if (!z) return antwort(404, { error: "Diese Nachricht gibt es nicht mehr." });
  if ((await rpcAlsBenutzer(token, "_darf_posteingang", { p_school: z.school_id })) !== true)
    return antwort(403, { error: "Nur Fahrschul-Admin und Büro können aus dem Posteingang antworten." });
  if (z.status === "zu_senden") return antwort(409, { error: "Die KI sendet diese Antwort gerade. Lade den Posteingang gleich neu." });
  if (!z.von_email) return antwort(400, { error: "Diese Nachricht hat keinen Absender, an den man antworten kann." });

  const pf = ((await db.lesen("postfaecher?school_id=eq." + z.school_id + "&select=*")) || [])[0];
  if (!pf) return antwort(409, { error: "Es ist kein Postfach verbunden. Verbinde es zuerst im Posteingang unter „Postfach“." });
  const seit = new Date(Date.now() - 86400000).toISOString();
  if ((await db.zaehlen("posteingang?school_id=eq." + z.school_id + "&gesendet_am=gte." + encodeURIComponent(seit) + "&gesendet_von=neq.ki")) >= TAGESLIMIT)
    return antwort(429, { error: "Heute wurden schon sehr viele Antworten gesendet. Bitte morgen weiter." });
  const passwort = await db.rpc("postfach_passwort", { p_postfach: pf.id });
  if (!passwort) return antwort(409, { error: "Zum Postfach ist kein Passwort gespeichert. Bitte das Postfach neu verbinden." });

  const zeit = () => new Date().toISOString();
  const aktionen = [...(Array.isArray(z.aktionen) ? z.aktionen : []), { art: "senden", von: nutzer.id, zeit: zeit() }];
  const reserviert = await db.aendern("posteingang",
    "id=eq." + id + "&status=eq." + encodeURIComponent(z.status) + "&updated_at=eq." + encodeURIComponent(z.updated_at),
    { aktionen, status: z.status === "neu" ? "braucht_dich" : z.status, updated_at: zeit() }, true);
  if (!Array.isArray(reserviert) || !reserviert.length)
    return antwort(409, { error: "Die Nachricht wurde gerade geändert (vielleicht von jemand anderem). Lade den Posteingang neu." });

  try {
    await antwortSenden(pf, passwort, {
      an: z.von_email, betreff: betreff || "Re: " + (z.betreff || "Ihre Nachricht"), text,
      antwortAuf: /^uid:/.test(z.message_id || "") ? "" : z.message_id, referenzen: z.referenzen, automatisch: false,
      gesendet: () => db.aendern("posteingang", "id=eq." + id, { status: "beantwortet", antwort_text: text, gesendet_am: zeit(), gesendet_von: nutzer.id, grund: "",
        aktionen: [...aktionen, { art: "gesendet", von: nutzer.id, zeit: zeit() }], updated_at: zeit() }),
    });
  } catch (e) {
    const grund = e && e.eigen ? e.message : "Senden fehlgeschlagen.";
    try { await db.aendern("posteingang", "id=eq." + id, { aktionen: [...aktionen, { art: "senden_fehler", grund, von: nutzer.id, zeit: zeit() }], updated_at: zeit() }); } catch (e2) { }
    return antwort(502, { error: grund });
  }
  return antwort(200, { ok: true });
};
