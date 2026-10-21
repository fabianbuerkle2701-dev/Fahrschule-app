// Autopilot-Pakete (Fabian 21.10.2026): Bausteine (lib/pakete.js) und die Stripe-Functions offline.
// Nachgebaut: Anmeldung und Tabellen (Supabase-REST) sowie das Stripe-SDK.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("module");

const DIR = path.join(__dirname, "..", "netlify", "functions");
const stripe = { aufrufe: [], abo: null, signaturOk: true, ereignis: null };
function FakeStripe(key) {
    stripe.key = key;
    const merken = (name, erg) => async (...a) => { stripe.aufrufe.push({ name, a }); return typeof erg === "function" ? erg(...a) : erg; };
    return {
        products: { search: merken("products.search", { data: [{ id: "prod_voll" }] }), create: merken("products.create", { id: "prod_neu" }) },
        checkout: { sessions: { create: merken("checkout.create", { url: "https://checkout.stripe.test/s1" }) } },
        billingPortal: { sessions: { create: merken("portal.create", { url: "https://billing.stripe.test/p1" }) } },
        subscriptions: { retrieve: merken("subscriptions.retrieve", () => stripe.abo), update: merken("subscriptions.update", { id: "sub_1" }) },
        webhooks: { constructEvent: (roh, sig, geheim) => { if (!stripe.signaturOk || !sig) throw new Error("bad"); return stripe.ereignis; } },
    };
}
const altLaden = Module._load;
Module._load = function (anfrage) { return anfrage === "stripe" ? FakeStripe : altLaden.apply(this, arguments); };

const P = require(path.join(DIR, "lib", "pakete.js"));
const BUCHEN = () => require(path.join(DIR, "paket-buchen.js"));
const VERWALTEN = () => require(path.join(DIR, "paket-verwalten.js"));
const WEBHOOK = () => require(path.join(DIR, "stripe-webhook.js"));

let T, opt;
function neu(o) {
    opt = o || {};
    stripe.aufrufe = []; stripe.abo = null; stripe.signaturOk = true; stripe.ereignis = null;
    T = {
        profiles: [{ id: "admin-1", school_id: "schule-1", school_admin: true }, { id: "buero-2", school_id: "schule-1", school_admin: false }],
        schools: [{ id: "schule-1", name: "Fahrschule Test", autopilot_paket: null, autopilot_paket_bis: null, stripe_customer_id: opt.kunde || null, stripe_subscription_id: opt.abo || null }],
        app_settings: [{ id: 1, autopilot_preise: opt.preise === undefined ? { teilautonom: 29, vollautonom: 59 } : opt.preise }],
    };
    global.fetch = async (url, init) => {
        const u = new URL(String(url));
        if (u.pathname === "/auth/v1/user") return { ok: opt.uid !== null, status: opt.uid === null ? 401 : 200, json: async () => ({ id: opt.uid || "admin-1", email: "admin@fahrschule-test.de" }) };
        const tabelle = u.pathname.slice(9);
        const filter = [...u.searchParams].filter(([k]) => !["select", "limit", "order"].includes(k));
        const treffer = (T[tabelle] || []).filter((z) => filter.every(([k, v]) => String(z[k]) === v.replace(/^eq\./, "")));
        if (!init || !init.method || init.method === "GET") return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(treffer)), text: async () => "" };
        if (init.method === "PATCH") { const d = JSON.parse(init.body); treffer.forEach((z) => Object.assign(z, d)); return { ok: true, status: 204, json: async () => null, text: async () => "" }; }
        throw new Error("Unerwartet " + init.method + " " + url);
    };
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
    if (opt.ohneStripe) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = "sk_test_nur_hier";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
}
const anfrage = (body, origin) => ({ httpMethod: "POST", headers: { authorization: "Bearer t", origin }, body: JSON.stringify(body) });

