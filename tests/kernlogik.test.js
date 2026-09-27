// Tests der Rechen-Kernlogik aus index.html (Abrechnung, Beträge, Preisliste, Fahrtenbuch).
// Aufruf ohne Installation:  node --test tests/*.test.js
// Jeder Test hält ein Verhalten fest, das schon einmal kaputt war oder Geld betrifft.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
// Objekte aus der Sandbox haben eigene Prototypen; für deepEqual in reine Daten umwandeln.
const rein = x => JSON.parse(JSON.stringify(x));
const app = require("./lade-app")([
    "parseBetrag", "betragAusEingabe", "eurFmt", "ymd",
    "lessonPricePerUE", "lessonBillables", "lessonsCharge", "sumCharges", "sumPayments",
    "preisAusPreisliste", "pauschalenAusPreisliste", "PREISPOSTEN_32",
    "fahrtenbuchAusAbschluss", "letzteBewertungen", "licenseStepDone",
    "APP_VERSION", "CHANGELOG",
]);

test("Version und Changelog passen zusammen", () => {
    assert.equal(app.CHANGELOG[0].v, app.APP_VERSION, "oberster Changelog-Eintrag muss APP_VERSION sein");
    const vs = app.CHANGELOG.map(e => e.v);
    assert.equal(new Set(vs).size, vs.length, "doppelte Versionsnummer im Changelog");
});

test("parseBetrag: deutsche Schreibweise, Tausenderpunkt, Unsinn", () => {
    assert.equal(app.parseBetrag("62,50"), 62.5);
    assert.equal(app.parseBetrag("1.200"), 1200);          // war einmal 1,20 €
    assert.equal(app.parseBetrag("1.234.567"), 1234567);
    assert.equal(app.parseBetrag("45 €"), 45);
    assert.equal(app.parseBetrag("-10"), -10);
    assert.ok(Number.isNaN(app.parseBetrag("abc")));
    assert.ok(Number.isNaN(app.parseBetrag("55.5,")));
});

test("betragAusEingabe: gespeicherte Zahl bleibt unverändert", () => {
    assert.equal(app.betragAusEingabe(1.125), 1.125);      // nicht als "1.125" = 1125 lesen
    assert.equal(app.betragAusEingabe(""), null);
    assert.equal(app.betragAusEingabe(null), null);
    assert.equal(app.betragAusEingabe("1.125"), 1125);
});

test("eurFmt formatiert deutsch", () => {
    assert.equal(app.eurFmt(1234.5).replace(/\s/g, " "), "1.234,50 €");
});

test("Preis je UE: Stundenpreis vor Standardpreis", () => {
    assert.equal(app.lessonPricePerUE({ price: 70 }, 60), 70);
    assert.equal(app.lessonPricePerUE({ price: "" }, 60), 60);
    assert.equal(app.lessonPricePerUE({}, "60"), 60);
});

test("Abrechnung: 90 Minuten = 2 UE, ohne Paket voll berechnet", () => {
    const s = { drivenLessons: [{ id: "a", date: "2026-09-01", minutes: 90 }] };
    assert.equal(app.lessonsCharge(s, 60), 120);
    assert.equal(app.sumCharges({ ...s, costItems: [{ amount: 450 }] }, 60), 570);
});

test("Abrechnung: Paket deckt UE chronologisch", () => {
    const s = {
        packages: [{ includedUE: 3 }],
        drivenLessons: [
            { id: "a", date: "2026-09-01", minutes: 90 },
            { id: "b", date: "2026-09-03", minutes: 90 },
        ],
    };
    const b = app.lessonBillables(s, 60);
    assert.deepEqual(rein(b.map(x => x.coveredUE)), [2, 1]);
    assert.equal(app.lessonsCharge(s, 60), 60);            // 1 UE über dem Paket
});

test("Abrechnung: nachgetragene frühere Stunde nimmt abgerechneter Stunde kein Guthaben weg", () => {
    // Regression Abschluss-Audit: 10 von 9 UE gedeckt, 120 € statt 180 € berechnet.
    const s = {
        packages: [{ includedUE: 2 }],
        drivenLessons: [
            { id: "abgerechnet", date: "2026-09-10", minutes: 90, invoiced: "R-1", invoicedCoveredUE: 2, invoicedPrice: 60 },
            { id: "nachgetragen", date: "2026-09-01", minutes: 90 },
        ],
    };
    const b = app.lessonBillables(s, 60);
    const nach = b.find(x => x.lesson.id === "nachgetragen");
    assert.equal(nach.coveredUE, 0);
    assert.equal(nach.amount, 120);
});

test("Abrechnung: abgerechnete Stunde behält ihren Rechnungspreis", () => {
    const s = { drivenLessons: [{ id: "a", date: "2026-09-01", minutes: 45, invoiced: "R-1", invoicedCoveredUE: 0, invoicedPrice: 55 }] };
    assert.equal(app.lessonsCharge(s, 80), 55);            // späterer Standardpreis ändert nichts
});

test("Abrechnung: ein kaputter Betrag kippt nicht die ganze Summe", () => {
    const s = { drivenLessons: [
        { id: "a", date: "2026-09-01", minutes: 45, price: "abc" },
        { id: "b", date: "2026-09-02", minutes: 45 },
    ] };
    assert.equal(app.lessonsCharge(s, 60), 60);
});

test("Zahlungen summieren", () => {
    assert.equal(app.sumPayments({ payments: [{ amount: 100 }, { amount: "50" }, {}] }), 150);
});

const schule = { preisliste: { gueltigAb: "2026-09-01", klassen: {
    B: { grundbetrag: 450, fahrstunde: 62, pruefungsreife: "95,5", theorie: 0 },
    A: { fahrstunde: 70 },
} } };

