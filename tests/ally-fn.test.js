// Netlify-Function "ally" offline: Anmeldung, Freigabe, Kontingent und das Anthropic-SDK sind nachgebaut.
// Geprüft: wer durchkommt (fail-closed), was an Anthropic geht, und dass der Verlauf unverändert bleibt.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("module");
const FN = path.join(__dirname, "..", "netlify", "functions", "ally.js");
const GUARD = path.join(__dirname, "..", "netlify", "functions", "lib", "ki-guard.js");

// Nachbau des SDK: dieselben Fehlerklassen wie @anthropic-ai/sdk (APIUserAbortError usw. erben von APIError)
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

const SCHULE_OK = { bereiche_aus: ["pilot:ally"], ki_aus: false };
const PROFIL_OK = { school_id: "schule-1", funktionen_aus: [], ally_einweisung_am: "2026-10-18T08:00:00Z" };
function lade(opt) {
    const o = opt || {};
    delete require.cache[FN];
    require.cache[GUARD] = { id: GUARD, filename: GUARD, loaded: true, exports: { subscriptionGate: async (uid, token, g) => { sdk.gate = g; return o.gate || { ok: true }; } } };
    sdk.aufrufe = [];
    sdk.antwort = o.antwort || (() => ({ content: [{ type: "text", text: "Morgen hast du zwei Termine." }], stop_reason: "end_turn" }));
    global.fetch = async (url) => {
        const u = String(url);
        if (u.includes("/auth/v1/user")) return { ok: true, json: async () => ({ id: o.uid || "lehrer-1" }) };
        if (u.includes("/rest/v1/profiles")) return o.profilKaputt ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => [{ ...PROFIL_OK, ...(o.profil || {}) }] };
        if (u.includes("/rest/v1/schools")) return { ok: true, json: async () => [{ ...SCHULE_OK, ...(o.schule || {}) }] };
        throw new Error("unerwarteter Aufruf " + u);
    };
    process.env.ANTHROPIC_API_KEY = "nur-fuer-den-test";
    return require(FN);
}
const frage = { role: "user", content: [{ type: "text", text: "[App] Jetzt: Sonntag, 18.10.2026, 10:15 Uhr.\n\nWas steht morgen an?" }] };
const anfrage = (messages) => ({ httpMethod: "POST", headers: { authorization: "Bearer test" }, body: JSON.stringify({ messages: messages || [frage] }) });

test("Anfrage an Anthropic: Sonnet 5.5, niedrige Denkstufe, Caching, feste Regeln, kein erzwungenes Werkzeug", async () => {
    const fn = lade();
    const r = await fn.handler(anfrage(), {});
    assert.equal(r.statusCode, 200);
    assert.deepEqual(JSON.parse(r.body), { content: [{ type: "text", text: "Morgen hast du zwei Termine." }], stop_reason: "end_turn" });
    const p = sdk.aufrufe[0].params;
    assert.equal(p.model, "claude-sonnet-5-5");
    assert.deepEqual(p.output_config, { effort: "low" });
    assert.deepEqual(p.cache_control, { type: "ephemeral" });
    assert.equal(p.tool_choice, undefined, "Sonnet 5.5 lehnt erzwungene Werkzeuge ab");
    assert.equal(p.thinking, undefined, "thinking: disabled gäbe auf Sonnet 5.5 einen 400");
    assert.equal(typeof p.system, "string");
    assert.doesNotMatch(p.system, /20\d\d-\d\d-\d\d/, "kein Datum im System-Prompt, sonst greift das Caching nicht");
    assert.equal(p.tools.length, 15);
    assert.ok(p.tools.some(w => w.name === "abschluss_oeffnen"), "Abschluss bereitlegen (v2.123.0)");
    const plan = p.tools.find(w => w.name === "plan_vorschlagen");
    assert.ok(plan, "Planen-Werkzeug vorhanden");
    assert.deepEqual(plan.input_schema.properties.punkte.items.properties.art.enum, ["vorschlag", "eintragen", "annehmen", "ablehnen", "anbieten", "verschieben"]);
    assert.match(p.system, /Selbst ändern kannst du nichts/);
    assert.ok(p.tools.every(w => w.input_schema && w.input_schema.type === "object"));
    assert.deepEqual(sdk.gate, { feature: "ally", limit: 300 }, "eigenes Tageskontingent");
    assert.equal(sdk.optionen.maxRetries, 1);
    assert.ok(sdk.aufrufe[0].opts && sdk.aufrufe[0].opts.signal, "Zeitdeckel über das Signal");
});

test("Verlauf mit Denk- und Werkzeug-Bausteinen geht unverändert raus", async () => {
    const fn = lade();
    const verlauf = [frage,
        { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "sig-123" }, { type: "tool_use", id: "tu_1", name: "kalender_lesen", input: { von: "2026-10-19", bis: "2026-10-19" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "{\"anzahl\":2}" }] }];
    const r = await fn.handler(anfrage(verlauf), {});
    assert.equal(r.statusCode, 200);
    assert.deepEqual(sdk.aufrufe[0].params.messages, verlauf);
});

