// KI-Fahrzeugsuche (Fabian 21.10.2026): Bausteine (lib/fahrzeug-ki.js) und die Function offline.
// Nachgebaut: Anmeldung und Profile (Supabase-REST), das Anthropic-SDK und der KI-Schalter (ki-guard).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("module");

const DIR = path.join(__dirname, "..", "netlify", "functions");
const sdk = { aufrufe: [], antworten: [] };
class FakeAnthropic {
    constructor() { this.messages = { create: async (params, opts) => { sdk.aufrufe.push({ params, opts }); const a = sdk.antworten.shift(); if (a instanceof Error) throw a; return a; } }; }
}
const altLaden = Module._load;
Module._load = function (anfrage) { return anfrage === "@anthropic-ai/sdk" ? { default: FakeAnthropic } : altLaden.apply(this, arguments); };
const GUARD = path.join(DIR, "lib", "ki-guard.js");
const gate = { ergebnis: { ok: true }, aufrufe: [] };
require.cache[GUARD] = { id: GUARD, filename: GUARD, loaded: true, exports: { subscriptionGate: async (uid, token, g) => { gate.aufrufe.push(g); return gate.ergebnis; } } };

const F = require(path.join(DIR, "lib", "fahrzeug-ki.js"));
const FN = () => require(path.join(DIR, "fahrzeug-ki.js"));

let opt;
function neu(o) {
    opt = o || {};
    sdk.aufrufe = []; sdk.antworten = []; gate.ergebnis = { ok: true }; gate.aufrufe = [];
    const profile = [{ id: "admin-1", school_id: "schule-1", school_admin: true }, { id: "lehrer-2", school_id: "schule-1", school_admin: false }];
    global.fetch = async (url) => {
        const u = new URL(String(url));
        if (u.pathname === "/auth/v1/user") return { ok: opt.uid !== null, status: opt.uid === null ? 401 : 200, json: async () => ({ id: opt.uid || "admin-1" }) };
        if (u.pathname === "/rest/v1/profiles") {
            const id = (u.searchParams.get("id") || "").replace(/^eq\./, "");
            return { ok: true, status: 200, json: async () => profile.filter((p) => p.id === id), text: async () => "" };
        }
        throw new Error("Unerwartet " + url);
    };
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
    process.env.ANTHROPIC_API_KEY = "nur-fuer-den-test";
}
const anfrage = (body) => ({ httpMethod: "POST", headers: { authorization: "Bearer nutzer-token" }, body: JSON.stringify(body) });
const json = { erkannt: "VW Golf 8 1.5 eTSI (2021)", sicher: true, service_km: 15000, service_monate: 12, hu_monate: 24,
    hinweis: "Fester Service für viel Stadtverkehr.", quellen: [{ titel: "Volkswagen Service", url: "https://www.volkswagen.de/service" }] };

test("Bausteine: Nachricht, JSON aus geteiltem Text, Zitate, Grenzen und Quellen", () => {
    assert.equal(F.nachricht({ name: " VW Golf  8 ", typ: "Schaltwagen", km: 41234.4 }), "Fahrzeug: VW Golf 8 (Schaltwagen), Kilometerstand 41234 km");
    assert.deepEqual(F.jsonAusText('Ich habe nachgesehen. {"erkannt":"Golf","sicher":true} Fertig.'), { erkannt: "Golf", sicher: true });
    assert.equal(F.jsonAusText("kein JSON"), null);
    assert.equal(F.jsonAusText("[1,2]"), null);
    const zitate = F.zitateAus([{ type: "text", text: "a", citations: [{ url: "https://www.adac.de/x", title: "ADAC" }] }, { type: "server_tool_use" }]);
    assert.deepEqual(zitate, [{ titel: "ADAC", url: "https://www.adac.de/x" }]);
    const e = F.ergebnisPruefen({ erkannt: "Golf", sicher: "ja", service_km: 999999, service_monate: 12.4, hu_monate: 6, hinweis: "x".repeat(500),
        quellen: [{ titel: "", url: "http://unsicher.de" }, { titel: "", url: "javascript:alert(1)" }, { url: "https://www.volkswagen.de/a" }] }, zitate);
    assert.equal(e.sicher, false, "nur echtes true zählt");
    assert.equal(e.service_km, null, "unplausibel");
    assert.equal(e.service_monate, 12);
    assert.equal(e.hu_monate, null);
    assert.equal(e.hinweis.length, 300);
    assert.deepEqual(e.quellen, [{ titel: "volkswagen.de", url: "https://www.volkswagen.de/a" }, { titel: "ADAC", url: "https://www.adac.de/x" }]);
});

