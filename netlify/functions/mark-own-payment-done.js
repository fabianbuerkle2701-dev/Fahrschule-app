// Netlify Function: Fahrlehrer markiert die eigene Zahlung als erledigt (z.B. nach PayPal-Zahlung
// per Hand). Läuft bewusst NICHT mehr als direktes PostgREST-Update mit der eigenen Session (wie
// zuvor), sondern über den Service-Role-Key wie admin-set-subscription.js - sonst könnte jeder
// angemeldete Fahrlehrer per DevTools/eigenem Bearer-Token subscription_last_paid (oder mit einem
// manipulierten Request sogar andere Abo-Felder) beliebig setzen, ganz ohne echte Zahlung. Diese
// Funktion schreibt serverseitig NUR subscription_last_paid, NUR für den durch den Token
// identifizierten Nutzer selbst (kein targetUid-Parameter, keine Manipulation fremder Konten
// möglich), mit einem serverseitig berechneten Datum.
//
// Wichtig: Das bleibt eine Selbstauskunft ohne Zahlungsgateway-Abgleich (kein PayPal-Webhook/IPN
// vorhanden) - der zentrale App-Admin muss eingehende PayPal-Zahlungen weiterhin manuell mit den
// Konten abgleichen (Konten-Liste, admin-set-subscription.js) und Missbrauch dort erkennen. Ein
// echter automatischer Zahlungsabgleich bräuchte eine PayPal-Webhook-Integration (außerhalb des
// Umfangs dieser Funktion).

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdnVmdGxmbmtudWN4dW9ydGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDQ2NDQsImV4cCI6MjA5Njg4MDY0NH0.5ZoBdQLnJw23dMZ4IKmAauycVcPoVPIZdmNamZ8MEv8";

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

  const requesterToken = (event.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!requesterToken) return { statusCode: 401, headers, body: JSON.stringify({ error: "Nicht angemeldet" }) };

  try {
    const whoResp = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + requesterToken },
    });
    if (!whoResp.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: "Sitzung ungültig" }) };
    const who = await whoResp.json();
    if (!who || !who.id) return { statusCode: 401, headers, body: JSON.stringify({ error: "Sitzung ungültig" }) };

    // "Heute" aus deutscher Zeit, nicht UTC - sonst landet zwischen 0 und 2 Uhr nachts das
    // Vortagsdatum in der DB (gleiche Logik wie in admin-set-subscription.js). Bewusst serverseitig
    // berechnet statt vom Client übernommen, damit das Datum nicht manipulierbar ist.
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

    const updResp = await fetch(SUPABASE_URL + "/rest/v1/profiles?id=eq." + encodeURIComponent(who.id), {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ subscription_last_paid: today }),
    });
    if (!updResp.ok) {
      const errData = await updResp.json().catch(() => ({}));
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Speichern fehlgeschlagen: " + (errData.message || updResp.status) }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, subscription_last_paid: today }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
