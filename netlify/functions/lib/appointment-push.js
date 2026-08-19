// Gemeinsame Logik zum Verschicken einer termin-bezogenen Push (neue Anfrage, Storno,
// Warteliste-Uebernahme) - genutzt vom direkten Trigger-Aufruf (appointment-push-trigger.js)
// UND vom stuendlichen Nachhol-Lauf fuer verpasste Pushes (daily-appointment-reminders.js).
// Kein eigener Endpoint (kein exports.handler), nur per require() genutzt.

const { sendApnsPush } = require("./apns");

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

async function notifyAppointmentEvent({ evt, appointmentId, owner, serviceKey }) {
  const texts = EVENT_TEXT[evt];
  if (!texts || !owner) return { skipped: true };

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

  // Erfolgreich zugestellt (mindestens 1 Geraet erreicht) - push_pending_since wieder raeumen,
  // damit der stuendliche Nachhol-Lauf diesen Termin nicht nochmal anfasst. Bei sent===0 bleibt
  // der Zeitstempel bewusst stehen, das ist genau das Signal fuer den Nachhol-Lauf.
  if (result.sent > 0 && appointmentId) {
    await fetch(SUPABASE_URL + "/rest/v1/appointments?id=eq." + appointmentId, {
      method: "PATCH",
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ push_pending_since: null }),
    }).catch(() => {});
  }

  return result;
}

module.exports = { notifyAppointmentEvent, EVENT_TEXT };