test("Bausteine: Preis in Cent, Rückweg nur zu bekannten Adressen, Paket aus dem Abo", () => {
    assert.equal(P.preisCent({ teilautonom: 29.9 }, "teilautonom"), 2990);
    assert.equal(P.preisCent({ teilautonom: 0 }, "teilautonom"), null);
    assert.equal(P.preisCent({}, "vollautonom"), null);
    assert.equal(P.rueckweg("http://localhost:5240"), "http://localhost:5240");
    assert.equal(P.rueckweg("https://boese.example"), "https://autopilot.allindrive.app");
    const ende = Math.floor(Date.parse("2026-11-21T10:00:00Z") / 1000);
    assert.deepEqual(P.paketAusAbo({ status: "active", metadata: { paket: "vollautonom" }, items: { data: [{ current_period_end: ende }] } }),
        { paket: "vollautonom", bis: "2026-11-21T10:00:00.000Z" });
    assert.equal(P.paketAusAbo({ status: "canceled", metadata: { paket: "vollautonom" }, current_period_end: ende }).paket, null);
    assert.equal(P.paketAusAbo({ status: "active", metadata: { paket: "luxus" } }).paket, null);
    assert.ok(P.AUTONOMIE.includes("werkstatt_termine"));
});

test("Buchen: nur Admin, ohne Schlüssel „noch nicht eingerichtet“, ohne Preis kein Checkout", async () => {
    neu({ uid: null });
    assert.equal((await BUCHEN().handler(anfrage({ paket: "teilautonom" }))).statusCode, 401);
    neu({ ohneStripe: true });
    let r = await BUCHEN().handler(anfrage({ paket: "teilautonom" }));
    assert.equal(r.statusCode, 503);
    assert.match(JSON.parse(r.body).error, /noch nicht eingerichtet/);
    neu({ uid: "buero-2" });
    assert.equal((await BUCHEN().handler(anfrage({ paket: "teilautonom" }))).statusCode, 403);
    neu({ preise: {} });
    r = await BUCHEN().handler(anfrage({ paket: "vollautonom" }));
    assert.equal(r.statusCode, 409);
    neu();
    assert.equal((await BUCHEN().handler(anfrage({ paket: "luxus" }))).statusCode, 400);
});

test("Buchen: Checkout mit Preis aus den Einstellungen, Metadaten und sicherem Rückweg", async () => {
    neu();
    const r = await BUCHEN().handler(anfrage({ paket: "vollautonom" }, "https://boese.example"));
    assert.equal(r.statusCode, 200);
    assert.equal(JSON.parse(r.body).url, "https://checkout.stripe.test/s1");
    const c = stripe.aufrufe.find((x) => x.name === "checkout.create").a[0];
    assert.equal(c.mode, "subscription");
    assert.equal(c.line_items[0].price_data.unit_amount, 5900);
    assert.equal(c.line_items[0].price_data.recurring.interval, "month");
    assert.deepEqual(c.subscription_data.metadata, { school_id: "schule-1", paket: "vollautonom" });
    assert.equal(c.customer_email, "admin@fahrschule-test.de");
    assert.match(c.success_url, /^https:\/\/autopilot\.allindrive\.app\/einstellungen/);
    assert.equal(T.schools[0].autopilot_paket, null, "eingetragen wird erst über den Abgleich");
});

test("Buchen mit bestehendem Abo: Wechsel im Abo, gleiches Paket abgelehnt", async () => {
    neu({ kunde: "cus_1", abo: "sub_1" });
    stripe.abo = { id: "sub_1", status: "active", metadata: { paket: "teilautonom", school_id: "schule-1" }, items: { data: [{ id: "si_1" }] } };
    let r = await BUCHEN().handler(anfrage({ paket: "vollautonom" }));
    assert.equal(r.statusCode, 200);
    assert.equal(JSON.parse(r.body).gewechselt, true);
    const u = stripe.aufrufe.find((x) => x.name === "subscriptions.update").a;
    assert.equal(u[0], "sub_1");
    assert.equal(u[1].items[0].id, "si_1");
    assert.equal(u[1].items[0].price_data.unit_amount, 5900);
    assert.equal(u[1].metadata.paket, "vollautonom");
    assert.equal(stripe.aufrufe.some((x) => x.name === "checkout.create"), false);
    neu({ kunde: "cus_1", abo: "sub_1" });
    stripe.abo = { id: "sub_1", status: "active", metadata: { paket: "vollautonom" }, items: { data: [{ id: "si_1" }] } };
    r = await BUCHEN().handler(anfrage({ paket: "vollautonom" }));
    assert.equal(r.statusCode, 409);
});