test("Function: nur Admin, Demo gesperrt, KI-Schalter, Name nötig", async () => {
    neu({ uid: null });
    assert.equal((await FN().handler(anfrage({ name: "Golf" }), {})).statusCode, 401);
    neu({ uid: "114d1f0a-9947-459d-8009-06282799ca44" });
    assert.equal((await FN().handler(anfrage({ name: "Golf" }), {})).statusCode, 403);
    neu({ uid: "lehrer-2" });
    let r = await FN().handler(anfrage({ name: "Golf" }), {});
    assert.equal(r.statusCode, 403);
    assert.match(JSON.parse(r.body).error, /Fahrschul-Admin/);
    neu();
    assert.equal((await FN().handler(anfrage({ name: "G" }), {})).statusCode, 400);
    neu();
    gate.ergebnis = { ok: false, statusCode: 403, error: "aus" };
    r = await FN().handler(anfrage({ name: "VW Golf" }), {});
    assert.equal(r.statusCode, 403);
    assert.match(JSON.parse(r.body).error, /KI ist für deine Fahrschule ausgeschaltet/);
    assert.equal(sdk.aufrufe.length, 0);
});

test("Function: Websuche, pause_turn geht weiter, Ergebnis geprüft", async () => {
    neu();
    sdk.antworten.push({ stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "VW Golf 8 Inspektion" } }] });
    sdk.antworten.push({ stop_reason: "end_turn", content: [
        { type: "text", text: "Laut Hersteller ", citations: [{ url: "https://www.adac.de/golf", title: "ADAC Golf 8" }] },
        { type: "text", text: JSON.stringify(json) },
    ] });
    const r = await FN().handler(anfrage({ name: "VW Golf 8 1.5 eTSI", typ: "Schaltwagen", km: 41234 }), {});
    assert.equal(r.statusCode, 200);
    const e = JSON.parse(r.body);
    assert.equal(e.service_km, 15000);
    assert.equal(e.hu_monate, 24);
    assert.equal(e.quellen.length, 2);
    assert.equal(sdk.aufrufe.length, 2, "nach pause_turn ein zweiter Aufruf");
    const p = sdk.aufrufe[0].params;
    assert.equal(p.tools[0].type, "web_search_20250305");
    assert.equal(p.tools[0].max_uses, 2);
    assert.equal(p.tools[0].user_location.country, "DE");
    assert.match(p.messages[0].content, /VW Golf 8 1\.5 eTSI \(Schaltwagen\), Kilometerstand 41234 km/);
    assert.equal(sdk.aufrufe[1].params.messages.length, 2, "die pausierte Antwort geht zurück, ohne neue Frage");
    assert.deepEqual(gate.aufrufe[0], { feature: "fahrzeug", limit: 30, ohneAbo: true });
});

test("Function: kein JSON, Zeitüberschreitung und API-Fehler werden verständlich gemeldet", async () => {
    neu();
    sdk.antworten.push({ stop_reason: "end_turn", content: [{ type: "text", text: "Dazu habe ich nichts gefunden." }] });
    let r = await FN().handler(anfrage({ name: "Fantasieauto" }), {});
    assert.equal(r.statusCode, 502);
    neu();
    sdk.antworten.push(Object.assign(new Error("abgebrochen"), { name: "TimeoutError" }));
    r = await FN().handler(anfrage({ name: "VW Golf" }), {});
    assert.equal(r.statusCode, 504);
    assert.match(JSON.parse(r.body).error, /nicht rechtzeitig/);
    neu();
    sdk.antworten.push(Object.assign(new Error("überlastet"), { status: 529 }));
    r = await FN().handler(anfrage({ name: "VW Golf" }), {});
    assert.equal(r.statusCode, 502);
    assert.match(JSON.parse(r.body).error, /selbst ein/);
});
