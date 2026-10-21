// Netlify Function: Autopilot-Paket verwalten (Fabian 21.10.2026) – öffnet das Stripe-Kundenportal (Zahlungsart,
// Rechnungen, Kündigung). Nur der Fahrschul-Admin, nur mit bestehendem Stripe-Kunden der eigenen Fahrschule.

const { dienst, benutzerAusToken } = require("./lib/dienst");
const { rueckweg } = require("./lib/pakete");

const ADMIN_UID = "96530a9f-28ae-4ac6-9cfa-26de392ecf05";
const DEMO_UID = "114d1f0a-9947-459d-8009-06282799ca44";

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
  const antwort = (statusCode, daten) => ({ statusCode, headers, body: JSON.stringify(daten) });
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return antwort(405, { error: "Nur POST erlaubt" });

  const token = ((event.headers && event.headers.authorization) || "").replace(/^Bearer\s+/i, "");
  const nutzer = await benutzerAusToken(token);
  if (!nutzer) return antwort(401, { error: "Nicht angemeldet" });
  if (nutzer.id === DEMO_UID) return antwort(403, { error: "Im Demo-Modus gibt es kein Paket." });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!serviceKey) return antwort(500, { error: "Der Autopilot ist gerade nicht eingerichtet." });
  if (!stripeKey) return antwort(503, { error: "Bezahlen ist noch nicht eingerichtet." });

  const db = dienst(serviceKey);
  let profil, schule;
  try {
    profil = ((await db.lesen("profiles?id=eq." + encodeURIComponent(nutzer.id) + "&select=school_id,school_admin")) || [])[0];
    if (profil && profil.school_id)
      schule = ((await db.lesen("schools?id=eq." + profil.school_id + "&select=id,stripe_customer_id")) || [])[0];
  } catch (e) {
    return antwort(503, { error: "Deine Fahrschule ließ sich gerade nicht laden. Bitte versuch es gleich noch einmal." });
  }
  if (!profil || !schule || !(profil.school_admin === true || nutzer.id === ADMIN_UID))
    return antwort(403, { error: "Das Paket verwaltet der Fahrschul-Admin." });
  if (!schule.stripe_customer_id) return antwort(409, { error: "Es ist noch kein Paket gebucht." });

  try {
    const S = require("stripe");
    const stripe = (S.default || S)(stripeKey, { maxNetworkRetries: 1, timeout: 8000 });
    const portal = await stripe.billingPortal.sessions.create({
      customer: schule.stripe_customer_id,
      return_url: rueckweg(event.headers && (event.headers.origin || event.headers.Origin)) + "/einstellungen#pakete",
      locale: "de",
    });
    return antwort(200, { url: portal.url });
  } catch (e) {
    console.error("paket-verwalten: Stripe " + ((e && (e.statusCode || e.type)) || "Fehler"));
    return antwort(502, { error: "Die Verwaltung ließ sich gerade nicht öffnen. Bitte versuch es gleich noch einmal." });
  }
};