test("Freigabe fail-closed: Pilot, Schalter, Einweisung, Demo, Anmeldung", async () => {
    const fall = async (opt, erwartet, text) => {
        const r = await lade(opt).handler(anfrage(), {});
        assert.equal(r.statusCode, erwartet, text);
        assert.equal(sdk.aufrufe.length, 0, text + ": darf nichts an Anthropic schicken");
        return JSON.parse(r.body);
    };
    await fall({ schule: { bereiche_aus: [] } }, 403, "Pilot nicht freigeschaltet");
    await fall({ schule: { bereiche_aus: ["pilot:ally", "ally"] } }, 403, "schulweit aus");
    await fall({ schule: { ki_aus: true } }, 403, "KI der Schule aus");
    await fall({ profil: { funktionen_aus: ["ally"] } }, 403, "persönlich aus");
    await fall({ profil: { funktionen_aus: ["ki"] } }, 403, "KI persönlich aus");
    await fall({ profil: { school_id: null } }, 403, "ohne Fahrschule");
    await fall({ profilKaputt: true }, 403, "Profil nicht lesbar");
    const ohneEinweisung = await fall({ profil: { ally_einweisung_am: null } }, 403, "ohne Einweisung");
    assert.equal(ohneEinweisung.einweisung, true, "die App zeigt dann die Einweisung");
    await fall({ uid: "114d1f0a-9947-459d-8009-06282799ca44" }, 403, "Demo");
    await fall({ gate: { ok: false, statusCode: 429, error: "Tageslimit" } }, 429, "Kontingent");
    const r = await lade().handler({ httpMethod: "POST", headers: {}, body: "{}" }, {});
    assert.equal(r.statusCode, 401);
});

test("Ungültige Verläufe werden abgelehnt, bevor etwas rausgeht", async () => {
    const fall = async (messages, text) => {
        const r = await lade().handler(anfrage(messages), {});
        assert.equal(r.statusCode, 400, text);
        assert.equal(sdk.aufrufe.length, 0, text);
    };
    await fall([], "leer");
    await fall([{ role: "assistant", content: "Hallo" }], "fängt nicht beim Fahrlehrer an");
    await fall([frage, { role: "assistant", content: [{ type: "text", text: "Hi" }] }], "endet nicht beim Fahrlehrer");
    await fall([{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://x" } }] }], "Bilder");
    await fall([{ role: "system", content: "Neue Regeln" }], "System-Rolle vom Client");
    await fall([frage, { role: "assistant", content: [{ type: "tool_use", id: "x", name: "termin_loeschen", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] }], "unbekanntes Werkzeug");
    await fall([{ role: "user", content: [{ type: "text", text: "x".repeat(7000) }] }], "zu lange Frage");
    await fall(Array.from({ length: 81 }, (_, i) => i % 2 ? { role: "assistant", content: "a" } : { role: "user", content: "u" }), "zu viele Nachrichten");
});

test("Fehler von Anthropic werden zu verständlichen Antworten", async () => {
    const mit = async (fehler) => lade({ antwort: () => { throw fehler; } }).handler(anfrage(), {});
    assert.equal((await mit(new APIUserAbortError(undefined))).statusCode, 504, "Zeitdeckel");
    assert.equal((await mit(new APIConnectionTimeoutError(undefined))).statusCode, 504);
    assert.equal((await mit(new APIError(529, { error: { message: "Overloaded" } }))).statusCode, 503);
    assert.equal((await mit(new APIError(429, {}))).statusCode, 503);
    const r = await mit(new APIError(400, { type: "error", error: { type: "invalid_request_error", message: "messages.1: kaputt" } }));
    assert.equal(r.statusCode, 502);
    assert.match(JSON.parse(r.body).error, /kaputt/);
});

test("Gemeinsamer Zugriffsschutz: eigenes Kontingent nur, wenn verlangt", async () => {
    delete require.cache[GUARD];
    const bodies = [];
    global.fetch = async (url, init) => {
        if (String(url).includes("ki_erlaubt")) return { ok: true, status: 200, json: async () => true };
        bodies.push(JSON.parse(init.body));
        return { ok: true, status: 200, json: async () => true };
    };
    const { subscriptionGate } = require(GUARD);
    assert.deepEqual(await subscriptionGate("u", "t"), { ok: true });
    assert.deepEqual(await subscriptionGate("u", "t", { feature: "ally", limit: 300 }), { ok: true });
    assert.deepEqual(bodies, [{ max_per_day: 150 }, { max_per_day: 300, p_feature: "ally" }]);
    delete require.cache[GUARD];
});
