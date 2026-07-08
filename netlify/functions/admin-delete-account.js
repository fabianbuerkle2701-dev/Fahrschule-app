// Netlify Function: löscht ein Nutzerkonto vollständig (Profil + echtes Anmelde-Konto bei Supabase).
// Läuft NUR auf dem Server, niemals im Browser, weil dafür der mächtige Service-Role-Key nötig ist.
// Dieser Schlüssel wird ausschließlich als Netlify-Umgebungsvariable gespeichert, nie im App-Code.

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
// Nur der zentrale App-Admin darf diese Funktion nutzen (dieselbe feste ID wie im Rest der App).
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
    // 1) Prüfen, wer die Anfrage stellt: den Anfragenden per Token identifizieren
    const whoResp = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: serviceKey, Authorization: "Bearer " + requesterToken },
    });
    if (!whoResp.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: "Sitzung ungültig" }) };
    const who = await whoResp.json();
    if (!who || who.id !== ADMIN_UID) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Nur der zentrale App-Admin darf Konten löschen." }) };
    }
    if (targetUid === ADMIN_UID) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Das eigene Admin-Konto kann hier nicht gelöscht werden." }) };
    }

    // 2) Profil-Zeile entfernen (falls vorhanden)
    await fetch(SUPABASE_URL + "/rest/v1/profiles?id=eq." + encodeURIComponent(targetUid), {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
    });

    // 3) Das eigentliche Anmelde-Konto bei Supabase löschen
    const delResp = await fetch(SUPABASE_URL + "/auth/v1/admin/users/" + encodeURIComponent(targetUid), {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
    });
    if (!delResp.ok) {
      const errData = await delResp.json().catch(() => ({}));
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Konto konnte nicht gelöscht werden: " + (errData.msg || errData.error || delResp.status) }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
