// Netlify-Function "pruefreife-einschaetzung" offline: Anmeldung, KI-Freigabe und KI-Antwort sind nachgebaut.
// Geprüft wird, dass das Ergebnis der letzten Prüfungssimulation (5 Prüfkriterien) gekappt im Prompt ankommt.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const FN = path.join(__dirname, "..", "netlify", "functions", "pruefreife-einschaetzung.js");
const GUARD = path.join(__dirname, "..", "netlify", "functions", "lib", "ki-guard.js");

function lade() {
    delete require.cache[FN];
    require.cache[GUARD] = { id: GUARD, filename: GUARD, loaded: true, exports: { subscriptionGate: async () => ({ ok: true }) } };
    const protokoll = {};
    global.fetch = async (url, init) => {
        if (String(url).includes("/auth/v1/user")) return { ok: true, json: async () => ({ id: "lehrer-test" }) };
        if (String(url).includes("api.anthropic.com")) {
            protokoll.anfrage = JSON.parse(init.body);
            return { ok: true, json: async () => ({ content: [{ type: "text", text: "Noch nicht bereit." }] }) };
        }
        throw new Error("unerwarteter Aufruf " + url);
    };
    process.env.ANTHROPIC_API_KEY = "nur-fuer-den-test";
    return { fn: require(FN), protokoll };
}
const anfrage = body => ({ httpMethod: "POST", headers: { authorization: "Bearer test" }, body: JSON.stringify(body) });

test("Letzte Prüfungssimulation: Ergebnis und Stufen landen gekappt im Prompt", async () => {
    const { fn, protokoll } = lade();
    const stufen = [{ kriterium: "Verkehrsbeobachtung", stufe: "Ungenügend" }, { kriterium: "Kommunikation", stufe: "Gut" }];
    for (let i = 0; i < 6; i++) stufen.push({ kriterium: "x".repeat(200), stufe: "Gut" });
    const r = await fn.handler(anfrage({ student: { name: "Test Schüler", pruefungssimulation: {
        anzahl: 2, letzteAm: "2026-10-13", gesamt: { leicht: 1, erheblich: 0, gefaehrdung: 1, gut: 3 },
        letzteBewertung: { bestanden: false, stufen, geheim: "darf nicht rein" } } } }), {});
    assert.equal(r.statusCode, 200);
    const system = protokoll.anfrage.system;
    const daten = JSON.parse(system.slice(system.indexOf("{", system.indexOf("Die Daten zu"))));
    const ps = daten.pruefungssimulation;
    assert.equal(ps.gesamt.gut, 3);
    assert.equal(ps.letzteBewertung.waereBestanden, false);
    assert.equal(ps.letzteBewertung.stufen.length, 5, "höchstens fünf Prüfkriterien");
    assert.equal(ps.letzteBewertung.stufen[0].stufe, "Ungenügend");
    assert.ok(ps.letzteBewertung.stufen.every(s => s.kriterium.length <= 60));
    assert.equal(ps.letzteBewertung.geheim, undefined, "unbekannte Felder fallen weg");
    assert.match(system, /letzteBewertung ist das Ergebnis der letzten Prüfungssimulation/);
});

test("Ältere App-Stände ohne letzteBewertung funktionieren weiter", async () => {
    const { fn, protokoll } = lade();
    const r = await fn.handler(anfrage({ student: { name: "Test Schüler", pruefungssimulation: { anzahl: 1, letzteAm: "2026-10-01", gesamt: { leicht: 2, erheblich: 1, gefaehrdung: 0 } } } }), {});
    assert.equal(r.statusCode, 200);
    const system = protokoll.anfrage.system;
    const daten = JSON.parse(system.slice(system.indexOf("{", system.indexOf("Die Daten zu"))));
    assert.equal(daten.pruefungssimulation.letzteBewertung, null);
    assert.equal(daten.pruefungssimulation.gesamt.erheblich, 1);
});