test("Verwalten: Portal nur mit Kunde der eigenen Fahrschule", async () => {
    neu();
    assert.equal((await VERWALTEN().handler(anfrage({}))).statusCode, 409);
    neu({ kunde: "cus_1" });
    const r = await VERWALTEN().handler(anfrage({}, "http://localhost:5240"));
    assert.equal(JSON.parse(r.body).url, "https://billing.stripe.test/p1");
    const p = stripe.aufrufe.find((x) => x.name === "portal.create").a[0];
    assert.equal(p.customer, "cus_1");
    assert.equal(p.return_url, "http://localhost:5240/einstellungen#pakete");
});

test("Abgleich: Signatur geprüft, Paket über Checkout und Abo-Änderungen, Kündigung", async () => {
    neu();
    stripe.signaturOk = false;
    assert.equal((await WEBHOOK().handler({ httpMethod: "POST", headers: { "stripe-signature": "x" }, body: "{}" })).statusCode, 400);
    neu();
    const ende = Math.floor(Date.now() / 1000) + 30 * 86400;
    stripe.abo = { id: "sub_9", status: "active", customer: "cus_9", metadata: { school_id: "schule-1", paket: "teilautonom" }, items: { data: [{ current_period_end: ende }] } };
    stripe.ereignis = { type: "checkout.session.completed", data: { object: { mode: "subscription", subscription: "sub_9", customer: "cus_9", metadata: { school_id: "schule-1", paket: "teilautonom" } } } };
    let r = await WEBHOOK().handler({ httpMethod: "POST", headers: { "stripe-signature": "t=1,v1=x" }, body: "{}" });
    assert.equal(r.statusCode, 200);
    assert.equal(T.schools[0].autopilot_paket, "teilautonom");
    assert.equal(T.schools[0].stripe_customer_id, "cus_9");
    assert.equal(T.schools[0].stripe_subscription_id, "sub_9");
    assert.ok(T.schools[0].autopilot_paket_bis);
    // Wechsel auf Vollautonom (Metadaten), dann Kündigung
    stripe.ereignis = { type: "customer.subscription.updated", data: { object: { id: "sub_9", status: "active", customer: "cus_9", metadata: { school_id: "schule-1", paket: "vollautonom" }, current_period_end: ende } } };
    await WEBHOOK().handler({ httpMethod: "POST", headers: { "stripe-signature": "t=1,v1=x" }, body: "{}" });
    assert.equal(T.schools[0].autopilot_paket, "vollautonom");
    stripe.ereignis = { type: "customer.subscription.deleted", data: { object: { id: "sub_9", status: "active", customer: "cus_9", metadata: { school_id: "schule-1", paket: "vollautonom" } } } };
    await WEBHOOK().handler({ httpMethod: "POST", headers: { "stripe-signature": "t=1,v1=x" }, body: "{}" });
    assert.equal(T.schools[0].autopilot_paket, null);
    assert.equal(T.schools[0].stripe_subscription_id, null);
    assert.equal(T.schools[0].stripe_customer_id, "cus_9", "Kunde bleibt für einen neuen Kauf");
    stripe.ereignis = { type: "invoice.paid", data: { object: {} } };
    r = await WEBHOOK().handler({ httpMethod: "POST", headers: { "stripe-signature": "t=1,v1=x" }, body: "{}" });
    assert.equal(JSON.parse(r.body).ignoriert, true);
});
