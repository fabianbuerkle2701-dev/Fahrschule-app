// KI-Support (v2.125.0): Hilfsfunktionen der App - Zeile der App, Kategorie, Weiterschreiben.
const test = require("node:test");
const assert = require("node:assert/strict");
const k = require("./lade-app")(["SUPPORT_WERKZEUGE", "SUPPORT_KATEGORIEN", "supportKategorieRaten", "supportKontextZeile", "supportVerlaufZuNachrichten", "supportKuerzelStand"]);

test("App und Server kennen dieselben Support-Werkzeuge und Kategorien", () => {
    const Module = require("module");
    const alt = Module._load;
    Module._load = function (anfrage) { return anfrage === "@anthropic-ai/sdk" ? { default: function () {} } : alt.apply(this, arguments); };
    try {
        const fn = require("../netlify/functions/support.js");
        assert.deepEqual(fn.WERKZEUGE.map(w => w.name), Array.from(k.SUPPORT_WERKZEUGE));
        const weitergeben = fn.WERKZEUGE.find(w => w.name === "weitergeben");
        assert.deepEqual(Array.from(weitergeben.input_schema.properties.kategorie.enum).sort(), Object.keys(k.SUPPORT_KATEGORIEN).sort());
    }
    finally { Module._load = alt; }
});

test("Zeile der App: Zeitpunkt in Berlin, Version, Gerät, Seite, Rolle", () => {
    assert.equal(k.supportKontextZeile(new Date("2026-10-19T08:15:00Z"), { version: "2.125.0", geraet: "iPhone-App", seite: "Kalender", rolle: "Fahrschul-Admin" }),
        "[App] Jetzt: Montag, 19.10.2026, 10:15 Uhr. Version 2.125.0. Gerät: iPhone-App. Seite: Kalender. Rolle: Fahrschul-Admin.");
});

test("Kategorie grob aus dem Text", () => {
    const faelle = [["Wie kündige ich mein Abo?", "abo"], ["Ich will mein Konto löschen", "datenschutz"], ["Ich kann mich nicht anmelden", "konto"],
        ["Es wäre schön, wenn man Termine färben könnte", "wunsch"], ["Der Kalender lädt nicht mehr", "fehler"], ["Wie lege ich eine Terminserie an?", "bedienung"],
        ["Die Rechnung für Lena stimmt nicht", "bedienung"]];
    for (const [text, kat] of faelle)
        assert.equal(k.supportKategorieRaten(text), kat, text);
});

test("Weiterschreiben: abwechselnd, Antworten von Allindrive gekennzeichnet, Vermerke und offene Frage fallen weg", () => {
    const verlauf = [
        { rolle: "nutzer", text: "Wo finde ich die Arbeitszeiten?" },
        { rolle: "ki", text: "Unter Einstellungen › Arbeit & Ausbildung." },
        { rolle: "system", text: "Hat noch nicht geholfen" },
        { rolle: "system", text: "An Allindrive weitergegeben" },
        { rolle: "allindrive", text: "Schau unter Wochentage & Zeiten." },
        { rolle: "nutzer", text: "Danke, gefunden!" },
        { rolle: "nutzer", text: "Noch eine Frage …" },
    ];
    const n = Array.from(k.supportVerlaufZuNachrichten(verlauf));
    assert.deepEqual(n.map(x => x.role), ["user", "assistant"]);
    assert.match(n[1].content[0].text, /Arbeit & Ausbildung\.\n\n\(Antwort von Allindrive\) Schau unter Wochentage/);
    assert.deepEqual(Array.from(k.supportVerlaufZuNachrichten([{ rolle: "ki", text: "x" }, { rolle: "nutzer", text: "a" }, { rolle: "ki", text: "b" }])).map(x => x.role), ["user", "assistant"],
        "beginnt immer beim Fahrlehrer");
    assert.equal(Array.from(k.supportVerlaufZuNachrichten([])).length, 0);
});

test("Kürzel zählen beim Weiterschreiben weiter", () => {
    const z = k.supportKuerzelStand([{ text: "Bei S3 und S12 fehlt die Rechnung, P2 hat angefragt" }, { text: "Termin #7" }, { text: "Klasse A1 und T1 sind keine Kürzel" }]);
    assert.deepEqual({ S: z.S, P: z.P, h: z["#"] }, { S: 12, P: 2, h: 7 });
});
