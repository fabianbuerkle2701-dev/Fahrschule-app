// Netlify-Function "pruefungssim-classify" offline: Anmeldung, KI-Freigabe und KI-Antwort sind nachgebaut.
// Geprüft wird der Modus "mehrfach" (ganzer Text → mehrere Beobachtungen) und dass der alte Einzelmodus bleibt.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const FN = path.join(__dirname, "..", "netlify", "functions", "pruefungssim-classify.js");
const GUARD = path.join(__dirname, "..", "netlify", "functions", "lib", "ki-guard.js");

function lade(antwort, opts) {
    const o = opts || {};
    delete require.cache[FN];
    require.cache[GUARD] = { id: GUARD, filename: GUARD, loaded: true, exports: { subscriptionGate: async () => ({ ok: true }) } };
    const protokoll = {};
    global.fetch = async (url, init) => {
        if (String(url).includes("/auth/v1/user")) return { ok: true, json: async () => ({ id: o.uid || "lehrer-test" }) };
        if (String(url).includes("api.anthropic.com")) {
            protokoll.anfrage = JSON.parse(init.body);
            return { ok: true, json: async () => antwort };
        }
        throw new Error("unerwarteter Aufruf " + url);
    };
    process.env.ANTHROPIC_API_KEY = "nur-fuer-den-test";
    return { fn: require(FN), protokoll };
}
const KATALOGE = {
    fahraufgaben: [{ id: "kreuzung", label: "Kreuzung" }, { id: "kreisverkehr", label: "Kreisverkehr" }],
    kompetenzbereiche: [{ id: "beobachtung", label: "Verkehrsbeobachtung" }, { id: "geschwindigkeit", label: "Geschwindigkeitsanpassung" }],
};
const anfrage = body => ({ httpMethod: "POST", headers: { authorization: "Bearer test" }, body: JSON.stringify(body) });

test("Mehrfach: erzwungenes Werkzeug, nur bekannte ids, Gutes und Schlechtes", async () => {
    const { fn, protokoll } = lade({ content: [{ type: "tool_use", input: { eintraege: [
        { art: "gut", kompetenzbereich: "beobachtung", fahraufgabe: "kreuzung", text: "Rechts vor links sicher beachtet" },
        { art: "leicht", kompetenzbereich: "geschwindigkeit", fahraufgabe: "kreisverkehr", text: "Im Kreisverkehr etwas zu schnell" },
        { art: "erfunden", kompetenzbereich: "gibtsnicht", fahraufgabe: "autobahn", text: "Seltsam" },
        { art: "gut", kompetenzbereich: "beobachtung", fahraufgabe: "keine", text: "   " },
    ] } }] });
    const r = await fn.handler(anfrage({ modus: "mehrfach", text: "Rechts vor links gut, Kreisverkehr zu schnell", ...KATALOGE }), {});
    assert.equal(r.statusCode, 200);
    const out = JSON.parse(r.body).eintraege;
    assert.equal(out.length, 3, "leerer Text fällt weg");
    assert.equal(JSON.stringify(out[2]), JSON.stringify({ art: "notiz", kompetenzbereich: null, fahraufgabe: null, text: "Seltsam" }), "Unbekanntes wird neutral");
    assert.equal(out[0].art, "gut");
    assert.equal(protokoll.anfrage.tool_choice.name, "beobachtungen");
    assert.match(protokoll.anfrage.messages[0].content, /Rechts vor links gut, Kreisverkehr zu schnell/);
});

test("Mehrfach: Kataloge nötig, Antwort ohne Werkzeug ist ein Fehler, Demo gesperrt", async () => {
    let r = await lade({}).fn.handler(anfrage({ modus: "mehrfach", text: "x" }), {});
    assert.equal(r.statusCode, 400);
    r = await lade({ content: [{ type: "text", text: "Hallo" }] }).fn.handler(anfrage({ modus: "mehrfach", text: "x", ...KATALOGE }), {});
    assert.equal(r.statusCode, 502);
    r = await lade({}, { uid: "114d1f0a-9947-459d-8009-06282799ca44" }).fn.handler(anfrage({ modus: "mehrfach", text: "x", ...KATALOGE }), {});
    assert.equal(r.statusCode, 403);
});

test("Einzelmodus bleibt wie bisher (ältere App-Stände)", async () => {
    const { fn } = lade({ content: [{ type: "text", text: JSON.stringify({ fahraufgabe: "kreuzung", kompetenzbereich: "beobachtung", schweregrad: "leicht", text: "Schulterblick vergessen", confidence: "hoch" }) }] });
    const r = await fn.handler(anfrage({ text: "Schulterblick vergessen", ...KATALOGE, schweregrade: [{ id: "leicht", label: "Leicht" }] }), {});
    assert.equal(r.statusCode, 200);
    assert.equal(JSON.parse(r.body).schweregrad, "leicht");
});
