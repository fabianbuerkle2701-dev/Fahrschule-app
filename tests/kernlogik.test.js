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
    assert.ok(out.lastNoteAt && !Number.isNaN(Date.parse(out.lastNoteAt)), "Notiz braucht Zeitstempel, sonst räumt notizErledigt() sie nie weg");
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

test("Prüfungsakte: chronologisch, bestandener Versuch verdrängt den gleichen Führerschein-Schritt", () => {
    const { pruefungsakteVon: f } = require("./lade-app")(["pruefungsakteVon"]);
    const stu = {
        theorie: "2026-08-10",
        licenseSteps: { sehtest: { done: true, date: "2026-05-02" }, antrag: { done: false, date: "2026-06-01" } },
        exams: [
            { art: "theorie", date: "2026-08-01", passed: false },
            { art: "theorie", date: "2026-08-10", passed: true },
            { art: "praxis", date: "", passed: false },
        ],
        examReadinessVerlauf: [{ typ: "festgestellt", am: "2026-09-20T10:00:00.000Z", von: "Frau Kranz", ergebnis: "bestanden" }],
    };
    const akte = rein(f(stu));
    assert.deepEqual(akte.map(e => e.datum), ["2026-09-20", "2026-08-10", "2026-08-01", "2026-05-02"]);
    assert.equal(akte[1].text, "Theorieprüfung bestanden");          // nicht doppelt
    assert.equal(akte[2].typ, "schlecht");
    assert.equal(akte[0].von, "Frau Kranz");
    assert.deepEqual(rein(f({})), []);
});

// ── Ausbildungslogik: Überschneidung, Sonderfahrten, Prüfungsreife, Ampel ──
const aus = require("./lade-app")(["findOverlaps", "sonderfahrtenBilanz", "pruefungsreife", "ampel"]);

test("Überschneidung: echte Überlappung ja, Anschlusstermin und offene Anfrage nein", () => {
    const appts = [
        { id: "1", status: "confirmed", start_at: "2026-09-28T08:00:00Z", end_at: "2026-09-28T09:30:00Z" },
        { id: "2", status: "pending", start_at: "2026-09-28T10:00:00Z", end_at: "2026-09-28T10:45:00Z" },
        { id: "3", status: "confirmed", start_at: "2026-09-28T12:00:00Z" },                       // ohne Ende = 45 Min
    ];
    assert.equal(aus.findOverlaps(appts, "2026-09-28T09:00:00Z", "2026-09-28T09:45:00Z").length, 1);
    assert.equal(aus.findOverlaps(appts, "2026-09-28T09:30:00Z", "2026-09-28T10:15:00Z").length, 0, "direkt anschließend ist keine Überschneidung");
    assert.equal(aus.findOverlaps(appts, "2026-09-28T12:30:00Z", "2026-09-28T13:00:00Z").length, 1, "fehlende Endzeit zählt als 45 Minuten");
    assert.equal(aus.findOverlaps(appts, "2026-09-28T09:00:00Z", "2026-09-28T09:45:00Z", "1").length, 0, "eigener Termin wird beim Bearbeiten ignoriert");
});

const sf = (art, minutes, klasse) => ({ art, minutes, ...(klasse ? { klasse } : {}) });
test("Sonderfahrten Klasse B: Soll 5/4/3 UE, Doppelstunde je Art Pflicht", () => {
    const stu = { drivenLessons: [sf("ÜL", 90), sf("ÜL", 90), sf("ÜL", 45), sf("AB", 45), sf("AB", 45), sf("AB", 45), sf("AB", 45)] };
    const b = rein(aus.sonderfahrtenBilanz(stu, "B", {}));
    const ul = b.find(x => x.code === "ÜL"), ab = b.find(x => x.code === "AB"), nf = b.find(x => x.code === "NF");
    assert.equal(ul.ue, 5); assert.equal(ul.erfuellt, true); assert.equal(ul.langeFahrtDabei, true);
    assert.equal(ab.ue, 4); assert.equal(ab.erfuellt, true); assert.equal(ab.langeFahrtDabei, false, "4 x 45 Min ohne Doppelstunde");
    assert.equal(nf.ue, 0); assert.equal(nf.sollUe, 3);
});

