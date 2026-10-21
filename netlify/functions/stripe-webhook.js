// Netlify Function: Abgleich mit Stripe (Fabian 21.10.2026). Stripe meldet gebuchte, geänderte und gekündigte Abos;
// nur hier (Service-Schlüssel) wird das Paket der Fahrschule eingetragen – der Wächter guard_school_paket lässt es
// sonst niemanden setzen. Jede Meldung wird mit STRIPE_WEBHOOK_SECRET geprüft; unbekannte Ereignisse werden quittiert.
// In Stripe einzutragen (Fabian): Endpunkt …/.netlify/functions/stripe-webhook mit den Ereignissen
// checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted.

const { dienst } = require("./lib/dienst");
const { paketAusAbo } = require("./lib/pakete");

exports.handler = async function (event) {
  const antwort = (statusCode, daten) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(daten) });
  if (event.httpMethod !== "POST") return antwort(405, { error: "Nur POST erlaubt" });
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const geheim = process.env.STRIPE_WEBHOOK_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!stripeKey || !geheim || !serviceKey) return antwort(503, { error: "Nicht eingerichtet" });

  const S = require("stripe");
  const stripe = (S.default || S)(stripeKey, { maxNetworkRetries: 1, timeout: 8000 });
  const roh = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : Buffer.from(event.body || "", "utf8");
  const signatur = (event.headers && (event.headers["stripe-signature"] || event.headers["Stripe-Signature"])) || "";
  let e;
  try {
    e = stripe.webhooks.constructEvent(roh, signatur, geheim);
  } catch (err) {
    return antwort(400, { error: "Signatur ungültig" });
  }

  const db = dienst(serviceKey);
  // Abo → Fahrschule: über die Metadaten (beim Buchen gesetzt), sonst über die gespeicherte Abo-Kennung
  async function eintragen(abo, kunde) {
    const { paket, bis } = paketAusAbo(abo);
    let schule = abo.metadata && abo.metadata.school_id;
    if (!schule) {
      const t = ((await db.lesen("schools?stripe_subscription_id=eq." + encodeURIComponent(abo.id) + "&select=id")) || [])[0];
      schule = t && t.id;
    }
    if (!schule) return "unbekannt";
    await db.aendern("schools", "id=eq." + encodeURIComponent(schule), {
      autopilot_paket: paket, autopilot_paket_bis: bis,
      stripe_customer_id: kunde || abo.customer || null, stripe_subscription_id: paket ? abo.id : null,
    });
    return paket || "keins";
  }

  try {
    if (e.type === "checkout.session.completed") {
      const s = e.data.object;
      if (s.mode !== "subscription" || !s.subscription) return antwort(200, { ok: true, ignoriert: true });
      const abo = await stripe.subscriptions.retrieve(typeof s.subscription === "string" ? s.subscription : s.subscription.id);
      if (!abo.metadata || !abo.metadata.school_id) abo.metadata = { ...(abo.metadata || {}), ...(s.metadata || {}) };
      return antwort(200, { ok: true, paket: await eintragen(abo, typeof s.customer === "string" ? s.customer : s.customer && s.customer.id) });
    }
    if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].indexOf(e.type) >= 0) {
      const abo = e.data.object;
      if (e.type === "customer.subscription.deleted") abo.status = "canceled";
      return antwort(200, { ok: true, paket: await eintragen(abo, typeof abo.customer === "string" ? abo.customer : null) });
    }
    return antwort(200, { ok: true, ignoriert: true });
  } catch (err) {
    console.error("stripe-webhook: " + e.type + " " + ((err && (err.status || err.statusCode)) || "Fehler"));
    return antwort(500, { error: "Abgleich fehlgeschlagen" }); // Stripe versucht es später noch einmal
  }
};
