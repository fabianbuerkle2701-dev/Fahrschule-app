// Netlify-Function "support" (KI-Support, v2.125.0) offline: Anmeldung, KI-Schalter, Kontingent,
// Protokoll in support_anfragen und das Anthropic-SDK sind nachgebaut.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("module");
const FN = path.join(__dirname, "..", "netlify", "functions", "support.js");
const GUARD = path.join(__dirname, "..", "netlify", "functions", "lib", "ki-guard.js");

class APIError extends Error { constructor(status, body) { super(String(status)); this.status = status; this.error = body; } }
class APIUserAbortError extends APIError {}
class APIConnectionTimeoutError extends APIError {}
class APIConnectionError extends APIError {}
const sdk = { aufrufe: [], antwort: null };
class FakeAnthropic {
    constructor(optionen) { sdk.optionen = optionen; this.messages = { create: async (params, opts) => { sdk.aufrufe.push({ params, opts }); return sdk.antwort(params); } }; }
}
Object.assign(FakeAnthropic, { APIError, APIUserAbortError, APIConnectionTimeoutError, APIConnectionError });
const altLaden = Module._load;
Module._load = function (anfrage) { return anfrage === "@anthropic-ai/sdk" ? { default: FakeAnthropic } : altLaden.apply(this, arguments); };

const ID = "0b4b2c1e-6a7d-4c1e-9f00-1234567890ab";
let protokoll = [];
function lade(opt) {
    const o = opt || {};
    delete require.cache[FN];
    require.cache[GUARD] = { id: GUARD, filename: GUARD, loaded: true, exports: { subscriptionGate: async (uid, token, g) => { sdk.gate = g; return o.gate || { ok: true }; } } };
    sdk.aufrufe = [];
    protokoll = [];
    sdk.antwort = o.antwort || (() => ({ content: [{ type: "text", text: "1. Öffne Schüler.\n2. Tippe auf + Schüler." }], stop_reason: "end_turn" }));
    global.fetch = async (url, init) => {
        const u = String(url);
        if (u.includes("/auth/v1/user")) return { ok: true, json: async () => ({ id: o.uid || "lehrer-1" }) };
        if (u.includes("/rpc/support_verlauf_anhaengen")) {
            protokoll.push({ auth: init.headers.Authorization, body: JSON.parse(init.body) });
            if (o.protokollKaputt) return { ok: false, status: 500, json: async () => ({}) };
            return { ok: true, json: async () => (o.fremd ? false : true) };
        }
        throw new Error("unerwarteter Aufruf " + u);
    };
    process.env.ANTHROPIC_API_KEY = "nur-fuer-den-test";
    if (o.ohneServiceKey) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
    return require(FN);
}
const frage = { role: "user", content: [{ type: "text", text: "[App] Jetzt: Montag, 19.10.2026, 10:15 Uhr. Version 2.125.0. Gerät: iPhone-App. Seite: Schülerliste. Rolle: Fahrlehrer.\n\nWie lege ich einen Schüler an?" }] };
const anfrage = (messages, extra) => ({ httpMethod: "POST", headers: { authorization: "Bearer test" }, body: JSON.stringify({ anfrage_id: ID, messages: messages || [frage], ...(extra || {}) }) });

test("Anfrage an Anthropic: Sonnet 5.5, Caching, Regeln + Wissen, drei Werkzeuge, eigenes Kontingent ohne Abo-Pflicht", async () => {
    const fn = lade();
    const r = await fn.handler(anfrage(), {});
    assert.equal(r.statusCode, 200);
    const p = sdk.aufrufe[0].params;
    assert.equal(p.model, "claude-sonnet-5-5");
    assert.deepEqual(p.output_config, { effort: "low" });
    assert.deepEqual(p.cache_control, { type: "ephemeral" });
    assert.equal(p.tool_choice, undefined);
    assert.equal(p.thinking, undefined);
    assert.deepEqual(p.tools.map(w => w.name), ["konto_lesen", "zeigen", "weitergeben"]);
    assert.match(p.system, /Allindrive-Support: eine KI/);
    assert.match(p.system, /\nWISSEN\n/);
    assert.doesNotMatch(p.system, /20\d\d-\d\d-\d\d/, "kein Datum im System-Prompt, sonst greift das Caching nicht");
    assert.deepEqual(sdk.gate, { feature: "support", limit: 120, ohneAbo: true });
    assert.equal(sdk.optionen.maxRetries, 1);
});

