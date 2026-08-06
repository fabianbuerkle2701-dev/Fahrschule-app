// Netlify Function: liefert einen abonnierbaren Live-Kalender-Feed (ICS) der eigenen
// Termine eines Fahrlehrers, z.B. für Apple/Google Kalender. Öffentlich per GET erreichbar
// (Kalender-Apps können keine Bearer-Auth mitschicken) - abgesichert durch einen langen,
// zufälligen Token in der URL statt durch eine Session. Der Token liegt in einer eigenen,
// RLS-isolierten Tabelle (calendar_feeds), NICHT in profiles, weil profiles für alle
// eingeloggten Nutzer lesbar ist.

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";

const ART_LABELS = {
  "ÜST": "Übungsfahrt", "AB": "Autobahnfahrt", "LF": "Landstraßenfahrt",
  "NF": "Nachtfahrt", "PZ": "Prüfungsfahrt", "SF": "Sonderfahrt",
};

function pad(n) { return String(n).padStart(2, "0"); }
function toICSDate(iso) {
  const d = new Date(iso);
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
    "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
}
function icsEscape(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function foldLine(line) {
  // RFC 5545: Zeilen über 75 Oktett müssen umgebrochen werden (Fortsetzung mit einem Leerzeichen).
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length > 0) {
    out += "\r\n " + rest.slice(0, 74);
    rest = rest.slice(74);
  }
  return out;
}

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "text/calendar; charset=utf-8",
  };

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: { ...headers, "Content-Type": "text/plain" }, body: "Nur GET erlaubt" };
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return { statusCode: 500, headers: { ...headers, "Content-Type": "text/plain" }, body: "Kein Service-Role-Key hinterlegt." };
  }

  const token = (event.queryStringParameters && event.queryStringParameters.token) || "";
  if (!token || token.length < 20) {
    return { statusCode: 404, headers: { ...headers, "Content-Type": "text/plain" }, body: "Unbekannter oder ungültiger Kalender-Link." };
  }

  const sbFetch = (path) => fetch(SUPABASE_URL + "/rest/v1/" + path, {
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
  });

  try {
    const feedResp = await sbFetch("calendar_feeds?token=eq." + encodeURIComponent(token) + "&select=owner");
    if (!feedResp.ok) throw new Error("Feed-Lookup fehlgeschlagen (" + feedResp.status + ")");
    const feedRows = await feedResp.json();
    const owner = feedRows && feedRows[0] && feedRows[0].owner;
    if (!owner) {
      return { statusCode: 404, headers: { ...headers, "Content-Type": "text/plain" }, body: "Unbekannter oder widerrufener Kalender-Link." };
    }

    const now = new Date();
    const from = new Date(now.getTime() - 90 * 24 * 3600 * 1000).toISOString();
    const to = new Date(now.getTime() + 270 * 24 * 3600 * 1000).toISOString();

    const [apptResp, stuResp, profResp] = await Promise.all([
      sbFetch("appointments?owner=eq." + owner + "&status=eq.confirmed&start_at=gte." + from + "&start_at=lte." + to + "&select=id,student_id,title,start_at,end_at,art,note&order=start_at.asc"),
      sbFetch("students?owner=eq." + owner + "&select=id,data"),
      sbFetch("profiles?id=eq." + owner + "&select=display_name"),
    ]);
    if (!apptResp.ok) throw new Error("Termine konnten nicht geladen werden (" + apptResp.status + ")");
    const appts = await apptResp.json();
    const students = stuResp.ok ? await stuResp.json() : [];
    const profRows = profResp.ok ? await profResp.json() : [];

    const nameById = {};
    (students || []).forEach(s => {
      const d = s.data || {};
      const full = [((d.vorname || "").trim()), ((d.name || "").trim())].filter(Boolean).join(" ");
      nameById[s.id] = full || null;
    });

    const calName = (profRows && profRows[0] && profRows[0].display_name) || "Allindrive";
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Allindrive//Kalender-Abo//DE",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "X-WR-CALNAME:" + icsEscape(calName + " – Fahrstunden"),
      "X-WR-TIMEZONE:Europe/Berlin",
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
      "X-PUBLISHED-TTL:PT1H",
    ];
    (appts || []).forEach(a => {
      const artLabel = ART_LABELS[a.art] || a.art || "Fahrstunde";
      const stuName = a.student_id ? nameById[a.student_id] : null;
      const summary = stuName ? (artLabel + " – " + stuName) : (a.title || artLabel);
      lines.push("BEGIN:VEVENT");
      lines.push(foldLine("UID:allindrive-" + a.id + "@allindrive.netlify.app"));
      lines.push("DTSTAMP:" + toICSDate(new Date().toISOString()));
      lines.push("DTSTART:" + toICSDate(a.start_at));
      lines.push("DTEND:" + toICSDate(a.end_at || a.start_at));
      lines.push(foldLine("SUMMARY:" + icsEscape(summary)));
      if (a.note) lines.push(foldLine("DESCRIPTION:" + icsEscape(a.note)));
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");

    return { statusCode: 200, headers, body: lines.join("\r\n") + "\r\n" };
  } catch (e) {
    return { statusCode: 500, headers: { ...headers, "Content-Type": "text/plain" }, body: "Serverfehler: " + (e.message || "unbekannt") };
  }
};
