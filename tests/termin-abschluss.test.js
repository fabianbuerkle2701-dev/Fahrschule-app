// Fahrstunde abschließen: weicht die Dauer ab, zieht der Kalender das Terminende nach (v2.119.0).
const test = require("node:test");
const assert = require("node:assert/strict");
const k = require("./lade-app")(["abschlussTerminEnde"]);
const termin = { id: "t1", start_at: "2026-10-16T08:00:00+00:00", end_at: "2026-10-16T08:45:00+00:00" };

test("Wie geplant: nichts ändern", () => {
    assert.equal(k.abschlussTerminEnde(termin, 45), null);
    assert.equal(k.abschlussTerminEnde(termin, "45"), null, "Eingabe als Text");
});

test("Länger oder kürzer: Ende = Beginn + tatsächliche Dauer, Beginn bleibt", () => {
    assert.equal(k.abschlussTerminEnde(termin, 60), "2026-10-16T09:00:00.000Z");
    assert.equal(k.abschlussTerminEnde(termin, 30), "2026-10-16T08:30:00.000Z");
    assert.equal(k.abschlussTerminEnde(termin, 90), "2026-10-16T09:30:00.000Z", "Doppelstunde");
});

test("Termin ohne Ende bekommt eines, Unbrauchbares ändert nichts", () => {
    assert.equal(k.abschlussTerminEnde({ start_at: "2026-10-16T08:00:00Z", end_at: null }, 45), "2026-10-16T08:45:00.000Z");
    assert.equal(k.abschlussTerminEnde(termin, 0), null);
    assert.equal(k.abschlussTerminEnde(termin, "abc"), null);
    assert.equal(k.abschlussTerminEnde({ end_at: termin.end_at }, 60), null, "ohne Beginn");
    assert.equal(k.abschlussTerminEnde(null, 60), null);
});
