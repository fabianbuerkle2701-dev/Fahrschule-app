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

    // Nur die drei erlaubten Felder übernehmen, nichts anderes am Profil verändern
    const patch = {};
    if (typeof body.subscription_active === "boolean") patch.subscription_active = body.subscription_active;
    if (body.subscription_amount === null || typeof body.subscription_amount === "number") patch.subscription_amount = body.subscription_amount;
    if (body.mark_paid_today === true) patch.subscription_last_paid = new Date().toISOString().slice(0, 10);

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
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Speichern fehlgeschlagen: " + (errData.message || updResp.status) }) };
    }
    const updated = await updResp.json();
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, profile: (updated && updated[0]) || null }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