test("Preisliste: Posten 5 ist Abrechnungspreis für Fahrstunden und Sonderfahrten", () => {
    assert.equal(app.preisAusPreisliste(schule, "B", "ÜST", "2026-09-27"), 62);
    assert.equal(app.preisAusPreisliste(schule, "A", "ÜST", "2026-09-27"), 70);
    assert.equal(app.preisAusPreisliste(schule, null, "ÜST", "2026-09-27"), 62, "ohne Klasse gilt B");
});

test("Preisliste: vor 'Gültig ab', ohne Posten oder bei Prüfungsfahrt kein Preis", () => {
    assert.equal(app.preisAusPreisliste(schule, "B", "ÜST", "2026-08-31"), null);
    assert.equal(app.preisAusPreisliste(schule, "C", "ÜST", "2026-09-27"), null);
    assert.equal(app.preisAusPreisliste({}, "B", "ÜST", "2026-09-27"), null);
});

test("Preisliste: Pauschalen nur mit Betrag, Komma-Schreibweise wird gelesen", () => {
    const p = app.pauschalenAusPreisliste(schule, "B", "2026-09-27");
    assert.deepEqual(rein(p.map(x => [x.key, x.betrag])), [["grundbetrag", 450], ["pruefungsreife", 95.5]]);
    assert.deepEqual(rein(app.pauschalenAusPreisliste(schule, "B", "2026-08-01")), []);
    const keys = new Set(app.PREISPOSTEN_32.map(x => x.key));
    p.forEach(x => assert.ok(keys.has(x.key), x.key + " fehlt in PREISPOSTEN_32"));
});

test("Fahrstunde abschließen: ohne Eingaben kein Fahrtenbuch-Eintrag", () => {
    assert.deepEqual(rein(app.fahrtenbuchAusAbschluss({ lessons: [] }, { id: "t1" }, "2026-09-27", { ratings: {}, thema: " ", naechstes: "" })), {});
    assert.deepEqual(rein(app.fahrtenbuchAusAbschluss({}, { id: "t1" }, "2026-09-27", null)), {});
});

test("Fahrstunde abschließen: neuer Eintrag trägt Termin, Notiz wird lastNote", () => {
    const out = app.fahrtenbuchAusAbschluss({ lessons: [{ id: "alt" }] }, { id: "t1" }, "2026-09-27",
        { ratings: { spiegel: 2, blinker: 0 }, thema: "Kreuzungen", naechstes: "Schulterblick" });
    assert.equal(out.lessons.length, 2);
    assert.equal(out.lessons[0].apptId, "t1");
    assert.deepEqual(rein(out.lessons[0].ratings), { spiegel: 2 });  // leere Bewertungen fallen weg
    assert.equal(out.lastNote, "Schulterblick");
});

test("Fahrstunde abschließen: vorhandener Eintrag desselben Termins wird ergänzt, nicht überschrieben", () => {
    const stu = { lessons: [{ id: "x", apptId: "t1", thema: "Eigenes Thema", schlecht: "", ratings: { spiegel: 3 } }] };
    const out = app.fahrtenbuchAusAbschluss(stu, { id: "t1" }, "2026-09-27", { ratings: { spiegel: 1, blinker: 2 }, thema: "Neu", naechstes: "Anfahren" });
    assert.equal(out.lessons.length, 1);
    assert.equal(out.lessons[0].thema, "Eigenes Thema");
    assert.equal(out.lessons[0].schlecht, "Anfahren");
    assert.deepEqual(rein(out.lessons[0].ratings), { spiegel: 3, blinker: 2 });
});

test("Letzte Bewertungen: jüngster Eintrag mit Bewertung", () => {
    const stu = { lessons: [
        { date: "2026-09-01", ratings: { a: 1 } },
        { date: "2026-09-05", ratings: { a: 0 } },
        { date: "2026-09-03", ratings: { a: 2 } },
    ] };
    assert.deepEqual(rein(app.letzteBewertungen(stu)), { a: 2 });
    assert.equal(app.letzteBewertungen({ lessons: [] }), null);
});

test("Unterlagen-Schritt: Theorie kommt aus dem Theorie-Feld", () => {
    assert.equal(app.licenseStepDone({ theorie: true }, "theorie_bestanden"), true);
    assert.equal(app.licenseStepDone({ licenseSteps: { sehtest: { done: true } } }, "sehtest"), true);
    assert.equal(app.licenseStepDone({}, "sehtest"), false);
});

test("ymd: lokales Datum ohne Zeitzonen-Versatz", () => {
    assert.equal(app.ymd(new Date(2026, 8, 27)), "2026-09-27");
});

test("Schüler-Vorauswahl beim Start: laufender Termin, sonst einer in den nächsten 10 Minuten", () => {
    const { findCurrentApptStudentId: f } = require("./lade-app")(["findCurrentApptStudentId"]);
    const iso = (minVonJetzt) => new Date(Date.now() + minVonJetzt * 60000).toISOString();
    const laufend = { status: "confirmed", student_id: "A", start_at: iso(-20), end_at: iso(25) };
    const gleich = { status: "confirmed", student_id: "B", start_at: iso(8), end_at: iso(53) };
    const spaeter = { status: "confirmed", student_id: "C", start_at: iso(30), end_at: iso(75) };
    const anfrage = { status: "pending", student_id: "D", start_at: iso(5), end_at: iso(50) };
    assert.equal(f([gleich, laufend]), "A", "laufender Termin geht vor");
    assert.equal(f([spaeter, gleich]), "B");
    assert.equal(f([spaeter]), null, "mehr als 10 Minuten entfernt: keine Vorauswahl");
    assert.equal(f([anfrage]), null, "offene Anfragen zählen nicht");
});