test("Sonderfahrten: andere Klasse zählt nicht, eigenes Soll ergänzt die Vorgabe feldweise", () => {
    const stu = { drivenLessons: [sf("ÜL", 225, "A"), sf("ÜL", 90)] };
    const b = rein(aus.sonderfahrtenBilanz(stu, "B", { B: { autobahn: 2 } }));
    assert.equal(b.find(x => x.code === "ÜL").ue, 2, "Fahrten der Klasse A zählen nicht für B");
    assert.equal(b.find(x => x.code === "AB").sollUe, 2);
    assert.equal(b.find(x => x.code === "NF").sollUe, 3, "nicht überschriebene Felder behalten die Vorgabe");
    assert.deepEqual(rein(aus.sonderfahrtenBilanz(stu, "A", {})), [], "ohne Soll für die Klasse keine Bilanz");
});

// Kleine Vorlage: 2 ADK-Punkte (je 1x), 1 Strecken-Station (2x)
const ADK = [{ id: "grund", title: "Grundstufe", items: [{ id: "a1", label: "Anfahren", count: 1 }, { id: "a2", label: "Bremsen", count: 1 }] }];
const STRECKEN = [{ id: "stadt", title: "Stadt", items: [{ id: "s1", label: "Kreisverkehr", count: 2 }] }];
const sonderOk = [sf("ÜL", 90), sf("ÜL", 90), sf("ÜL", 45), sf("AB", 90), sf("AB", 90), sf("NF", 90), sf("NF", 45)];

test("Prüfungsreife: zählt offene ADK-Punkte, Stationen, Theorie und Sonderfahrten", () => {
    const r = rein(aus.pruefungsreife({ items: { a1: 1 }, strecken: { s1: 1 } }, ADK, STRECKEN, {}));
    assert.equal(r.offeneADK.length, 1);
    assert.equal(r.offeneStrecken.length, 1);
    assert.equal(r.theorieOffen, true);
    assert.equal(r.offeneSonderfahrten.length, 3);
    assert.equal(r.total, 6);
    const fertig = rein(aus.pruefungsreife({ items: { a1: 1, a2: 1 }, strecken: { s1: 2 }, theorie: "2026-09-01", drivenLessons: sonderOk }, ADK, STRECKEN, {}));
    assert.equal(fertig.total, 0);
});

test("Ampel: grün nur mit Fortschritt ≥ 90 %, Theorie und erfüllten Sonderfahrten", () => {
    const voll = { items: { a1: 1, a2: 1 }, strecken: { s1: 2 }, theorie: "2026-09-01", drivenLessons: sonderOk };
    assert.equal(aus.ampel(voll, ADK, STRECKEN, {}).stufe, "gruen");
    assert.equal(aus.ampel({ ...voll, theorie: "" }, ADK, STRECKEN, {}).stufe, "gelb", "ohne Theorie höchstens gelb");
    assert.equal(aus.ampel({ ...voll, drivenLessons: [] }, ADK, STRECKEN, {}).stufe, "gelb", "ohne Sonderfahrten höchstens gelb");
    assert.equal(aus.ampel({ items: { a1: 1 }, strecken: {} }, ADK, STRECKEN, {}).stufe, "rot");
});

test("Unterlagen anfordern: Text listet nur Fehlendes, Antrags-Hinweis nur wenn der Antrag fehlt", () => {
    const { unterlagenNachricht: f } = require("./lade-app")(["unterlagenNachricht"]);
    const t = f({ vorname: " Lena ", licenseSteps: { sehtest: { done: true }, erstehilfe: { done: true } } });
    assert.match(t, /^Hallo Lena, für deine Prüfungsanmeldung fehlt noch:\n• biometrisches Passfoto\n• Antrag bei der Führerscheinstelle\n\n/);
    assert.match(t, /oft einige Wochen/);
    assert.doesNotMatch(t, /Sehtest/);
    const ohneAntrag = f({ licenseSteps: { antrag: { done: true } } });
    assert.match(ohneAntrag, /^Hallo, /, "ohne Vornamen kein doppeltes Leerzeichen");
    assert.doesNotMatch(ohneAntrag, /Wochen/);
    assert.equal(f({ licenseSteps: { sehtest: { done: true }, erstehilfe: { done: true }, passfoto: { done: true }, antrag: { done: true } } }), null);
});

