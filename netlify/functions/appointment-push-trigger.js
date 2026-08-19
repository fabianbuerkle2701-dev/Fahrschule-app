// Netlify Function: wird vom Postgres-Trigger "appointments_push_trigger" aufgerufen (per
// pg_net), wenn ein Schueler eine neue Anfrage stellt, eine Stornierung anfragt, oder ein
// Warteliste-Angebot selbst uebernimmt (nicht wenn der Lehrer selbst eine Anfrage bestaetigt -
// das filtert der Trigger schon aus). Nicht fuer den Browser gedacht - abgesichert durch ein
// geteiltes Secret (Supabase Vault "push_cron_secret" <-> Netlify-Env CRON_SECRET), nicht durch
// eine Nutzer-Session.

const { notifyAppointmentEvent } = require("./lib/appointment-push");

exports.handler = async function (event) {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Nur POST erlaubt" }) };
  }

  const secret = process.env.CRON_SECRET;
  if (!secret || event.headers["x-cron-secret"] !== secret) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Nicht autorisiert" }) };
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Kein Service-Role-Key hinterlegt." }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Ungültiges JSON" }) };
  }

  try {
    const result = await notifyAppointmentEvent({
      evt: payload.event,
      appointmentId: payload.appointment_id,
      owner: payload.owner,
      serviceKey,
    });
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || "Serverfehler" }) };
  }
};
