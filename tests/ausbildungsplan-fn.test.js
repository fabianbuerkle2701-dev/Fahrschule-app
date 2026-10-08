// Netlify-Function "ausbildungsplan" offline: Anmeldung, KI-Freigabe und KI-Antwort sind nachgebaut.
// Geprüft wird, was der Server selbst garantiert: nur bekannte Planpunkte, jeder einmal, Minuten
// begrenzt, Summe passt in die Stunde, Demo gesperrt, KI-Ausfall sauber gemeldet.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const FN = path.join(__dirname, "..", "netlify", "functions", "ausbildungsplan.js");
const GUARD = path.join(__dirname, "..", "netlify", "functions", "lib", "ki-guard.js");

function lade(ki, opts) {
    const o = opts || {};
    delete require.cache[FN];
    require.cache[GUARD] = { id: GUARD, filename: GUARD, loaded: true, exports: { subscriptionGate: async () => o.gate || { ok: true } } };
    const protokoll = {};
    global.fetch = async (url, init) => {
        if (String(url).includes("/auth/v1/user")) return { ok: true, json: async () => ({ id: o.uid || "lehrer-test" }) };
        if (String(url).includes("api.anthropic.com")) {
            protokoll.anfrage = JSON.parse(init.body);
            if (ki instanceof Error) throw ki;
            return { ok: true, json: async () => ({ content: [{ type: "tool_use", input: ki }] }) };
        }
        throw new Error("unerwarteter Aufruf " + url);
    };
    process.env.ANTHROPIC_API_KEY = "nur-fuer-den-test";
    return { fn: require(FN), protokoll };
}
const anfrage = (daten, modus) => ({ httpMethod: "POST", headers: { authorization: "Bearer test" }, body: JSON.stringify({ modus: modus || "plan", daten }) });
const KANDIDATEN = [
    { key: "bvf_ls_rvl#0", titel: "Rechts vor links", sektion: "Leistungsstufe", art: "wiederholen", grund: "zweimal weiter üben", minuten: 15 },
    { key: "bvf_ls_abbiegen#1", titel: "Abbiegen", sektion: "Leistungsstufe", art: "neu", grund: "nächster Punkt", minuten: 25 },
    { key: "f-tempo#2", titel: "Fokus: Geschwindigkeit", sektion: "Auffälligkeit", art: "fokus", grund: "dreimal schwach", minuten: 10 },
];

test("Plan: unbekannte und doppelte Punkte fliegen raus, Summe passt in die Stunde", async () => {
    const { fn, protokoll } = lade({ zusammenfassung: "Erst festigen, dann Neues.", plan: [
        { key: "bvf_ls_rvl#0", minuten: 200, grund: "zuerst", tipp: "laut ankündigen" },
        { key: "erfunden#9", minuten: 20, grund: "gibt es nicht" },
        { key: "bvf_ls_rvl#0", minuten: 10, grund: "doppelt" },
        { key: "bvf_ls_abbiegen#1", minuten: 40, grund: "danach" },
    ] });
    const r = await fn.handler(anfrage({ vorname: "Lena", dauer: 45, reserve: 5, kandidaten: KANDIDATEN }), {});
    assert.equal(r.statusCode, 200);
    const out = JSON.parse(r.body);
    assert.deepEqual(out.plan.map(p => p.key), ["bvf_ls_rvl#0", "bvf_ls_abbiegen#1"]);
    assert.ok(out.plan.reduce((s, p) => s + p.minuten, 0) <= 40, "höchstens Dauer minus Reserve");
    assert.ok(out.plan.every(p => p.minuten >= 5 && p.minuten <= 120));
    assert.equal(protokoll.anfrage.tool_choice.name, "fahrstundenplan", "erzwungenes Werkzeug statt Freitext");
    assert.match(protokoll.anfrage.messages[0].content, /höchstens 40 Minuten/);
});

test("Plan: KI liefert nur Unbekanntes -> Fehler, der Client behält den Regelplan", async () => {
    const { fn } = lade({ zusammenfassung: "x", plan: [{ key: "erfunden#1", minuten: 20, grund: "?" }] });
    const r = await fn.handler(anfrage({ dauer: 90, kandidaten: KANDIDATEN }), {});
    assert.equal(r.statusCode, 502);
});

test("Abschluss: Texte gekürzt, unbekannter Status wird zu „nicht“", async () => {
    const { fn, protokoll } = lade({ gut: "Rechts vor links sitzt.", naechstes: "Abbiegen weiter üben." });
    const r = await fn.handler(anfrage({ vorname: "Lena", ergebnisse: [{ titel: "Rechts vor links", status: "sitzt" }, { titel: "Abbiegen", status: "quatsch" }] }, "abschluss"), {});
    assert.equal(r.statusCode, 200);
    assert.deepEqual(JSON.parse(r.body), { gut: "Rechts vor links sitzt.", naechstes: "Abbiegen weiter üben." });
    assert.match(protokoll.anfrage.messages[0].content, /"status":"nicht"/);
});

test("Demo-Konto gesperrt, KI-Sperre der Fahrschule greift, KI-Ausfall wird sauber gemeldet", async () => {
    let r = await lade({}, { uid: "114d1f0a-9947-459d-8009-06282799ca44" }).fn.handler(anfrage({ kandidaten: KANDIDATEN }), {});
    assert.equal(r.statusCode, 403);
    r = await lade({}, { gate: { ok: false, statusCode: 403, error: "KI ist für deine Fahrschule ausgeschaltet." } }).fn.handler(anfrage({ kandidaten: KANDIDATEN }), {});
    assert.equal(r.statusCode, 403);
    r = await lade(new Error("netz weg")).fn.handler(anfrage({ kandidaten: KANDIDATEN }), {});
    assert.equal(r.statusCode, 502);
    assert.ok(JSON.parse(r.body).error);
    r = await lade({}).fn.handler({ httpMethod: "POST", headers: {}, body: "{}" }, {});
    assert.equal(r.statusCode, 401, "ohne Anmeldung nichts");
});
