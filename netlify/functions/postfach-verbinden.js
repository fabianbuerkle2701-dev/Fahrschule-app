// Netlify Function: Postfach verbinden (KI-Verwaltung · Posteingang, v2.126.0).
// Nur der Fahrschul-Admin. Prüft die Anmeldung bei IMAP und SMTP und legt die Verbindung dann über
// postfach_speichern ab - das Passwort direkt in den Supabase-Tresor, nie in eine Tabelle oder ins Log.
// Ein Tageskontingent (wie bei den KI-Functions) verhindert, dass die Function zum Durchprobieren
// fremder Postfächer missbraucht wird.

const { dienst, benutzerAusToken } = require("./lib/dienst");
const { konfiguration, postfachPruefen } = require("./lib/postfach");

const ADMIN_UID = "96530a9f-28ae-4ac6-9cfa-26de392ecf05";
const DEMO_UID = "114d1f0a-9947-459d-8009-06282799ca44";

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
  if (nutzer.id === DEMO_UID) return antwort(403, { error: "Im Demo-Modus lässt sich kein Postfach verbinden." });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return antwort(500, { error: "Der Posteingang ist gerade nicht eingerichtet." });
  const db = dienst(serviceKey);

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return antwort(400, { error: "Ungültige Anfrage" }); }

  let profil;
  try {
    profil = ((await db.lesen("profiles?id=eq." + encodeURIComponent(nutzer.id) + "&select=school_id,school_admin")) || [])[0];
  } catch (e) {
    return antwort(503, { error: "Dein Konto ließ sich gerade nicht prüfen. Bitte versuch es gleich noch einmal." });
  }
  if (!profil || !profil.school_id || !(profil.school_admin === true || nutzer.id === ADMIN_UID))
    return antwort(403, { error: "Nur der Fahrschul-Admin kann das Postfach verbinden." });

  // KI-Schalter der Fahrschule und Kontingent gegen Durchprobieren (20 Versuche am Tag)
  const gate = await require("./lib/ki-guard").subscriptionGate(nutzer.id, token, { feature: "postfach", limit: 20, ohneAbo: true });
  if (!gate.ok)
    return antwort(gate.statusCode, { error: gate.statusCode === 403 ? "Die KI ist für deine Fahrschule ausgeschaltet – der Posteingang braucht sie." : gate.error });

  const { cfg, fehler } = konfiguration(body);
  if (fehler) return antwort(400, { error: fehler });
  const passwort = typeof body.passwort === "string" ? body.passwort : "";
  if (!passwort || passwort.length > 300) return antwort(400, { error: "Bitte das Passwort des Postfachs eingeben." });

  let stand;
  try {
    stand = await postfachPruefen(cfg, passwort);
  } catch (e) {
    return antwort(400, { error: e && e.eigen ? e.message : "Die Verbindung zum Postfach ist fehlgeschlagen." });
  }

  // Erneut verbunden (z. B. neues Passwort): dort weitermachen, wo der Abruf stand - sonst ab jetzt.
  let letzteUid = Math.max(0, (Number(stand.uidNext) || 1) - 1);
  try {
    const alt = ((await db.lesen("postfaecher?school_id=eq." + profil.school_id + "&select=email,imap_host,letzte_uid,uid_validity")) || [])[0];
    if (alt && alt.email === cfg.email && alt.imap_host === cfg.imap_host && alt.uid_validity != null && Number(alt.uid_validity) === Number(stand.uidValidity))
      letzteUid = Math.min(Number(alt.letzte_uid) || 0, letzteUid);
  } catch (e) { }

  try {
    await db.rpc("postfach_speichern", { p_school: profil.school_id, p_user: nutzer.id, p_cfg: { ...cfg, letzte_uid: letzteUid, uid_validity: stand.uidValidity }, p_passwort: passwort });
  } catch (e) {
    console.error("postfach-verbinden: speichern " + (e && e.status));
    return antwort(500, { error: "Die Verbindung klappt, ließ sich aber nicht speichern. Bitte versuch es noch einmal." });
  }
  return antwort(200, { ok: true });
};