test("Zahlungsabgleich per Name + Betrag: nur eindeutige Fälle, Bank-Schreibweise wird erkannt", () => {
    const { zuordnungNameBetrag: f } = require("./lade-app")(["zuordnungNameBetrag"]);
    const schueler = [
        { id: "s1", vorname: "Jörg", nachname: "Müller", invoices: [{ id: "r1", offen: 180 }, { id: "r2", offen: 62.5 }] },
        { id: "s2", vorname: "Anna Lena", nachname: "Schmidt", invoices: [{ id: "r3", offen: 450 }] },
        { id: "s3", vorname: "Anna", nachname: "Schmidt", invoices: [{ id: "r4", offen: 450 }] },
    ];
    const z = [
        "27.09.2026 GUTSCHRIFT MUELLER JOERG Fahrstunden 180,00",   // eindeutig -> r1
        "27.09.2026 Anna Lena Schmidt Überweisung 450,00",          // passt auf s2 UND s3 -> liegen lassen
        "27.09.2026 Joerg Mueller 99,00",                           // kein passender offener Betrag
        "27.09.2026 Max Mustermann 180,00",                         // kein Schüler
    ];
    const t = rein(f(z, schueler));
    assert.deepEqual(t, [{ zeilenIndex: 0, studentId: "s1", invoiceId: "r1", betrag: 180 }]);
    // dieselbe Rechnung in zwei Zeilen: nicht raten
    assert.deepEqual(rein(f([z[0], "28.09.2026 Müller, Jörg 180,00"], schueler)), []);
});

test("Lebensphase: Reihenfolge der Phasen und genau ein nächster Schritt", () => {
    const { lebensphaseVon: f } = require("./lade-app")(["lebensphaseVon"]);
    const alleUnterlagen = { sehtest: { done: true }, erstehilfe: { done: true }, passfoto: { done: true }, antrag: { done: true } };
    assert.deepEqual(rein(f({}, { stufe: "rot", stunden: 0 })), { key: "start", label: "Start", schritt: "Erste Fahrstunde planen" });
    assert.equal(f({}, { stufe: "rot", stunden: 4 }).schritt, "Antrag bei der Führerscheinstelle anstoßen");
    assert.equal(f({ licenseSteps: alleUnterlagen }, { stufe: "rot", stunden: 4 }).schritt, null);
    // Vorbereitung: Theorie vor Sonderfahrten vor Unterlagen vor Testfahrt
    assert.equal(f({}, { stufe: "gelb", stunden: 20, offeneSonderfahrten: ["Autobahn"] }).schritt, "Theorieprüfung ablegen");
    assert.equal(f({ theorie: "2026-09-01" }, { stufe: "gelb", stunden: 20, offeneSonderfahrten: ["Autobahn", "Dämmerungsfahrt"] }).schritt, "Noch zwei Sonderfahrten: Autobahn und Dämmerungsfahrt");
    assert.equal(f({ theorie: "x" }, { stufe: "gruen", stunden: 30 }).schritt, "Unterlagen vervollständigen");
    assert.equal(f({ theorie: "x", licenseSteps: alleUnterlagen }, { stufe: "gruen", stunden: 30 }).schritt, "Testfahrt zur Prüfungsreife");
    // Reif -> angemeldet -> bestanden
    assert.equal(f({ examReadiness: { ergebnis: "bestanden" }, licenseSteps: alleUnterlagen }, { stufe: "gruen" }).schritt, "Zur Praxisprüfung anmelden");
    assert.equal(f({ examReadiness: { ergebnis: "nicht_bestanden" } }, { stufe: "gruen" }).key, "vorbereitung", "nicht bestandener Test ist keine Reife");
    const p = f({}, { stufe: "gruen", praxisTermin: "2026-10-15" });
    assert.equal(p.key, "pruefung"); assert.match(p.schritt, /^Praxisprüfung am /);
    assert.equal(f({ exams: [{ art: "praxis", passed: true }] }, { stufe: "gruen", praxisTermin: "2026-10-15" }).key, "bestanden");
});

test("Schüler-App: ein nächster Schritt – Prüfung vor Unterlagen vor Termin", () => {
    const { naechsterSchrittSchueler: f } = require("./lade-app")(["naechsterSchrittSchueler"]);
    const jetzt = new Date("2026-09-27T10:00:00+02:00");
    const pf = { art: "PF", status: "confirmed", start_at: "2026-10-09T08:00:00Z" };
    const fs1 = { art: "ÜST", status: "confirmed", start_at: "2026-09-29T08:00:00Z" };
    const offen = { unterlagen: { sehtest: true, erstehilfe: false, passfoto: true, antrag: false } };
    assert.deepEqual(rein(f(offen, [fs1, pf], jetzt)), { key: "pruefung", tage: 12 });
    assert.deepEqual(rein(f(offen, [fs1], jetzt)), { key: "unterlagen", offen: ["erstehilfe", "antrag"] });
    assert.deepEqual(rein(f({}, [], jetzt)), { key: "termin" });
    assert.equal(f({}, [fs1], jetzt), null, "Termin steht, nichts offen: keine Karte");
    assert.equal(f({}, [{ ...pf, status: "pending" }], jetzt), null, "nur angefragte Prüfungsfahrt zählt nicht");
});
