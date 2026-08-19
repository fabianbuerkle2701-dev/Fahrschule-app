// Gemeinsame APNs-Versand-Logik fuer appointment-push-trigger.js und
// daily-appointment-reminders.js. Kein Endpoint fuer sich (Netlify erkennt nur Dateien direkt
// unter netlify/functions/ als Routen, dieser lib/-Ordner wird nur per require() genutzt).
//
// Bewusst kein Connection-Pooling wie z.B. node-apn: jeder Aufruf hier ist ein frischer,
// kurzlebiger Serverless-Invoke, eine kurze HTTP/2-Verbindung pro Sendevorgang ist dafuer das
// uebliche, empfohlene Muster (node-apn ist fuer langlebige Server mit Pooling gebaut).

const http2 = require("http2");
const jwt = require("jsonwebtoken");

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
const APNS_HOST = "https://api.push.apple.com"; // Produktions-APNs (passt zu TestFlight/App Store Signing)

// Ueberlebt nur innerhalb einer warmen Function-Instanz - Apple erlaubt ein Provider-Token
// bis zu 1h wiederzuverwenden, hier grosszuegig 50 Min als Sicherheitsabstand.
let cachedProviderToken = null;

function buildProviderToken() {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const privateKey = (process.env.APNS_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!keyId || !teamId || !privateKey) {
    throw new Error("APNs-Umgebungsvariablen fehlen (APNS_KEY_ID/APNS_TEAM_ID/APNS_PRIVATE_KEY).");
  }
  if (cachedProviderToken && Date.now() - cachedProviderToken.createdAt < 50 * 60 * 1000) {
    return cachedProviderToken.token;
  }
  const token = jwt.sign({ iss: teamId, iat: Math.floor(Date.now() / 1000) }, privateKey, {
    algorithm: "ES256",
    header: { alg: "ES256", kid: keyId },
  });
  cachedProviderToken = { token, createdAt: Date.now() };
  return token;
}

function sendOne(deviceToken, payload, bundleId, providerToken) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };

    const client = http2.connect(APNS_HOST);
    client.on("error", () => finish({ ok: false, status: 0 }));

    const req = client.request({
      ":method": "POST",
      ":path": "/3/device/" + deviceToken,
      authorization: "bearer " + providerToken,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    req.setEncoding("utf8");

    let status = 0;
    let body = "";
    req.on("response", (h) => { status = h[":status"]; });
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      client.close();
      let reason = null;
      try { reason = body ? JSON.parse(body).reason : null; } catch (e) { /* kein JSON-Body */ }
      finish({ ok: status === 200, status, reason });
    });
    req.on("error", () => finish({ ok: false, status: 0 }));

    req.write(JSON.stringify(payload));
    req.end();
  });
}

// Schickt eine Push-Benachrichtigung an alle Geraete eines Fahrlehrers. Tote Tokens (Apple
// meldet 410/"Unregistered" oder 400/"BadDeviceToken") werden danach automatisch aufgeraeumt.
async function sendApnsPush({ ownerId, title, body, data }) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bundleId = process.env.APNS_BUNDLE_ID || "com.allindrive.lehrer";
  if (!serviceKey) throw new Error("Kein Service-Role-Key hinterlegt.");

  const tokResp = await fetch(SUPABASE_URL + "/rest/v1/device_tokens?owner=eq." + ownerId + "&select=token", {
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
  });
  if (!tokResp.ok) throw new Error("Geraetetoken konnten nicht geladen werden (" + tokResp.status + ")");
  const rows = (await tokResp.json()) || [];
  if (!rows.length) return { sent: 0, total: 0 };

  const providerToken = buildProviderToken();
  const payload = { aps: { alert: { title, body }, sound: "default" }, data: data || {} };

  let sent = 0;
  const deadTokens = [];
  for (const row of rows) {
    const result = await sendOne(row.token, payload, bundleId, providerToken);
    if (result.ok) sent++;
    else if (result.status === 410 || (result.status === 400 && result.reason === "BadDeviceToken")) {
      deadTokens.push(row.token);
    }
  }

  if (deadTokens.length) {
    await fetch(
      SUPABASE_URL + "/rest/v1/device_tokens?owner=eq." + ownerId + "&token=in.(" + deadTokens.map(encodeURIComponent).join(",") + ")",
      { method: "DELETE", headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey } }
    ).catch(() => {});
  }

  return { sent, total: rows.length };
}

module.exports = { sendApnsPush };
