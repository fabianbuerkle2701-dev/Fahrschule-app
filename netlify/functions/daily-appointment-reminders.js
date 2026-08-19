// Netlify Function: wird stuendlich vom pg_cron-Job "hourly-reminder-check" aufgerufen und
// feuert nur tatsaechlich, wenn es gerade 18 Uhr Europe/Berlin ist (No-op sonst) - das
// vermeidet die Sommer-/Winterzeit-Verschiebung, die eine feste UTC-Cron-Zeit haette. Fasst
// pro Fahrlehrer die morgigen bestaetigten Fahrstunden zu einer Push zusammen - gleiche
// Ausschluss-Logik wie erinnerungsKandidaten() in index.html (kein §SONST§/§URLAUB§-Termin,
// keine PRIVAT-Termine), nur serverseitig statt im Browser.

const { sendApnsPush } = require("./lib/apns");

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

exports.handler = async function (event) {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Nur POST erlaubt" }) };
  }

  const secret = process.env.CRON_SECRET;
  if (!secret || event.headers["x-cron-secret"] !== secret) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Nicht autorisiert" }) };
  }

  const now = new Date();
  if (berlinHour(now) !== 18) {
    return { statusCode: 200, headers, body: JSON.stringify({ skipped: "not_18_berlin" }) };
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Kein Service-Role-Key hinterlegt." }) };
  }
  const sbFetch = (path) =>
    fetch(SUPABASE_URL + "/rest/v1/" + path, { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey } });

  try {
    const ownersResp = await sbFetch("device_tokens?select=owner");
    if (!ownersResp.ok) throw new Error("Geraeteliste konnte nicht geladen werden (" + ownersResp.status + ")");
    const ownerRows = (await ownersResp.json()) || [];
    const owners = [...new Set(ownerRows.map((r) => r.owner))];
    if (!owners.length) return { statusCode: 200, headers, body: JSON.stringify({ owners: 0 }) };

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

    return { statusCode: 200, headers, body: JSON.stringify({ processed: results.length, results }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || "Serverfehler" }) };
  }
};
