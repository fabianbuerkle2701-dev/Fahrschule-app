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
  // appointmentId kommt ungeprueft aus dem Trigger-Payload - wie ueberall sonst im Ordner ungepruefte
  // IDs per encodeURIComponent escapen, bevor sie in die PostgREST-Filter-Query landen (sonst koennte
  // z.B. ein "&" darin einen zusaetzlichen Query-Parameter einschleusen).
  const apptResp = await fetch(SUPABASE_URL + "/rest/v1/appointments?id=eq." + encodeURIComponent(appointmentId) + "&select=student_id", {
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
  });
  if (apptResp.ok) {
    const apptRows = await apptResp.json();
    const studentId = apptRows && apptRows[0] && apptRows[0].student_id;
    if (studentId) {
      const stuResp = await fetch(SUPABASE_URL + "/rest/v1/students?id=eq." + encodeURIComponent(studentId) + "&select=data", {
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
    // .catch fängt nur Netzwerk-/Promise-Fehler ab, fetch() lehnt bei einem HTTP-Fehlerstatus
    // (z.B. 404/409/500) nicht ab - ohne die resp.ok-Prüfung bliebe ein fehlgeschlagenes Räumen
    // von push_pending_since unbemerkt. Auf einen erneuten Versand beim nächsten Nachhol-Lauf
    // wird bewusst verzichtet (der Termin ist ja bereits zugestellt) - hier zählt nur Sichtbarkeit
    // im Log, damit ein wiederholt fehlschlagendes Räumen auffällt statt sich zu häufen.
    const patchResp = await fetch(SUPABASE_URL + "/rest/v1/appointments?id=eq." + encodeURIComponent(appointmentId), {
      method: "PATCH",
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ push_pending_since: null }),
    }).catch((e) => { console.error("push_pending_since raeumen fehlgeschlagen (Netzwerk):", e); return null; });
    if (patchResp && !patchResp.ok) {
      console.error("push_pending_since raeumen fehlgeschlagen:", patchResp.status, await patchResp.text().catch(() => ""));
    }
  }

  return result;
}

module.exports = { notifyAppointmentEvent, EVENT_TEXT };
