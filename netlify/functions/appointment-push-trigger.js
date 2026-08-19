// Netlify Function: wird vom Postgres-Trigger "appointments_push_trigger" aufgerufen (per
// pg_net), wenn ein Schueler eine neue Anfrage stellt, eine Stornierung anfragt, oder ein
// Warteliste-Angebot selbst uebernimmt (nicht wenn der Lehrer selbst eine Anfrage bestaetigt -
// das filtert der Trigger schon aus). Nicht fuer den Browser gedacht - abgesichert durch ein
// geteiltes Secret (Supabase Vault "push_cron_secret" <-> Netlify-Env CRON_SECRET), nicht durch
// eine Nutzer-Session.

const { sendApnsPush } = require("./lib/apns");

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";

const EVENT_TEXT = {
  new_request: {
    title: "Neue Anfrage",
    body: (name) => (name ? name + " hat eine Fahrstunde angefragt." : "Ein Schüler hat eine Fahrstunde angefragt."),
  },
  cancel_requested: {
    title: "Stornierung angefragt",
    body: (name) => (name ? name + " möchte eine Fahrstunde stornieren." : "Ein Schüler möchte eine Fahrstunde stornieren."),
  },
  offer_claimed: {
    title: "Freie Stunde vergeben",
    body: (name) => (name ? name + " hat die freie Stunde übernommen." : "Eine freie Stunde wurde übernommen."),
  },
};

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

  const evt = payload.event;
  const appointmentId = payload.appointment_id;
  const owner = payload.owner;
  const texts = EVENT_TEXT[evt];
  if (!texts || !owner) {
    return { statusCode: 200, headers, body: JSON.stringify({ skipped: true }) };
  }

  try {
    let studentName = null;
    const apptResp = await fetch(SUPABASE_URL + "/rest/v1/appointments?id=eq." + appointmentId + "&select=student_id", {
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
    });
    if (apptResp.ok) {
      const apptRows = await apptResp.json();
      const studentId = apptRows && apptRows[0] && apptRows[0].student_id;
      if (studentId) {
        const stuResp = await fetch(SUPABASE_URL + "/rest/v1/students?id=eq." + studentId + "&select=data", {
          headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
        });
        if (stuResp.ok) {
          const stuRows = await stuResp.json();
          const d = (stuRows && stuRows[0] && stuRows[0].data) || {};
          studentName = [d.vorname, d.name].filter(Boolean).join(" ").trim() || null;
        }
      }
    }

    const result = await sendApnsPush({
      ownerId: owner,
      title: texts.title,
      body: texts.body(studentName),
      data: { type: evt, appointmentId: appointmentId },
    });
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || "Serverfehler" }) };
  }
};
