// Netlify Function: setzt Abo-Status und Betrag eines einzelnen Fahrlehrers.
// Nur der zentrale App-Admin darf das. Läuft über den Service-Role-Key, weil profiles
// normalerweise nur vom Fahrlehrer selbst oder Fahrschul-Admins bearbeitet werden darf.

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
const ADMIN_UID = "96530a9f-28ae-4ac6-9cfa-26de392ecf05";

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Nur POST erlaubt" }) };

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "Kein Service-Role-Key hinterlegt (SUPABASE_SERVICE_ROLE_KEY)." }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Ungültige Anfrage" }) }; }

  const requesterToken = (event.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const targetUid = body.targetUid;
  if (!requesterToken) return { statusCode: 401, headers, body: JSON.stringify({ error: "Nicht angemeldet" }) };
  if (!targetUid) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Ziel-ID angegeben" }) };

  try {
    const whoResp = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: serviceKey, Authorization: "Bearer " + requesterToken },
    });
    if (!whoResp.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: "Sitzung ungültig" }) };
    const who = await whoResp.json();
    if (!who || who.id !== ADMIN_UID) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Nur der zentrale App-Admin darf das ändern." }) };
    }

    // Nur die erlaubten Felder übernehmen, nichts anderes am Profil verändern
    const patch = {};
    if (typeof body.subscription_active === "boolean") patch.subscription_active = body.subscription_active;
    if (body.subscription_amount === null || typeof body.subscription_amount === "number") patch.subscription_amount = body.subscription_amount;
    // "Heute" aus deutscher Zeit, nicht UTC - sonst landet zwischen 0 und 2 Uhr nachts das Vortagsdatum in der DB
    if (body.mark_paid_today === true) patch.subscription_last_paid = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
    if (typeof body.theory_addon_active === "boolean") patch.theory_addon_active = body.theory_addon_active;
    // Lifetime: dauerhaft freigeschaltet, unabhaengig von Betrag, Zahlungsdatum und Probezeit.
    // Bewusst nur hier setzbar - der Schutz-Trigger in der Datenbank verwirft jeden Versuch,
    // der nicht vom zentralen Admin oder vom Service-Role-Key kommt.
    if (typeof body.subscription_lifetime === "boolean") patch.subscription_lifetime = body.subscription_lifetime;

    if (Object.keys(patch).length === 0) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine gültigen Felder übergeben" }) };

    const updResp = await fetch(SUPABASE_URL + "/rest/v1/profiles?id=eq." + encodeURIComponent(targetUid), {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    });
    if (!updResp.ok) {
      const errData = await updResp.json().catch(() => ({}));
      console.error("admin-set-subscription: PATCH fehlgeschlagen", updResp.status, errData);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Speichern fehlgeschlagen: " + (errData.message || updResp.status) }) };
    }
    const updated = await updResp.json();
    // PostgREST antwortet auch dann mit 200, wenn die id keine Zeile trifft - die Antwort ist dann
    // nur ein leeres Array. Ohne diese Pruefung meldete die Funktion Erfolg fuer Konten ohne
    // profiles-Zeile: Die Oberflaeche zeigte "Abo aktiv" bzw. "Zuletzt bezahlt: heute", in der
    // Datenbank stand davon nichts.
    if (!Array.isArray(updated) || updated.length === 0) {
      console.error("admin-set-subscription: PATCH ohne Treffer, kein Profil zu id " + targetUid);
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Zu diesem Konto gibt es kein Profil. Es wurde nichts geändert." }) };
    }
    // Die gespeicherte Zeile vollstaendig zurueckgeben (inkl. subscription_lifetime): Die Oberflaeche
    // soll den neuen Stand aus der Antwort uebernehmen und nicht aus ihrer eigenen Annahme - sonst
    // laeuft sie auseinander, sobald ein Feld anders in der Datenbank landet als gesendet.
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, profile: updated[0] }) };
  } catch (e) {
    // Nach aussen nur eine allgemeine Meldung: Dieser Block greift auch, bevor der Aufrufer als
    // Admin bestaetigt ist (z. B. wenn schon der Auth-Aufruf scheitert) - Details gehoeren dann
    // ins Server-Log, nicht in die Antwort.
    console.error("admin-set-subscription: Serverfehler", e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler. Bitte später noch einmal versuchen." }) };
  }
};
