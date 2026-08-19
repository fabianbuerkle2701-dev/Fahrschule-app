// Netlify Function: wird stuendlich vom pg_cron-Job "hourly-reminder-check" aufgerufen.
// Macht bei JEDEM Aufruf zwei Dinge:
// 1. Nachhol-Lauf fuer verpasste Termin-Pushes (siehe catchUpMissedPushes) - faengt Faelle ab,
//    bei denen der direkte Postgres-Trigger aus irgendeinem Grund keine erfolgreiche Zustellung
//    hinbekommen hat (fehlendes Vault-Secret, Netzwerkausfall, tote Function).
// 2. Nur um 18 Uhr Europe/Berlin (No-op sonst, vermeidet die Sommer-/Winterzeit-Verschiebung
//    einer festen UTC-Cron-Zeit): fasst pro Fahrlehrer die morgigen bestaetigten Fahrstunden zu
//    einer Push zusammen - gleiche Ausschluss-Logik wie erinnerungsKandidaten() in index.html
//    (kein §SONST§/§URLAUB§-Termin, keine PRIVAT-Termine), nur serverseitig statt im Browser.

const { sendApnsPush } = require("./lib/apns");
const { notifyAppointmentEvent } = require("./lib/appointment-push");

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
const SONST_MARK = "§SONST§";
const URLAUB_MARK = "§URLAUB§";

function berlinDateStr(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(date);
}
function berlinHour(date) {
  const parts = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).formatToParts(date);
  const h = parts.find((p) => p.type === "hour");
  return h ? parseInt(h.value, 10) : null;
}

// Termine mit offener Push-Zustellung (push_pending_since gesetzt), die vor mindestens 10 Min.
// (Anlaufzeit fuer den normalen Trigger-Pfad) und hoechstens 24h passiert sind - alles Aeltere
// ist vermutlich laengst anderweitig bemerkt worden und wuerde nur unnoetig nachtraeglich stoeren.
async function catchUpMissedPushes(sbFetch, serviceKey) {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const notTooOld = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const resp = await sbFetch(
    "appointments?push_pending_since=not.is.null" +
      "&push_pending_since=lte." + encodeURIComponent(cutoff) +
      "&push_pending_since=gte." + encodeURIComponent(notTooOld) +
      "&status=in.(pending,cancel_requested)&select=id,owner,status"
  );
  if (!resp.ok) return { checked: 0, recovered: 0 };
  const rows = (await resp.json()) || [];
  let recovered = 0;
  for (const row of rows) {
    const evt = row.status === "pending" ? "new_request" : "cancel_requested";
    try {
      const result = await notifyAppointmentEvent({ evt, appointmentId: row.id, owner: row.owner, serviceKey });
      if (result && result.sent > 0) recovered++;
    } catch (e) {
      // naechster Versuch beim naechsten stuendlichen Aufruf
    }
  }
  return { checked: rows.length, recovered };
}

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
  const sbFetch = (path) =>
    fetch(SUPABASE_URL + "/rest/v1/" + path, { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey } });

  let catchUp;
  try {
    catchUp = await catchUpMissedPushes(sbFetch, serviceKey);
  } catch (e) {
    catchUp = { error: e.message || "Nachhol-Lauf fehlgeschlagen" };
  }

  const now = new Date();
  if (berlinHour(now) !== 18) {
    return { statusCode: 200, headers, body: JSON.stringify({ skipped: "not_18_berlin", catchUp }) };
  }

  try {
    const ownersResp = await sbFetch("device_tokens?select=owner");
    if (!ownersResp.ok) throw new Error("Geraeteliste konnte nicht geladen werden (" + ownersResp.status + ")");
    const ownerRows = (await ownersResp.json()) || [];
    const owners = [...new Set(ownerRows.map((r) => r.owner))];
    if (!owners.length) return { statusCode: 200, headers, body: JSON.stringify({ owners: 0, catchUp }) };

    const tomorrowStr = berlinDateStr(new Date(now.getTime() + 24 * 3600 * 1000));
    // Grosszuegiges UTC-Fenster (heute bis +3 Tage), exakter Tagesvergleich passiert unten in JS
    // per Berliner Kalenderdatum - vermeidet fehleranfaellige DST-Randfaelle in der URL selbst.
    const fromStr = now.toISOString();
    const toStr = new Date(now.getTime() + 3 * 24 * 3600 * 1000).toISOString();

    const results = [];
    for (const owner of owners) {
      const apptResp = await sbFetch(
        "appointments?owner=eq." + owner + "&status=eq.confirmed" +
          "&start_at=gte." + encodeURIComponent(fromStr) +
          "&start_at=lte." + encodeURIComponent(toStr) +
          "&select=start_at,note,art,student_id&order=start_at.asc"
      );
      if (!apptResp.ok) continue;
      const rows = (await apptResp.json()) || [];
      const relevant = rows.filter((a) => {
        const note = a.note || "";
        if (note.indexOf(SONST_MARK) === 0 || note.indexOf(URLAUB_MARK) === 0) return false;
        if (a.art === "PRIVAT") return false;
        if (!a.student_id) return false;
        return berlinDateStr(new Date(a.start_at)) === tomorrowStr;
      });
      if (!relevant.length) continue;

      const firstTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(
        new Date(relevant[0].start_at)
      );
      const count = relevant.length;
      const title = "Morgen: " + count + (count === 1 ? " Fahrstunde" : " Fahrstunden");
      const body = count === 1 ? "1 Fahrstunde morgen, um " + firstTime + " Uhr." : count + " Fahrstunden morgen, erste um " + firstTime + " Uhr.";

      const sendResult = await sendApnsPush({ ownerId: owner, title, body, data: { type: "daily_reminder" } });
      results.push({ owner, count, sent: sendResult.sent });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ processed: results.length, results, catchUp }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || "Serverfehler", catchUp }) };
  }
};