test("Protokoll: Frage ohne die Zeile der App, dann die Antwort - mit dem Service-Schlüssel", async () => {
    const fn = lade();
    await fn.handler(anfrage(), {});
    assert.equal(protokoll.length, 2);
    assert.equal(protokoll[0].auth, "Bearer service-test");
    assert.deepEqual({ id: protokoll[0].body.p_id, user: protokoll[0].body.p_user, rolle: protokoll[0].body.p_eintraege[0].rolle, text: protokoll[0].body.p_eintraege[0].text, status: protokoll[0].body.p_status },
        { id: ID, user: "lehrer-1", rolle: "nutzer", text: "Wie lege ich einen Schüler an?", status: null });
    assert.equal(protokoll[1].body.p_eintraege[0].rolle, "ki");
    assert.match(protokoll[1].body.p_eintraege[0].text, /Tippe auf \+ Schüler/);
    assert.equal(protokoll[1].body.p_status, "beantwortet");
});

test("Werkzeug-Runden: keine neue Frage im Protokoll, und ein Werkzeug-Aufruf ist noch keine Antwort", async () => {
    const fn = lade({ antwort: () => ({ content: [{ type: "tool_use", id: "t2", name: "zeigen", input: { ziel: "liste" } }], stop_reason: "tool_use" }) });
    const verlauf = [frage,
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "konto_lesen", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{\"rolle\":\"Fahrlehrer\"}" }] }];
    const r = await fn.handler(anfrage(verlauf), {});
    assert.equal(r.statusCode, 200);
    assert.equal(protokoll.length, 0);
    assert.deepEqual(sdk.aufrufe[0].params.messages, verlauf, "Verlauf unverändert");
});

test("Fremde oder unbekannte Anfrage: 403, nichts geht an Anthropic", async () => {
    const fn = lade({ fremd: true });
    const r = await fn.handler(anfrage(), {});
    assert.equal(r.statusCode, 403);
    assert.equal(sdk.aufrufe.length, 0);
});

test("KI der Fahrschule aus: 403 mit ohne_ki, kein Protokoll, nichts an Anthropic", async () => {
    const fn = lade({ gate: { ok: false, statusCode: 403, error: "KI-Funktionen sind für deine Fahrschule ausgeschaltet." } });
    const r = await fn.handler(anfrage(), {});
    assert.equal(r.statusCode, 403);
    assert.equal(JSON.parse(r.body).ohne_ki, true);
    assert.equal(protokoll.length, 0);
    assert.equal(sdk.aufrufe.length, 0);
    const limit = await lade({ gate: { ok: false, statusCode: 429, error: "Tageslimit" } }).handler(anfrage(), {});
    assert.equal(limit.statusCode, 429);
    assert.equal(JSON.parse(limit.body).ohne_ki, false);
});

test("Eingangsprüfung: Anmeldung, Demo, Anfrage-Nummer, Verlauf, Einrichtung", async () => {
    assert.equal((await lade().handler({ httpMethod: "POST", headers: {}, body: "{}" }, {})).statusCode, 401);
    assert.equal((await lade({ uid: "114d1f0a-9947-459d-8009-06282799ca44" }).handler(anfrage(), {})).statusCode, 403);
    assert.equal((await lade().handler(anfrage(null, { anfrage_id: "keine-uuid" }), {})).statusCode, 400);
    assert.equal((await lade().handler(anfrage([{ role: "assistant", content: "x" }]), {})).statusCode, 400);
    assert.equal((await lade().handler(anfrage([{ role: "user", content: [{ type: "image", source: {} }] }]), {})).statusCode, 400);
    assert.equal((await lade({ ohneServiceKey: true }).handler(anfrage(), {})).statusCode, 500);
    const kaputt = await lade({ protokollKaputt: true }).handler(anfrage(), {});
    assert.equal(kaputt.statusCode, 503, "ohne Protokoll keine Antwort - der App-Admin soll jede Anfrage sehen");
});

test("Überlastung von Anthropic: 503 und ein Vermerk im Verlauf", async () => {
    const fn = lade({ antwort: () => { throw new APIError(529, {}); } });
    const r = await fn.handler(anfrage(), {});
    assert.equal(r.statusCode, 503);
    assert.equal(protokoll.length, 2);
    assert.deepEqual([protokoll[1].body.p_eintraege[0].rolle, protokoll[1].body.p_eintraege[0].text], ["system", "KI-Fehler 529"]);
});

test("neueFrage: nur Text des Fahrlehrers zählt, die Zeile der App fällt weg", () => {
    const fn = lade();
    assert.equal(fn.neueFrage([frage]), "Wie lege ich einen Schüler an?");
    assert.equal(fn.neueFrage([{ role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "{}" }] }]), null);
    assert.equal(fn.neueFrage([{ role: "user", content: "Ohne Zeile" }]), "Ohne Zeile");
});
