// Netlify Function: Autopilot-Paket buchen oder wechseln (Fabian 21.10.2026). Nur der Fahrschul-Admin.
// Ohne Abo: Stripe-Checkout (Abo, monatlich, Preis aus app_settings.autopilot_preise) – das Paket trägt danach der
// Abgleich (stripe-webhook) ein, nie diese Function. Mit Abo: Wechsel Teilautonom ↔ Vollautonom im selben Abo
// (anteilig verrechnet); auch hier setzt erst der Abgleich das Paket.
// Schlüssel (STRIPE_SECRET_KEY) trägt Fabian bei Netlify ein; fehlt er, heißt es „noch nicht eingerichtet“.

const { dienst, benutzerAusToken } = require("./lib/dienst");
const { PAKETE, preisCent, rueckweg } = require("./lib/pakete");

const ADMIN_UID = "96530a9f-28ae-4ac6-9cfa-26de392ecf05";
const DEMO_UID = "114d1f0a-9947-459d-8009-06282799ca44";

function stripeClient(key) {
  const S = require("stripe");
  return (S.default || S)(key, { maxNetworkRetries: 1, timeout: 8000 });
}

// Produkt je Paket einmal anlegen und wiederfinden (Metadaten), damit ein Wechsel im Abo möglich ist
async function produktFuer(stripe, paket) {
  try {
    const treffer = await stripe.products.search({ query: "metadata['allindrive_paket']:'" + paket + "' AND active:'true'", limit: 1 });
    if (treffer && treffer.data && treffer.data[0]) return treffer.data[0].id;
  } catch (e) { /* Suche nicht verfügbar: dann neu anlegen */ }
  const p = await stripe.products.create({ name: "Allindrive Autopilot – " + PAKETE[paket].name, metadata: { allindrive_paket: paket } });
  return p.id;
}

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
  if (nutzer.id === DEMO_UID) return antwort(403, { error: "Im Demo-Modus lässt sich kein Paket buchen." });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!serviceKey) return antwort(500, { error: "Der Autopilot ist gerade nicht eingerichtet." });
  if (!stripeKey) return antwort(503, { error: "Bezahlen ist noch nicht eingerichtet. Die Pakete lassen sich bald buchen." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return antwort(400, { error: "Ungültige Anfrage" }); }
  const paket = String(body.paket || "");
  if (!PAKETE[paket]) return antwort(400, { error: "Unbekanntes Paket." });

  const db = dienst(serviceKey);
  let profil, schule, einstellungen;
  try {
    profil = ((await db.lesen("profiles?id=eq." + encodeURIComponent(nutzer.id) + "&select=school_id,school_admin")) || [])[0];
    if (profil && profil.school_id)
      schule = ((await db.lesen("schools?id=eq." + profil.school_id + "&select=id,name,autopilot_paket,autopilot_paket_bis,stripe_customer_id,stripe_subscription_id")) || [])[0];
    einstellungen = ((await db.lesen("app_settings?id=eq.1&select=autopilot_preise")) || [])[0] || {};
  } catch (e) {
    return antwort(503, { error: "Deine Fahrschule ließ sich gerade nicht laden. Bitte versuch es gleich noch einmal." });
  }
  if (!profil || !schule || !(profil.school_admin === true || nutzer.id === ADMIN_UID))
    return antwort(403, { error: "Pakete bucht der Fahrschul-Admin." });
  const cent = preisCent(einstellungen.autopilot_preise, paket);
  if (!cent) return antwort(409, { error: "Für dieses Paket ist noch kein Preis festgelegt." });

  const stripe = stripeClient(stripeKey);
  const ziel = rueckweg(event.headers && (event.headers.origin || event.headers.Origin));
  try {
    // Schon ein Abo: das Paket darin wechseln (Stripe verrechnet anteilig); eingetragen wird es über den Abgleich
    if (schule.stripe_subscription_id) {
      const abo = await stripe.subscriptions.retrieve(schule.stripe_subscription_id);
      if (abo && ["active", "trialing", "past_due"].indexOf(abo.status) >= 0) {
        if (abo.metadata && abo.metadata.paket === paket) return antwort(409, { error: "Dieses Paket ist schon gebucht." });
        const posten = abo.items && abo.items.data && abo.items.data[0];
        if (!posten) return antwort(502, { error: "Das Abo ließ sich nicht ändern. Bitte über „Paket verwalten“." });
        await stripe.subscriptions.update(abo.id, {
          items: [{ id: posten.id, price_data: { currency: "eur", product: await produktFuer(stripe, paket), unit_amount: cent, recurring: { interval: "month" } } }],
          proration_behavior: "create_prorations",
          metadata: { school_id: schule.id, paket },
        });
        return antwort(200, { gewechselt: true });
      }
    }
    const sitzung = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ quantity: 1, price_data: { currency: "eur", product: await produktFuer(stripe, paket), unit_amount: cent, recurring: { interval: "month" } } }],
      ...(schule.stripe_customer_id ? { customer: schule.stripe_customer_id } : { customer_email: nutzer.email || undefined }),
      client_reference_id: schule.id,
      metadata: { school_id: schule.id, paket },
      subscription_data: { metadata: { school_id: schule.id, paket } },
      locale: "de",
      success_url: ziel + "/einstellungen?paket=gebucht#pakete",
      cancel_url: ziel + "/einstellungen#pakete",
    });
    return antwort(200, { url: sitzung.url });
  } catch (e) {
    console.error("paket-buchen: Stripe " + ((e && (e.statusCode || e.type)) || "Fehler"));
    return antwort(502, { error: "Die Buchung ließ sich gerade nicht starten. Bitte versuch es gleich noch einmal." });
  }
};
