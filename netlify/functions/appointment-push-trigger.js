// Netlify Function: wird vom Postgres-Trigger "appointments_push_trigger" aufgerufen (per
// pg_net), wenn ein Schueler eine neue Anfrage stellt, eine Stornierung anfragt, oder ein
// Warteliste-Angebot selbst uebernimmt (nicht wenn der Lehrer selbst eine Anfrage bestaetigt -
// das filtert der Trigger schon aus). Nicht fuer den Browser gedacht - abgesichert durch ein
// geteiltes Secret (Supabase Vault "push_cron_secret" <-> Netlify-Env CRON_SECRET), nicht durch
// eine Nutzer-Session.

const { notifyAppointmentEvent } = require("./lib/appointment-push");

// Der Postgres-Trigger schickt ausschliesslich echte uuid-Spalten (appointments.id und
// appointments.owner sind beide "uuid NOT NULL"), alles andere kann nur aus einem manipulierten
// Aufruf stammen. Vorher wanderte owner voellig ungeprueft weiter und landete in lib/apns.js roh
// (ohne encodeURIComponent) in den PostgREST-URLs: ein enthaltenes "#" beendet dort den
// Query-String, der einschraenkende Filter "&token=in.(...)" fiel damit aus der Aufraeum-Anfrage
// fuer tote Tokens heraus und es wurden ALLE Geraetetoken dieses Fahrlehrers geloescht - er war
// danach still von jeder Push abgemeldet. Deshalb hier hart abweisen statt durchreichen.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);

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

  if (!isUuid(payload.appointment_id) || !isUuid(payload.owner)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Ungültige Termin- oder Besitzer-ID" }) };
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
    console.error("appointment-push-trigger:", e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || "Serverfehler" }) };
  }
};
