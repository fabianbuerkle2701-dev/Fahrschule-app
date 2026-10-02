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
    "warteschlangeVormerken", "warteschlangeErledigt", "warteschlangeOffline",
    "spaltenRaten", "excelSerialZuDatum",
    "rechnungsEntwurfZeilen", "rechnungsPostenAusZeilen", "rechnungsSchnappschuss",
    "arbeitszeitArt", "arbeitszeitTage", "sonderfahrtenBilanz",
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

test("Überschneidung: echte Überlappung ja (auch mit offener Anfrage), Anschlusstermin nein", () => {
    const appts = [
        { id: "1", status: "confirmed", start_at: "2026-09-28T08:00:00Z", end_at: "2026-09-28T09:30:00Z" },
        { id: "2", status: "pending", start_at: "2026-09-28T10:00:00Z", end_at: "2026-09-28T10:45:00Z" },
        { id: "3", status: "confirmed", start_at: "2026-09-28T12:00:00Z" },                       // ohne Ende = 45 Min
    ];
    assert.equal(aus.findOverlaps(appts, "2026-09-28T09:00:00Z", "2026-09-28T09:45:00Z").length, 1);
    assert.equal(aus.findOverlaps(appts, "2026-09-28T09:30:00Z", "2026-09-28T10:00:00Z").length, 0, "direkt anschließend ist keine Überschneidung");
    // v2.56.1 (Vorgabe Fabian): offene Anfragen blockieren wie Termine
    assert.equal(aus.findOverlaps(appts, "2026-09-28T09:30:00Z", "2026-09-28T10:15:00Z").length, 1, "offene Anfrage zählt als belegt");
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

// ── Inhaber-Cockpit ──
const ck = require("./lade-app")(["cockpitKennzahlen", "cockpitFolgerungen"]);
const JETZT = new Date(2026, 8, 28, 9, 0);   // Montag, 28.09.2026
const wh = { mo: { von: "08:00", bis: "12:00" }, di: { von: "08:00", bis: "12:00" }, mi: { blocked: true }, do: { von: "08:00", bis: "12:00" }, fr: { von: "08:00", bis: "12:00" }, sa: null };

test("Cockpit: freie Kapazität aus Arbeitszeit minus bestätigten Terminen, Sonntag und gesperrte Tage zählen nicht", () => {
    const k = rein(ck.cockpitKennzahlen({ lehrer: [{ id: "L1", name: "Anna", work_hours: wh }],
        belegung: [{ lehrer_id: "L1", datum: "2026-09-28", minuten: 180, anfragen: 2 }] }, [], [], 60, JETZT));
    // 4 Wochen × 4 Arbeitstage × 240 Min = 3840 Min = 85 UE (abgerundet); gebucht 180 Min = 4 UE
    assert.equal(k.kapazitaet.kapUE, 85);
    assert.equal(k.kapazitaet.gebuchtUE, 4);
    assert.equal(k.kapazitaet.freiUE, 81);
    assert.equal(k.kapazitaet.freiWocheUE, 17, "diese Woche: 4×240 - 180 = 780 Min");
    assert.equal(k.kapazitaet.anfragen, 2);
    assert.equal(k.kapazitaet.auslastung, 5);
});

test("Cockpit: Tages- und Wochenlimit deckeln die Kapazität, fehlende Arbeitszeit wird ausgewiesen", () => {
    const k = rein(ck.cockpitKennzahlen({ lehrer: [
        { id: "L1", name: "Anna", work_hours: wh, day_limit: 180, week_limit: 450 },
        { id: "L2", name: "Ben", work_hours: null },
    ], belegung: [] }, [], [], 60, JETZT));
    assert.equal(k.kapazitaet.kapUE, 40, "Wochenlimit 450 Min × 4 Wochen = 1800 Min = 40 UE");
    assert.deepEqual(k.kapazitaet.ohneArbeitszeit, ["Ben"]);
    assert.ok(ck.cockpitFolgerungen(k).some(f => /Ohne hinterlegte Arbeitszeiten: Ben/.test(f.text)));
});

test("Cockpit: wartende Schüler, Anfragen-Quote, Median-Dauer und Erstversuch-Quote", () => {
    const tage = n => new Date(JETZT.getTime() - n * 86400000).toISOString();
    const k = rein(ck.cockpitKennzahlen({
        lehrer: [{ id: "L1", name: "Anna", work_hours: wh }],
        schueler: [
            { id: "a", name: "Wartet", lehrer_id: "L1", angemeldet: true, letzte: tage(20) },
            { id: "b", name: "Hat Termin", lehrer_id: "L1", angemeldet: true, letzte: tage(30), naechste: tage(-2) },
            { id: "c", name: "Kürzlich", lehrer_id: "L1", angemeldet: true, letzte: tage(5) },
            { id: "d", name: "Nie gefahren", lehrer_id: "L1", angemeldet: true, angelegt: tage(40) },
            { id: "e", name: "Archiv", lehrer_id: "L1", angemeldet: true, archiviert: true, letzte: tage(90) },
            { id: "f", name: "Bestanden", lehrer_id: "L1", angemeldet: true, letzte: tage(60), erste_stunde: "2026-01-10", bestanden_am: "2026-05-10" },
            { id: "g", name: "Bestanden2", lehrer_id: "L1", angemeldet: true, erste_stunde: "2026-02-01", bestanden_am: "2026-08-01" },
        ],
        interessenten: { angemeldet: 3, abgesagt: 1, offen: 4, kontaktiert: 2 },
    }, [], [
        { exams: [{ art: "praxis", date: "2026-06-01", passed: true }] },
        { exams: [{ art: "praxis", date: "2026-07-01", passed: false }, { art: "praxis", date: "2026-07-20", passed: true }] },
        { exams: [{ art: "theorie", date: "2026-07-01", passed: true }] },
    ], 60, JETZT));
    assert.deepEqual(k.warten.map(w => w.name), ["Nie gefahren", "Wartet"]);
    assert.equal(k.warten[0].nochNieGefahren, true);
    assert.equal(k.aktiveSchueler, 4);
    const { quellen, absagegruende, unbeantwortet, ...kern } = k.anfragen;
    assert.deepEqual(kern, { gesamt: 10, angemeldet: 3, abgesagt: 1, offen: 6, quote: 30 });
    assert.equal(quellen.length + absagegruende.length + unbeantwortet.length, 0, "ohne Angaben keine Listen");
    assert.equal(k.dauerAnzahl, 2);
    assert.ok(k.dauerMonate > 4 && k.dauerMonate < 5.5, "Median aus 120 und 181 Tagen ≈ 4,9 Monate");
    assert.equal(k.quoteErstversuch, 50);
});

test("Cockpit: Geld – offener Saldo und davon noch nicht berechnet", () => {
    const k = rein(ck.cockpitKennzahlen({}, [
        { stu: { drivenLessons: [{ id: "x", date: "2026-09-01", minutes: 90 }] } },
        { stu: { drivenLessons: [{ id: "y", date: "2026-09-02", minutes: 45, invoiced: "R-1", invoicedPrice: 60, invoicedCoveredUE: 0 }], payments: [{ amount: 60 }] } },
    ], [], 60, JETZT));
    assert.deepEqual(k.geld, { offen: 120, nichtBerechnet: 120 });
    assert.ok(ck.cockpitFolgerungen(k).some(f => /nicht berechnet/.test(f.text)));
});

test("CSV für Excel: Semikolon, Dezimalkomma, BOM, Schutz gegen Formel-Injektion", () => {
    const { csvText } = require("./lade-app")(["csvText"]);
    const t = csvText(["Name", "Betrag", "Aktiv"], [["=HYPERLINK(\"x\")", 1234.5, true], ["Müller; Anna", -10, false], ["  Leer ", null, false]]);
    assert.equal(t.charCodeAt(0), 0xFEFF, "BOM für Umlaute in Excel");
    const z = t.slice(1).split("\r\n");
    assert.equal(z[0], "Name;Betrag;Aktiv");
    assert.equal(z[1], "\"'=HYPERLINK(\"\"x\"\")\";1234,5;ja", "Formel wird entschärft und gequotet");
    assert.equal(z[2], "\"Müller; Anna\";'-10;nein".replace("'-10", "-10"), "Semikolon im Text wird gequotet, Zahl bleibt Zahl");
    assert.equal(z[3], "\"  Leer \";;nein");
});

test("Offline-Warteschlange: Felder sammeln, ganzer Datensatz schluckt Feldlisten", () => {
    let ws = app.warteschlangeVormerken({}, "s1", ["items"], 100);
    ws = app.warteschlangeVormerken(ws, "s1", ["lessons", "items"], 200);
    assert.deepEqual(rein(ws.s1), { keys: ["items", "lessons"], seit: 100, n: 2 });
    ws = app.warteschlangeVormerken(ws, "s1", null, 300);
    assert.equal(ws.s1.keys, null);
    ws = app.warteschlangeVormerken(ws, "s1", ["tel"], 400);
    assert.equal(ws.s1.keys, null, "einmal ganzer Datensatz bleibt ganzer Datensatz");
    assert.equal(app.warteschlangeVormerken({}, "s2", [], 1).s2.keys, null, "leere Feldliste = ganzer Datensatz");
});

test("Offline-Warteschlange: erledigt nur, wenn seitdem nichts Neues dazukam", () => {
    let ws = app.warteschlangeVormerken({}, "s1", ["items"], 1);
    const nr = ws.s1.n;
    ws = app.warteschlangeVormerken(ws, "s1", ["lessons"], 2); // Änderung während des Speicherns
    assert.ok(app.warteschlangeErledigt(ws, "s1", nr).s1, "neuere Änderung darf nicht verschwinden");
    assert.equal(app.warteschlangeErledigt(ws, "s1", ws.s1.n).s1, undefined);
    assert.equal(app.warteschlangeErledigt(ws, "s1").s1, undefined, "ohne Nummer: immer entfernen (verwaist)");
    ws = { a: { keys: null, n: 1, netz: true }, b: { keys: null, n: 1, netz: false }, c: { keys: null, n: 1 } };
    assert.equal(app.warteschlangeOffline(ws), 1);
});

test("Bestand übernehmen: Spalten typischer Exporte ohne KI erkennen", () => {
    const m = app.spaltenRaten(["Kd.-Nr.", "Nachname", "Vorname", "Geb.-Datum", "Straße", "PLZ", "Ort", "Telefon", "E-Mail", "Führerscheinklasse", "Anmeldung"]);
    assert.deepEqual(rein(m), { vorname: 2, name: 1, geburtstag: 3, handy: 7, festnetz: null, email: 8, adresse: 4, hausnr: null,
        plz: 5, ort: 6, anmeldedatum: 10, klasse: 9, theorie_bestanden: null, stunden_gesamt: null, ueberland: null, autobahn: null, nacht: null });
    // v2.61.0: Startwerte-Spalten (Stunden gesamt, Sonderfahrten in UE)
    const sw = app.spaltenRaten(["Name", "Vorname", "Fahrstunden gesamt", "Überlandfahrten", "Autobahn", "Nachtfahrten", "Theoriestunden"]);
    assert.equal(sw.stunden_gesamt, 2); assert.equal(sw.ueberland, 3); assert.equal(sw.autobahn, 4); assert.equal(sw.nacht, 5);
    assert.notEqual(sw.stunden_gesamt, 6, "Theoriestunden sind keine Fahrstunden");
    // Eine Spalte "Name, Vorname" -> name, Vorname bleibt leer (wird beim Import geteilt)
    const v = app.spaltenRaten(["Name, Vorname", "Handy", "Telefon privat", "Theorieprüfung am"]);
    assert.equal(v.name, 0); assert.equal(v.vorname, null);
    assert.equal(v.handy, 1); assert.equal(v.festnetz, 2); assert.equal(v.theorie_bestanden, 3);
    // Nichts Erkennbares -> alles null (dann KI oder Handzuordnung)
    assert.ok(Object.values(rein(app.spaltenRaten(["A", "B", "C"]))).every(x => x === null));
});

test("Excel-Tageszahl in Datum", () => {
    assert.equal(app.excelSerialZuDatum(38718), "01.01.2006");
    assert.equal(app.excelSerialZuDatum("45658"), "01.01.2025");
    assert.equal(app.excelSerialZuDatum(12), "", "Unsinn bleibt leer");
});

test("Rechnung aus offenen Posten: Paket abgezogen, gleiche Preise gruppiert, Kosten einzeln", () => {
    const s = {
        packages: [{ includedUE: 3 }],
        drivenLessons: [
            { id: "a", date: "2026-09-01", minutes: 90 },          // 2 UE im Paket
            { id: "b", date: "2026-09-03", minutes: 90 },          // 1 UE Paket + 1 UE zu zahlen
            { id: "c", date: "2026-09-05", minutes: 45 },          // 1 UE zu zahlen
            { id: "d", date: "2026-09-06", minutes: 45, invoiced: "RE-1", invoicedCoveredUE: 0, invoicedPrice: 60 },
        ],
        costItems: [{ id: "k1", label: "Grundbetrag", amount: 300 }, { id: "k2", label: "Alt", amount: 10, invoiced: "RE-1" }],
    };
    const z = app.rechnungsEntwurfZeilen(s, 60);
    assert.deepEqual(rein(z.map(r => [r.kind, r.amount, (r.ids || []).join(",")])), [["lessongroup", 120, "b,c"], ["cost", 300, ""]]);
    assert.match(z[0].label, /^2 Fahrstunden \u00E0 60,00.€$/);
    assert.equal(z[0].von, "2026-09-03"); assert.equal(z[0].bis, "2026-09-05");
    const posten = app.rechnungsPostenAusZeilen(z);
    assert.deepEqual(rein(posten[0]), { label: z[0].label, amount: 120, date: "", von: "2026-09-03", bis: "2026-09-05" });
    const snap = app.rechnungsSchnappschuss(s, 60, ["b", "c"]);
    assert.deepEqual(rein(snap), { b: { invoicedCoveredUE: 1, invoicedPrice: 60 }, c: { invoicedCoveredUE: 0, invoicedPrice: 60 } });
    assert.deepEqual(rein(app.rechnungsEntwurfZeilen(null, 60)), []);
});

test("Arbeitszeit § 12 FahrlG: Arten, 495-Minuten-Grenze, Pausen, Überschneidungen", () => {
    const t = (start, ende, art, extra) => ({ start_at: "2026-09-28T" + start + ":00+02:00", end_at: "2026-09-28T" + ende + ":00+02:00", art, status: "confirmed", ...(extra || {}) });
    assert.equal(app.arbeitszeitArt(t("08:00", "09:00", "PRIVAT")), null);
    assert.equal(app.arbeitszeitArt(t("08:00", "09:00", "ÜST", { status: "offered" })), null);
    assert.equal(app.arbeitszeitArt(t("08:00", "09:00", "ÜST", { note: "§URLAUB§" })), null);
    assert.equal(app.arbeitszeitArt(t("08:00", "09:00", "TH")), "arbeit");
    assert.equal(app.arbeitszeitArt(t("08:00", "09:00", "PF")), "praxis");
    assert.equal(app.arbeitszeitArt(t("08:00", "09:00", "EIGENE")), "praxis");
    // 07:00-15:30 durchgehend Fahrstunden (510 Min.), dazu 16:00-18:00 Theorie
    const tage = app.arbeitszeitTage([
        t("07:00", "11:00", "ÜST"), t("11:10", "15:30", "AB"),   // 10 Min Lücke = keine Pause
        t("12:00", "12:30", "ÜST"),                              // überschneidet, zählt nicht doppelt
        t("16:00", "18:00", "TH"), t("09:00", "10:00", "PRIVAT"),
    ]);
    assert.equal(tage.length, 1);
    const d = tage[0];
    assert.equal(d.tag, "2026-09-28");
    assert.equal(d.praxisMin, 500);
    assert.equal(d.arbeitMin, 620);
    assert.equal(d.laengsterBlockMin, 510);
    assert.deepEqual([d.ueberPraxis, d.ueberArbeit, d.langerBlock], [true, true, true]);
    // Mit echter Pause: zwei Blöcke, alles im Rahmen
    const ok = app.arbeitszeitTage([t("08:00", "12:00", "ÜST"), t("12:30", "15:00", "ÜL")])[0];
    assert.deepEqual([ok.praxisMin, ok.laengsterBlockMin, ok.ueberPraxis, ok.langerBlock], [390, 240, false, false]);
});

test("Schulwechsel: übernommene Sonderfahrten zählen zur Pflicht, werden aber nicht abgerechnet", () => {
    const s = {
        drivenLessons: [{ id: "a", date: "2026-09-10", minutes: 90, art: "AB", klasse: "B" }],
        uebernahme: { vonSchule: "Alt", fahrstunden: [{ date: "2026-08-01", minutes: 135, art: "AB" }, { date: "2026-08-02", minutes: 225, art: "ÜL", klasse: "B" }] },
    };
    const b = app.sonderfahrtenBilanz(s, "B", {});
    const ab = b.find(x => x.code === "AB"), ul = b.find(x => x.code === "ÜL");
    assert.equal(ab.ue, 5); assert.equal(ab.anzahl, 2); assert.equal(ab.erfuellt, true);
    assert.equal(ul.ue, 5); assert.equal(ul.erfuellt, true);
    assert.equal(app.lessonBillables(s, 60).length, 1, "nur die eigene Fahrstunde ist abrechenbar");
});

// v2.57.1: Sammelrechnung darf in "Nicht abgerechnet" herausgenommene Posten (nichtBerechnen) nicht abrechnen
const rz = require("./lade-app")(["rechnungsEntwurfZeilen"]);
test("Rechnungszeilen: Sammelrechnung lässt herausgenommene Posten weg, Einzelrechnung zeigt sie", () => {
    const stu = {
        drivenLessons: [
            { id: "L1", date: "2026-09-01", minutes: 45, price: 50 },
            { id: "L2", date: "2026-09-02", minutes: 45, price: 50, nichtBerechnen: true },
            { id: "L3", date: "2026-09-03", minutes: 45, price: 50, invoiced: "RE-2026-0001" },
        ],
        costItems: [
            { id: "C1", label: "Lernmaterial", amount: 30 },
            { id: "C2", label: "Kulanz", amount: 20, nichtBerechnen: true },
        ],
    };
    const summe = rows => rows.reduce((t, r) => t + r.amount, 0);
    const ids = rows => JSON.stringify(Array.from(rows).flatMap(r => Array.from(r.ids || [r.id])).sort());
    const einzel = rz.rechnungsEntwurfZeilen(stu, 50);
    const sammel = rz.rechnungsEntwurfZeilen(stu, 50, true);
    assert.equal(ids(einzel), JSON.stringify(["C1", "C2", "L1", "L2"]), "Einzelrechnung bietet alles Offene an (abwählbar)");
    assert.equal(ids(sammel), JSON.stringify(["C1", "L1"]), "Sammelrechnung nur, was die Liste zeigt");
    assert.equal(summe(sammel), 80);
    assert.equal(summe(einzel), 150);
});

// v2.61.0: Startwerte aus der alten Software zählen zur Sonderfahrten-Pflicht
const sw2 = require("./lade-app")(["startwerteFahrstunden", "sonderfahrtenBilanz"]);
test("Startwerte: Sonderfahrten in UE werden Sammelzeilen und zählen zur Bilanz", () => {
    const f = sw2.startwerteFahrstunden({ "ÜL": "2", "AB": "1,5", "NF": "" }, "B");
    assert.equal(f.length, 2);
    assert.equal(f[0].art, "ÜL"); assert.equal(f[0].minutes, 90);
    assert.equal(f[1].art, "AB"); assert.equal(f[1].minutes, 68);
    const b = sw2.sonderfahrtenBilanz({ drivenLessons: [{ art: "ÜL", minutes: 135, klasse: "B" }], uebernahme: { startwerte: true, fahrstunden: f } }, "B", {});
    const ul = Array.from(b).find(x => x.code === "ÜL");
    assert.equal(ul.ue, 5, "3 UE gefahren + 2 UE Startwert");
    assert.equal(ul.erfuellt, true);
});

// v2.62.0: Quellen/Absagegründe sortiert, "nicht erfasst" zuletzt; unbeantwortete Anfragen mit Fahrlehrer
test("Cockpit: Anfragen nach Quelle und Absagegrund, unbeantwortete mit Fahrlehrer", () => {
    const jetzt = new Date("2026-09-28T12:00:00Z");
    const k = ck.cockpitKennzahlen({ lehrer: [{ id: "L1", name: "Miriam" }], belegung: [], schueler: [], interessenten: { abgesagt: 5 },
        anfrage_quellen: { ohne: 4, telefon: 1, website: 3 }, absagegruende: { preis: 3, zeit: 1, ohne: 1 },
        unbeantwortet: [{ name: "Anna", lehrer_id: "L1", seit: "2026-09-25T10:00:00Z" }] }, [], [], 50, jetzt);
    assert.equal(JSON.stringify(Array.from(k.anfragen.quellen).map(x => x.key)), JSON.stringify(["website", "telefon", "ohne"]));
    assert.equal(k.anfragen.absagegruende[0].label, "Zu teuer");
    assert.equal(k.anfragen.unbeantwortet[0].lehrer, "Miriam");
    const f = Array.from(ck.cockpitFolgerungen(k)).map(x => x.text).join(" | ");
    assert.match(f, /1 Anfrage wartet seit über zwei Tagen/);
    assert.match(f, /Häufigster Absagegrund: Zu teuer \(3 von 4\)/);
});

// v2.63.0: Archiv-Vorschläge
const av = require("./lade-app")(["archivVorschlaege"]);
test("Archiv-Vorschläge: bestanden oder über ein Jahr inaktiv ohne künftigen Termin", () => {
    const jetzt = new Date("2026-09-29T12:00:00Z");
    const st = [
        { id: "a", _isMine: true, exams: [{ art: "praxis", passed: true, date: "2026-09-01" }] },          // bestanden
        { id: "b", _isMine: true, drivenLessons: [{ date: "2025-06-01" }], created_at: "2025-01-01" },     // inaktiv > 1 Jahr
        { id: "c", _isMine: true, drivenLessons: [{ date: "2025-06-01" }] },                               // inaktiv, aber Termin geplant
        { id: "d", _isMine: true, drivenLessons: [{ date: "2026-08-01" }] },                               // aktiv
        { id: "e", _isMine: true, archived: true, exams: [{ art: "praxis", passed: true, date: "2026-01-01" }] },
        { id: "f", _isMine: false, exams: [{ art: "praxis", passed: true, date: "2026-01-01" }] },         // fremd
        { id: "g", _isMine: true, exams: [{ art: "praxis", passed: false, date: "2026-09-01" }], drivenLessons: [{ date: "2026-09-01" }] },
    ];
    const r = av.archivVorschlaege(st, [], { c: { start_at: "2026-10-01" } }, jetzt);
    assert.equal(JSON.stringify(Array.from(r).map(x => x.s.id)), JSON.stringify(["a", "b"]));
    assert.match(r[0].grund, /^bestanden am 1\.9\.2026$/);
    assert.match(r[1].grund, /^zuletzt aktiv Juni 2025$/);
});

// v2.64.0: Datenauskunft nach Art. 15 DSGVO
const da = require("./lade-app")(["datenauskunftAbschnitte", "datenauskunftDatei", "STUDENT_FILE_CATEGORIES"]);
test("Datenauskunft: alle Bereiche lesbar, PIN nie im Klartext", () => {
    const stu = { id: "s1", _owner: "u1", _isMine: true, vorname: "Lea", name: "Sommer", geb: "2008-03-04", tel: "0171 1", klasse: "B",
        pin: "4711", pinCustom: "4711", theorie: true, items: { a: true, b: false, c: true },
        drivenLessons: [{ date: "2026-09-10", time: "16:00", minutes: 90, art: "ÜL" }, { date: "2026-09-01", minutes: 45 }],
        lessons: [{ date: "2026-09-10", thema: "Autobahn", gut: "Auffahren", schlecht: "Abstand", note: "", route: { p: [] } }],
        exams: [{ art: "theorie", date: "2026-08-20", passed: true }],
        invoices: [{ number: "R-1", date: "2026-09-12", total: 123.5 }], payments: [{ date: "2026-09-13", amount: 50, method: "Bar" }] };
    const ctx = { artName: c => c === "ÜL" ? "Überlandfahrt" : "Übungsstunde", standortName: "Nord",
        termine: [{ start_at: "2026-10-01T14:00:00Z", art: "ÜST", status: "pending" }],
        dateien: [{ filename: "sehtest.pdf", category: "sehtest", created_at: "2026-08-01T10:00:00Z" }] };
    const a = JSON.parse(JSON.stringify(da.datenauskunftAbschnitte(stu, ctx)));
    const titel = a.map(x => x.titel);
    assert.equal(JSON.stringify(titel), JSON.stringify(["Stammdaten", "Ausbildung", "Prüfungen", "Fahrstunden", "Fahrtenbuch", "Termine", "Rechnungen", "Zahlungen", "Dokumente", "Zweck, Rechtsgrundlage und Speicherdauer"]));
    const text = JSON.stringify(a);
    assert.ok(!text.includes("4711"), "PIN darf nicht in der Auskunft stehen");
    assert.ok(text.includes("PIN vergeben"));
    assert.ok(text.includes("04.03.2008") && text.includes("Nord") && text.includes("Sehtest"));
    assert.equal(JSON.stringify(a[1].zeilen[0]), JSON.stringify(["Abgehakte Punkte der Ausbildungskarte", "2"]));
    assert.equal(JSON.stringify(a[3].zeilen[0]), JSON.stringify(["01.09.2026", "", "Übungsstunde", "45"]));   // nach Datum sortiert
    assert.equal(a[5].zeilen[0][1], "16:00");                                                                   // Berliner Zeit
    assert.equal(a[5].zeilen[0][3], "angefragt");
    const datei = JSON.parse(JSON.stringify(da.datenauskunftDatei(stu, ctx)));
    assert.equal(datei.schueler.pin, "vergeben");
    assert.ok(!("pinCustom" in datei.schueler) && !("_owner" in datei.schueler) && !JSON.stringify(datei).includes("4711"));
    assert.equal(datei.termine.length, 1);
    assert.equal(datei.dokumente[0].datei, "sehtest.pdf");
});
test("Datenauskunft: leerer Schüler und nicht geladene Dokumente", () => {
    const a = JSON.parse(JSON.stringify(da.datenauskunftAbschnitte({ vorname: "Tom" }, { dateien: null })));
    assert.equal(JSON.stringify(a.map(x => x.titel)), JSON.stringify(["Stammdaten", "Ausbildung", "Dokumente", "Zweck, Rechtsgrundlage und Speicherdauer"]));
    assert.match(JSON.stringify(a[2]), /konnte nicht geladen werden/);
    assert.match(JSON.stringify(a[0]), /nicht eingerichtet/);
});

// v2.65.0: Theorieplan in der Schüler-App
const tp = require("./lade-app")(["theoriePlanFuerSchueler", "GRUNDSTOFF_THEMEN", "ZUSATZSTOFF_THEMEN"]);
test("Theorieplan: markiert fehlende Pflichtthemen, zählt besuchte", () => {
    const termine = [
        { start_at: "2026-10-01T16:00:00Z", thema: "Ruhender Verkehr" },          // Pflicht, fehlt
        { start_at: "2026-10-02T16:00:00Z", thema: "Risikofaktor Mensch " },      // Pflicht, schon besucht
        { start_at: "2026-10-03T16:00:00Z", thema: "" },                          // ohne Thema
        { start_at: "2026-10-04T16:00:00Z", thema: "Erste Hilfe Extra" },         // kein Pflichtthema
        { start_at: "2026-10-05T16:00:00Z", thema: "Fahren mit Solokraftfahrzeugen und Zügen" }, // Zusatzstoff B
    ];
    const r = JSON.parse(JSON.stringify(tp.theoriePlanFuerSchueler("B", termine, ["Risikofaktor Mensch", "Sonstiges Thema"])));
    assert.equal(r.pflicht, 14);
    assert.equal(r.erledigt, 1);
    assert.equal(JSON.stringify(r.termine.map(t => t.fehlt)), JSON.stringify([true, false, false, false, true]));
    assert.equal(r.termine[1].thema, "Risikofaktor Mensch");
    const a = JSON.parse(JSON.stringify(tp.theoriePlanFuerSchueler("A", termine, [])));
    assert.equal(a.pflicht, 12);                   // Klasse A: nur Grundstoff (keine erfundenen Zusatztitel)
    assert.equal(a.termine[4].fehlt, false);
});
test("Datenauskunft: Theorie-Anwesenheit, Ladefehler und Hinweis auf fehlende Kollegen-Termine", () => {
    const ctx = { theorie: [{ thema: "Ruhender Verkehr", checked_at: "2026-09-20T16:00:00Z" }, { thema: "", checked_at: "2026-09-21T16:00:00Z" }], dateien: null, termineNurEigene: true };
    const a = JSON.parse(JSON.stringify(da.datenauskunftAbschnitte({ vorname: "Tom" }, ctx)));
    const th = a.find(x => x.titel === "Theorieunterricht");
    assert.equal(JSON.stringify(th.zeilen), JSON.stringify([["20.09.2026", "Ruhender Verkehr"]]));
    assert.ok(a.some(x => x.titel === "Hinweis zu den Terminen"));
    const d = JSON.parse(JSON.stringify(da.datenauskunftDatei({ vorname: "Tom" }, ctx)));
    assert.equal(d.dokumente, "konnte nicht geladen werden");
    assert.equal(d.theorieunterricht.length, 2);
    const n = JSON.parse(JSON.stringify(da.datenauskunftAbschnitte({ vorname: "Tom" }, { theorie: null })));
    assert.match(JSON.stringify(n.find(x => x.titel === "Theorieunterricht")), /nicht geladen/);
});

// v2.69.0: Geführte Prüfungsakte
const pa = require("./lade-app")(["pruefungsAblauf", "PRUEFUNG_TERMINART"]);
test("Prüfungsakte: Schritte, aktueller Schritt, Wiederholung, geplanter Versuch", () => {
    const heute = "2026-09-30";
    const ok = [{ ok: true, text: "Theorie" }];
    // 1. neuer Schüler
    let a = JSON.parse(JSON.stringify(pa.pruefungsAblauf({ id: "s1" }, { heute, unterlagenOffen: ["Sehtest"], praxisVoraus: [{ ok: false, text: "Theorie" }] })));
    assert.equal(a.theorie.aktuell, "voraussetzungen");
    assert.equal(JSON.stringify(a.praxis.schritte.map(x => x.key)), JSON.stringify(["voraussetzungen", "reife", "platz", "termin", "ergebnis"]));
    assert.equal(JSON.stringify(a.theorie.schritte.map(x => x.key)), JSON.stringify(["voraussetzungen", "platz", "termin", "ergebnis"]));
    // 2. Theorie bestanden, Reife da, Praxisplatz zugeteilt, Termin im Kalender
    const stu = { id: "s1", exams: [{ id: "e1", art: "theorie", date: "2026-08-01", passed: true }], examReadiness: { ergebnis: "bestanden", datum: "2026-09-20" } };
    const slots = [{ id: "p1", art: "praxis", status: "vergeben", student_id: "s1", datum: "2026-10-14", zeit: "09:30", ort: "TÜV" },
                   { id: "p2", art: "praxis", status: "vergeben", student_id: "anderer", datum: "2026-10-10" }];
    a = JSON.parse(JSON.stringify(pa.pruefungsAblauf(stu, { heute, slots, praxisVoraus: ok })));
    assert.equal(a.theorie.bestanden, "2026-08-01");
    assert.equal(a.theorie.aktuell, null);
    assert.equal(a.praxis.platz.datum, "2026-10-14");
    assert.equal(a.praxis.aktuell, "termin");
    a = JSON.parse(JSON.stringify(pa.pruefungsAblauf(stu, { heute, slots, praxisVoraus: ok, termine: [{ art: "PF", start_at: "2026-10-14T07:30:00Z", status: "confirmed" }] })));
    assert.equal(a.praxis.aktuell, "ergebnis");
    // 3. Durchgefallen am Platztag -> Platz aufgelöst, Wiederholung
    const nach = { ...stu, exams: [...stu.exams, { id: "e2", art: "praxis", date: "2026-10-14", passed: false }] };
    a = JSON.parse(JSON.stringify(pa.pruefungsAblauf(nach, { heute: "2026-10-20", slots, praxisVoraus: ok })));
    assert.equal(a.praxis.platz, null);
    assert.equal(a.praxis.fehlversuche, 1);
    assert.equal(a.praxis.aktuell, "platz");
    assert.match(a.praxis.schritte.find(x => x.key === "platz").label, /2\. Versuch/);
    // 4. geplanter Versuch ohne Prüfplatz-Liste
    const geplant = { ...stu, exams: [...stu.exams, { id: "e3", art: "praxis", date: "2026-10-30", passed: false }] };
    a = JSON.parse(JSON.stringify(pa.pruefungsAblauf(geplant, { heute, praxisVoraus: ok })));
    assert.equal(a.praxis.platz.quelle, "eintrag");
    assert.equal(a.praxis.platz.examId, "e3");
    // 5. bestanden über die Führerschein-Liste
    a = JSON.parse(JSON.stringify(pa.pruefungsAblauf({ id: "s1", licenseSteps: { praxis_bestanden: { done: true, date: "2026-09-01" } } }, { heute })));
    assert.equal(a.praxis.bestanden, "2026-09-01");
    assert.ok(a.praxis.schritte.every(x => x.erledigt));
});
test("Prüfungsakte: Fehlversuch am Prüfungstag zählt sofort, Theorie-Altwerte", () => {
    const heute = "2026-10-14";
    const slots = [{ id: "p1", art: "praxis", status: "vergeben", student_id: "s1", datum: "2026-10-14" }];
    const stu = { id: "s1", theorie: "2026-08-01", examReadiness: { ergebnis: "bestanden" },
        exams: [{ id: "e2", art: "praxis", date: "2026-10-14", passed: false, ergebnis: true }] };
    let a = JSON.parse(JSON.stringify(pa.pruefungsAblauf(stu, { heute, slots, praxisVoraus: [{ ok: true, text: "x" }] })));
    assert.equal(a.praxis.fehlversuche, 1);
    assert.equal(a.praxis.platz, null);
    assert.equal(a.praxis.aktuell, "platz");
    // ohne Kennzeichen (alte Liste) bleibt ein heutiger Versuch ein geplanter
    const alt = { ...stu, exams: [{ id: "e3", art: "praxis", date: "2026-10-14", passed: false }] };
    a = JSON.parse(JSON.stringify(pa.pruefungsAblauf(alt, { heute, slots, praxisVoraus: [{ ok: true, text: "x" }] })));
    assert.equal(a.praxis.fehlversuche, 0);
    assert.equal(a.praxis.platz.examId, "e3");
    // Theorie-Altwert ohne Datum gilt als bestanden
    a = JSON.parse(JSON.stringify(pa.pruefungsAblauf({ id: "s1", theorie: "bestanden" }, { heute })));
    assert.equal(a.theorie.bestanden, "ja");
    a = JSON.parse(JSON.stringify(pa.pruefungsAblauf({ id: "s1", theorie: "" }, { heute })));
    assert.equal(a.theorie.bestanden, null);
});

// v2.70.0: Übergabe-Faktenblatt
const uf = require("./lade-app")(["uebergabeFakten", "letzteBewertungen", "wiederkehrendeSchwaechenAus", "LESSON_FIELDS", "SMILEYS"]);
test("Übergabe-Faktenblatt: nur Abweichungen, Warnungen markiert", () => {
    const stu = { manualHours: "4", lastNote: "Spurwechsel links üben", sehhilfe: true,
        drivenLessons: [{ date: "2026-09-01", minutes: 90 }, { date: "2026-09-20", minutes: 45 }],
        lessons: [
            { date: "2026-09-20", ratings: { verkehr: 3, tempo: 1 } },
            { date: "2026-09-10", ratings: { tempo: 1 } },
            { date: "2026-09-01", ratings: { tempo: 2 } } ] };
    const ctx = { pct: 72.4, phase: "In Ausbildung", offenBetrag: 90, unterlagenOffen: ["Sehtest"], theorieBestanden: false,
        sonder: [{ label: "Überland", ue: 3, sollUe: 5, erfuellt: false, langeFahrtDabei: true }, { label: "Autobahn", ue: 4, sollUe: 4, erfuellt: true, langeFahrtDabei: false }],
        praxis: { bestanden: null, aktuell: "reife", schritte: [{ key: "reife", label: "Prüfungsreife festgestellt" }], platz: null, fehlversuche: 0 } };
    const z = JSON.parse(JSON.stringify(uf.uebergabeFakten(stu, ctx)));
    const w = l => (z.find(x => x.label === l) || {});
    assert.equal(w("Ausbildungsstand").wert, "72 % · In Ausbildung");
    assert.equal(w("Fahrstunden").wert, "3 UE (+ 4 vorher) · zuletzt 20.9.2026");
    assert.equal(w("Sonderfahrten").wert, "Überland 3/5 UE, Autobahn 4/4 UE (Doppelstunde fehlt)");
    assert.equal(w("Sonderfahrten").ton, "warn");
    assert.equal(w("Letzte Bewertung").wert, "Geschwindigkeitsanpassung: schlecht");
    assert.equal(w("Wiederkehrend schwach").wert, "Geschwindigkeitsanpassung");
    assert.equal(w("Nächstes Mal").wert, "Spurwechsel links üben");
    assert.equal(w("Konto").ton, "warn");
    assert.equal(w("Praxisprüfung").wert, "als Nächstes: Prüfungsreife festgestellt");
    assert.equal(w("Besonderheiten").wert, "Sehhilfe");
    // leerer Schüler: keine leeren Zeilen
    const leer = JSON.parse(JSON.stringify(uf.uebergabeFakten({}, {})));
    assert.ok(leer.every(x => x.wert.trim() !== ""));
});

// v2.71.0: Abrechnungsmodell Guthaben
const gm = require("./lade-app")(["abrechnungsModell", "ABRECHNUNG_STANDARD", "offeneLeistungen", "rechnungsEntwurfZeilen", "sumCharges", "sumPayments"]);
test("Guthaben-Modell: nichts ist „nicht berechnet“, Saldo bleibt Posten minus Zahlungen", () => {
    const stu = { drivenLessons: [{ id: "l1", date: "2026-09-01", minutes: 45 }], costItems: [{ id: "c1", label: "Grundbetrag", amount: 300 }],
        payments: [{ amount: 500, invoiceId: "inv1" }] };
    gm.ABRECHNUNG_STANDARD.modell = "offen";
    assert.equal(gm.abrechnungsModell(stu), "offen");
    assert.equal(gm.offeneLeistungen(stu, 60).length, 2);          // Standard: Stunde + Posten offen
    assert.ok(gm.rechnungsEntwurfZeilen(stu, 60).length > 0);
    gm.ABRECHNUNG_STANDARD.modell = "guthaben";
    assert.equal(gm.abrechnungsModell(stu), "guthaben");
    assert.equal(gm.offeneLeistungen(stu, 60).length, 0);          // kommt nicht in „nicht berechnet“
    assert.equal(gm.rechnungsEntwurfZeilen(stu, 60).length, 0);    // keine zweite Rechnung über Leistungen
    assert.equal(Math.round((gm.sumCharges(stu, 60) - gm.sumPayments(stu)) * 100) / 100, -140); // 140 € Guthaben übrig
    // Ausnahme je Schüler (z.B. Firmenkunde) schlägt den Standard
    assert.equal(gm.abrechnungsModell({ ...stu, abrechnungsModell: "offen" }), "offen");
    assert.equal(gm.offeneLeistungen({ ...stu, abrechnungsModell: "offen" }, 60).length, 2);
    gm.ABRECHNUNG_STANDARD.modell = "offen";
    assert.equal(gm.abrechnungsModell({ abrechnungsModell: "guthaben" }), "guthaben");
});

// v2.72.0: Handlungsbedarf
const hb = require("./lade-app")(["hinweiseOrdnen", "hinweisSignatur", "HINWEIS_STUFEN", "pruefungenMitLuecken"]);
test("Handlungsbedarf: dringend zuerst, Zurückstellen, Signatur ändert sich mit dem Text", () => {
    const items = [{ key: "paket", text: "1 Paket knapp" }, { key: "rechn", text: "2 überfällige Rechnungen", red: true }, { key: "chance", text: "Lücke", prio: "chance" }, { key: "still", text: "3 lange nicht gefahren" }];
    let r = JSON.parse(JSON.stringify(hb.hinweiseOrdnen(items, {}, "2026-09-30")));
    assert.equal(JSON.stringify(r.sichtbar.map(x => x.key)), JSON.stringify(["rechn", "paket", "still", "chance"]));
    const z = { [hb.hinweisSignatur(items[0])]: "2026-10-07", [hb.hinweisSignatur(items[1])]: "2026-10-07" };
    r = JSON.parse(JSON.stringify(hb.hinweiseOrdnen(items, z, "2026-09-30")));
    assert.equal(JSON.stringify(r.versteckt.map(x => x.key)), JSON.stringify(["paket"]));   // Dringendes bleibt sichtbar
    assert.ok(r.sichtbar.some(x => x.key === "rechn"));
    r = JSON.parse(JSON.stringify(hb.hinweiseOrdnen([{ key: "paket", text: "2 Pakete knapp" }], z, "2026-09-30")));
    assert.equal(r.versteckt.length, 0);                                                     // neuer Text -> wieder da
    r = JSON.parse(JSON.stringify(hb.hinweiseOrdnen(items, z, "2026-10-08")));
    assert.equal(r.versteckt.length, 0);                                                     // abgelaufen
});
test("Handlungsbedarf: Prüfungen in 7 Tagen mit Lücken", () => {
    const ab = (datum, schritte) => ({ theorie: { bestanden: "2026-08-01" }, praxis: { bestanden: null, platz: { datum }, schritte } });
    const s = [
        { stu: { id: "a" }, ablauf: ab("2026-10-03", [{ key: "voraussetzungen", erledigt: false, offen: [{ text: "Sonderfahrten erfüllt" }, { text: "Unterlagen vollständig" }] }, { key: "reife", erledigt: true }, { key: "platz", erledigt: true }, { key: "termin", erledigt: false }, { key: "ergebnis", erledigt: false }]) },
        { stu: { id: "b" }, ablauf: ab("2026-10-20", [{ key: "termin", erledigt: false }]) },           // zu weit weg
        { stu: { id: "c" }, ablauf: ab("2026-10-01", [{ key: "voraussetzungen", erledigt: true }, { key: "termin", erledigt: true }, { key: "ergebnis", erledigt: false }]) }, // alles da
    ];
    const r = JSON.parse(JSON.stringify(hb.pruefungenMitLuecken(s, "2026-09-30")));
    assert.equal(r.length, 1);
    assert.equal(r[0].tage, 3);
    assert.equal(JSON.stringify(r[0].offen), JSON.stringify(["Sonderfahrten", "Unterlagen", "Kalendereintrag"]));
});

// v2.73.0: Vor der Fahrt
const vf = require("./lade-app")(["vorDerFahrtPunkte", "letzteBewertungen", "wiederkehrendeSchwaechenAus", "LESSON_FIELDS", "SMILEYS"]);
test("Vor der Fahrt: Ziel, Notiz ohne Dopplung, Abweichungen, Sonderfahrt, Prüfungswarnungen", () => {
    const stu = { lastNote: "Spurwechsel links", lessons: [{ date: "2026-09-28", ratings: { tempo: 1, verkehr: 3, komm: 2 } }] };
    const appt = { art: "AB" };
    const ctx = { lernziel: { typ: "ziel", text: "Spurwechsel links" }, heute: "2026-10-01",
        sonder: [{ code: "AB", label: "Autobahnfahrt", ue: 2, sollUe: 4, erfuellt: false, langeFahrtDabei: false }],
        pruefungDatum: "2026-10-06", offenBetrag: 120, unterlagenOffen: ["Antrag"] };
    const p = JSON.parse(JSON.stringify(vf.vorDerFahrtPunkte(stu, appt, ctx))).map(x => x.text);
    assert.equal(p[0], "Ziel: Spurwechsel links");
    assert.ok(!p.some(t => t.startsWith("Nächstes Mal")));                 // identisch mit dem Ziel -> nicht doppelt
    assert.equal(p[1], "Zuletzt: Geschwindigkeitsanpassung schlecht, Kommunikation mittel");
    assert.equal(p[2], "Autobahnfahrt: 2 von 4 UE");
    assert.equal(p[3], "Prüfung am 06.10. (in 5 Tagen)");
    assert.equal(p[4], "Fehlt noch: Antrag");
    assert.equal(p[5].replace(/\s/g, " "), "120,00 € offen vor der Prüfung");
    // Prüfung zu weit weg -> keine Prüfungspunkte; ohne Daten -> leer
    assert.ok(!JSON.stringify(vf.vorDerFahrtPunkte(stu, appt, { ...ctx, pruefungDatum: "2026-11-30" })).includes("Prüfung am"));
    assert.equal(vf.vorDerFahrtPunkte({}, { art: "ÜST" }, {}).length, 0);
});

// v2.74.0: Monatsabrechnung laut Kalender
const ma = require("./lade-app")(["monatsAufschluesselung", "monatsAufschluesselungText", "ART_GROUP_OF", "MONAT_SONSTIGE_ARTEN"]);
test("Monatsabrechnung: Aufschlüsselung je Fahrlehrer aus dem Kalender", () => {
    const t = [
        { lehrer_id: "a", start_at: "2026-09-01T08:00:00Z", end_at: "2026-09-01T09:30:00Z", art: "ÜST" },   // 90
        { lehrer_id: "a", start_at: "2026-09-02T08:00:00Z", end_at: "2026-09-02T09:30:00Z", art: "AB" },    // 90 Sonder
        { lehrer_id: "a", start_at: "2026-09-03T08:00:00Z", end_at: "2026-09-03T08:55:00Z", art: "PF" },    // Prüfung
        { lehrer_id: "a", start_at: "2026-09-04T16:00:00Z", end_at: "2026-09-04T17:30:00Z", art: "TH" },    // 90 Theorie
        { lehrer_id: "a", start_at: "2026-09-05T08:00:00Z", end_at: "2026-09-05T09:00:00Z", art: "ST" },    // 60 Sonstiges
        { lehrer_id: "a", start_at: "2026-09-06T08:00:00Z", end_at: "2026-09-06T08:30:00Z", art: "ÜST", typ: "sonstige" }, // 30 Sonstiges
        { lehrer_id: "a", start_at: "2026-09-07T00:00:00+02:00", end_at: "2026-09-07T23:59:00+02:00", typ: "urlaub" },
        { lehrer_id: "a", start_at: "2026-09-07T00:00:00+02:00", end_at: "2026-09-07T23:59:00+02:00", typ: "urlaub" }, // gleicher Tag
        { lehrer_id: "a", start_at: "2026-09-08T08:00:00Z", end_at: "2026-09-08T12:00:00Z", art: "PRIVAT", typ: "privat" },
        { lehrer_id: "b", start_at: "2026-09-01T08:00:00Z", art: "SF" },                                    // ohne Ende = 45
    ];
    const r = JSON.parse(JSON.stringify(ma.monatsAufschluesselung(t)));
    assert.equal(JSON.stringify(r.a), JSON.stringify({ fahrstunden: 90, sonderfahrten: 90, pruefungen: 1, pruefungMin: 55, theorie: 90, sonstiges: 90, urlaubTage: 1 }));
    assert.equal(r.b.fahrstunden, 45);
    assert.equal(ma.monatsAufschluesselungText(r.a), "Fahrstunden 2 UE · Sonderfahrten 2 UE · 1 Prüfung · Theorie 1,5 Std. · Sonstiges 1,5 Std. · Urlaub/Krank 1 Tag");
});

// v2.75.0: Navigation
const nv = require("./lade-app")(["navAdresse", "navLink", "routeLink"]);
test("Navigation: Standortname wird Adresse, Links für Apple/Google, Route mit Zwischenzielen", () => {
    const st = [{ name: "Innenstadt", street: "Hauptstr. 1", zip: "77652", city: "Offenburg" }, { name: "Nord" }];
    assert.equal(nv.navAdresse("innenstadt", st), "Hauptstr. 1, 77652 Offenburg");
    assert.equal(nv.navAdresse("Nord", st), "Nord");                       // Standort ohne Adresse
    assert.equal(nv.navAdresse("Bahnhof Offenburg", st), "Bahnhof Offenburg");
    assert.equal(nv.navAdresse("  ", st), "");
    assert.equal(nv.navLink("Bahnhof Offenburg", true), "https://maps.apple.com/?daddr=Bahnhof%20Offenburg&dirflg=d");
    assert.equal(nv.navLink("Bahnhof Offenburg", false), "https://www.google.com/maps/dir/?api=1&destination=Bahnhof%20Offenburg&travelmode=driving");
    assert.equal(nv.routeLink(["A", "A", "B", "C"]), "https://www.google.com/maps/dir/?api=1&destination=C&travelmode=driving&waypoints=A%7CB");
    assert.equal(nv.routeLink([]), "");
});
test("Vor der Fahrt: Antrag-Erinnerung bei den ersten Fahrstunden", () => {
    const p = JSON.parse(JSON.stringify(vf.vorDerFahrtPunkte({}, { art: "ÜST" }, { antragFehlt: true }))).map(x => x.text);
    assert.equal(JSON.stringify(p), JSON.stringify(["Antrag bei der Führerscheinstelle noch nicht gestellt"]));
    assert.equal(vf.vorDerFahrtPunkte({}, { art: "ÜST" }, { antragFehlt: false }).length, 0);
});

// v2.77.0: Buchungsseite – WhatsApp-Nummer
const wn = require("./lade-app")(["waNummerOeffentlich"]);
test("Buchungsseite: Telefonnummer wird WhatsApp-tauglich", () => {
    assert.equal(wn.waNummerOeffentlich("0171 123 45-67"), "491711234567");
    assert.equal(wn.waNummerOeffentlich("+49 171 1234567"), "491711234567");
    assert.equal(wn.waNummerOeffentlich("0049 171 1234567"), "491711234567");
    assert.equal(wn.waNummerOeffentlich(""), "");
});

test("Live-Kalender: nur Anfragen, Absage-Wünsche und übernommene freie Termine melden", () => {
    const m = require("./lade-app")(["liveTerminMeldung"]).liveTerminMeldung;
    const neu = { id: "a1", title: "Lena Berger", start_at: "2026-10-02T13:30:00Z", status: "pending" };
    const r = m(null, neu);
    assert.equal(r.titel, "Neue Terminanfrage");
    assert.match(r.text, /^Neue Terminanfrage\nLena Berger · Fr\.? 02\.10\., 15:30$/);
    // schon bekannt (z.B. eigener Vorschlag) -> keine Meldung
    assert.equal(m({ id: "a1", status: "pending" }, neu), null);
    // vom Fahrlehrer bestätigt -> still
    assert.equal(m({ id: "a1", status: "pending" }, { ...neu, status: "confirmed" }), null);
    // Absage-Wunsch, aber nur beim Wechsel
    assert.equal(m({ id: "a1", status: "confirmed" }, { ...neu, status: "cancel_requested" }).titel, "Absage-Wunsch");
    assert.equal(m({ id: "a1", status: "cancel_requested" }, { ...neu, status: "cancel_requested" }), null);
    // freier Termin übernommen
    assert.equal(m({ id: "a1", status: "offered" }, { ...neu, status: "confirmed" }).titel, "Freien Termin übernommen");
    // neuer bestätigter Termin (anderes Gerät) -> still; kaputte Zeile -> null
    assert.equal(m(null, { ...neu, status: "confirmed" }), null);
    assert.equal(m(null, null), null);
    assert.equal(m(null, { ...neu, title: "" }).text.startsWith("Neue Terminanfrage\nOhne Namen"), true);
});

test("Unterlagen vom Schüler: Stand je Unterlage aus der jüngsten Sendung", () => {
    const st = require("./lade-app")(["schuelerUploadStand"]).schuelerUploadStand;
    assert.equal(st(null, "sehtest"), null);
    assert.equal(st([{ category: "passfoto", am: "2026-10-01T10:00:00Z", geprueft: false }], "sehtest"), null);
    assert.equal(st([{ category: "sehtest", am: "2026-10-01T10:00:00Z", geprueft: false }], "sehtest"), "wartet");
    // erst geprüft, dann neues Foto geschickt -> wartet wieder
    assert.equal(st([{ category: "sehtest", am: "2026-10-01T10:00:00Z", geprueft: true }, { category: "sehtest", am: "2026-10-02T10:00:00Z", geprueft: false }], "sehtest"), "wartet");
    assert.equal(st([{ category: "sehtest", am: "2026-10-03T10:00:00Z", geprueft: true }, { category: "sehtest", am: "2026-10-02T10:00:00Z", geprueft: false }], "sehtest"), "geprueft");
});

test("Rückruf aus dem Chat: letzte drei Fragen als Notiz, höchstens 500 Zeichen", () => {
    const f = require("./lade-app")(["chatFragenText"]).chatFragenText;
    assert.equal(f([]), "");
    assert.equal(f([{ role: "user", text: "a" }, { role: "assistant", text: "x" }, { role: "user", text: "  b  \n c " }]), "a · b c");
    assert.equal(f([1, 2, 3, 4].map(i => ({ role: "user", text: "F" + i }))), "F2 · F3 · F4");
    assert.equal(f([{ role: "user", text: "x".repeat(800) }]).length, 500);
});

test("Kalender drucken: Zeitraum, Kurznamen, Termine je Tag", () => {
    const k = require("./lade-app")(["kalenderDruckZeitraum", "kalenderDruckTage", "kurzName"]);
    const heute = new Date("2026-10-01T10:00:00Z"); // Donnerstag
    const w = k.kalenderDruckZeitraum("woche", heute);
    assert.equal(w.von, "2026-09-28"); assert.equal(w.bis, "2026-10-04"); assert.equal(w.monat, false);
    assert.match(w.titel, /^KW 40 · 28\.09\.–04\.10\.2026$/);
    assert.equal(k.kalenderDruckZeitraum("naechste", heute).von, "2026-10-05");
    const m = k.kalenderDruckZeitraum("monat", heute);
    assert.equal(m.von, "2026-09-28"); assert.equal(m.bis, "2026-11-01"); assert.equal(m.monatErster, "2026-10-01"); assert.equal(m.monatLetzter, "2026-10-31");
    assert.equal(k.kalenderDruckZeitraum("naechsterMonat", heute).monatErster, "2026-11-01");
    assert.equal(k.kurzName("Lena Berger"), "Lena B."); assert.equal(k.kurzName("Anna Maria von Stein"), "Anna S."); assert.equal(k.kurzName("Ida"), "Ida");
    const U = "§URLAUB§", S = "§SONST§";
    const termine = [
        { start_at: "2026-09-29T14:00:00Z", end_at: "2026-09-29T14:45:00Z", title: "Lena Berger", art: "ÜST", status: "confirmed", abholort: "Innenstadt" },
        { start_at: "2026-09-29T07:00:00Z", end_at: "2026-09-29T07:45:00Z", title: "Ida Lorenz", art: "AB", status: "confirmed" },
        { start_at: "2026-09-30T08:00:00Z", title: "Jonas Weber", art: "ÜST", status: "pending" },
        { start_at: "2026-09-30T09:00:00Z", title: "Frei", art: "ÜST", status: "offered" },
        { start_at: "2026-10-01T22:00:00Z", end_at: "2026-10-03T21:59:00Z", title: "Urlaub", note: U, status: "confirmed" },
        { start_at: "2026-09-28T10:00:00Z", end_at: "2026-09-28T11:00:00Z", title: "Büro", note: S + "x", art: "ÜST", status: "confirmed" },
    ];
    const t = k.kalenderDruckTage(termine, w.von, w.bis, { kurzNamen: true, abholort: true, urlaubMark: U, sonstMark: S });
    assert.equal(t.length, 7);
    const di = t[1].eintraege;
    assert.deepEqual(JSON.parse(JSON.stringify(di.map(e => [e.zeit, e.titel, e.art, e.ort]))), [["09:00–09:45", "Ida L.", "AB", ""], ["16:00–16:45", "Lena B.", "ÜST", "Innenstadt"]]);
    assert.equal(t[2].eintraege.length, 0, "Anfrage ohne Haken und offered fehlen");
    assert.equal(t[3].eintraege.length, 0); assert.equal(t[4].eintraege[0].typ, "urlaub"); assert.equal(t[5].eintraege[0].titel, "Urlaub");
    assert.equal(t[0].eintraege[0].typ, "sonst"); assert.equal(t[0].eintraege[0].titel, "Büro");
    const mitAnfragen = k.kalenderDruckTage(termine, w.von, w.bis, { anfragen: true });
    assert.equal(mitAnfragen[2].eintraege[0].typ, "anfrage");
});

test("Prüfungstag: heutige Prüfungen, Phase, Ergebnis, Checkliste", () => {
    const k = require("./lade-app")(["pruefungstagEintraege", "pruefungstagCheckliste"]);
    const heute = "2026-10-02";
    const stu = [{ id: "s1", vorname: "Lena", sehhilfe: true, exams: [] }, { id: "s2", vorname: "Ida", exams: [{ art: "theorie", date: heute, passed: true, ergebnis: true }] }];
    const termine = [
        { id: "a1", student_id: "s1", art: "PF", status: "confirmed", start_at: "2026-10-02T08:00:00Z", end_at: "2026-10-02T08:55:00Z" },
        { id: "a2", student_id: "s2", art: "VT", status: "confirmed", start_at: "2026-10-02T06:00:00Z", end_at: "2026-10-02T07:00:00Z" },
        { id: "a3", student_id: "s1", art: "ÜST", status: "confirmed", start_at: "2026-10-02T10:00:00Z" },
        { id: "a4", student_id: "s1", art: "PF", status: "pending", start_at: "2026-10-02T12:00:00Z" },
        { id: "a5", student_id: "s1", art: "PF", status: "confirmed", start_at: "2026-10-03T08:00:00Z" },
        { id: "a6", student_id: "fremd", art: "PF", status: "confirmed", start_at: "2026-10-02T09:00:00Z" },
    ];
    const vor = k.pruefungstagEintraege(termine, stu, heute, new Date("2026-10-02T07:30:00Z").getTime());
    assert.deepEqual(rein(vor.map(e => [e.appt.id, e.art, e.phase, e.ergebnis])), [["a2", "theorie", "nachher", true], ["a1", "praxis", "vorher", null]]);
    const laeuft = k.pruefungstagEintraege(termine, stu, heute, new Date("2026-10-02T08:20:00Z").getTime());
    assert.equal(laeuft[1].phase, "laeuft");
    const c = k.pruefungstagCheckliste("praxis", stu[0], ["Sehtest"]);
    assert.deepEqual(JSON.parse(JSON.stringify(c)), ["Personalausweis oder Reisepass", "Brille oder Kontaktlinsen", "Ausbildungsnachweis", "Fahrzeug bereit (getankt, Papiere an Bord)", "Fehlt laut Akte: Sehtest"]);
    assert.equal(k.pruefungstagCheckliste("theorie", {}, ["A", "B"])[1], "Fehlt laut Akte: A, B");
    assert.deepEqual(JSON.parse(JSON.stringify(k.pruefungstagCheckliste("theorie", stu[0], []))), ["Personalausweis oder Reisepass"]);
});

test("Theorie-Stand: Stufen, nächster Schritt, Theorie bremst", () => {
    const f = require("./lade-app")(["theorieStandVon"]).theorieStandVon;
    const heute = "2026-10-02";
    assert.equal(f({ theorie: "2026-09-01" }, { heute }).stufe, "bestanden");
    assert.match(f({ theorie: "2026-09-01" }, { heute }).text, /^Bestanden am 01\.09\.2026$/);
    assert.equal(f({ theorie: "false" }, { heute }).stufe, "offen");
    assert.equal(f({}, { heute, vtTermin: "2026-10-10" }).stufe, "termin");
    assert.equal(f({}, { heute, vtTermin: "2026-09-10" }).stufe, "offen", "vergangener VT-Termin zählt nicht");
    assert.equal(f({ licenseSteps: { theorie_angemeldet: { done: true } } }, { heute }).stufe, "angemeldet");
    const sicher = { licenseSteps: { antrag: { done: true } }, theoryMockExams: [{ passed: false }, { passed: true }, { passed: true }, { passed: true }] };
    assert.equal(f(sicher, { heute }).stufe, "bereit");
    assert.equal(f(sicher, { heute }).schritt, "Zur Theorieprüfung anmelden");
    assert.equal(f({}, { heute }).schritt, "Antrag bei der Führerscheinstelle stellen");
    const b = f({ licenseSteps: { antrag: { done: true } }, exams: [{ art: "theorie", ergebnis: true, passed: false }] }, { heute, ueGefahren: 24 });
    assert.equal(b.bremst, true); assert.equal(b.text, "1 Fehlversuch"); assert.match(b.schritt, /Praxis ist schon weit/);
    assert.equal(f({}, { heute, ueGefahren: 19 }).bremst, false);
    assert.equal(f({}, { heute, lernPct: 92 }).stufe, "bereit"); assert.equal(f({}, { heute, lernPct: 92 }).text, "Lernstand 92 %");
    assert.equal(f({}, { heute, lernPct: 60 }).stufe, "offen");
    assert.equal(f({ theoryMockExams: [{ passed: false }] }, { heute }).probeText, "1 Probeprüfung, zuletzt nicht bestanden");
});

test("Theorie-Lernstand: Breite und Wiederholung zählen, falsch setzt zurück", () => {
    const k = require("./lade-app")(["theorieLernstand", "theorieFach"]);
    const qs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    assert.equal(k.theorieLernstand({}, qs).pct, 0);
    // eine Frage 1x richtig = 25 % von einer Frage = 6 % gesamt
    assert.equal(k.theorieLernstand({ a: { correct: true, box: 2 } }, qs).pct, 6);
    // eine Frage sitzt (Fach 5) = 25 % gesamt
    const r = k.theorieLernstand({ a: { correct: true, box: 5 } }, qs);
    assert.equal(r.pct, 25); assert.equal(r.sitzt, 1);
    // alle sitzen = 100 %
    assert.equal(k.theorieLernstand({ a: { correct: true, box: 5 }, b: { correct: true, box: 5 }, c: { correct: true, box: 5 }, d: { correct: true, box: 5 } }, qs).pct, 100);
    // falsch beantwortet = Fach 1 = 0, zählt aber als beantwortet
    const f = k.theorieLernstand({ a: { correct: false, box: 1 }, b: { marked: true } }, qs);
    assert.equal(f.pct, 0); assert.equal(f.beantwortet, 1); assert.equal(f.gelernt, 0);
    // Altdaten ohne Fach: richtig = Fach 2
    assert.equal(k.theorieFach({ correct: true }), 2); assert.equal(k.theorieFach({ correct: false }), 1); assert.equal(k.theorieFach({ marked: true }), 0);
    assert.equal(k.theorieLernstand({}, []).pct, 0);
});

test("Nutzungsstatistik: Ereignisnamen sind kurz, klein und ohne Sonderzeichen", () => {
    const n = require("./lade-app")(["nutzungName"]).nutzungName;
    assert.equal(n("bereich:Kalender"), "bereich:kalender");
    assert.equal(n("einstellung:Führerschein Übersicht"), "einstellung:fuehrerschein_uebersicht");
    assert.equal(n("x".repeat(80)).length, 60);
    assert.match(n("druck:<script>"), /^[a-z0-9_:.\-]+$/);
});

test("Fahrsimulator: Terminart SIM zählt als Fahrstunde, nie als Sonderfahrt", () => {
    const k = require("./lade-app")(["APPT_ART", "SONDERFAHRT_ARTEN", "ART_ZAEHLT_STANDARD_NICHT", "arbeitszeitArt", "ART_GROUP_OF"]);
    const sim = k.APPT_ART.find(a => a.code === "SIM");
    assert.ok(sim, "SIM fehlt in APPT_ART");
    assert.equal(sim.countsAsLesson, undefined);
    assert.equal(k.ART_ZAEHLT_STANDARD_NICHT.indexOf("SIM"), -1);
    assert.equal(k.SONDERFAHRT_ARTEN.some(s => s.code === "SIM"), false);
    assert.equal(k.ART_GROUP_OF.SIM, "Fahrstunden");
    assert.equal(k.arbeitszeitArt({ art: "SIM", status: "confirmed" }), "praxis");
});

test("Kalender drucken als Zeitstrahl: Überlappungen nebeneinander, Stundenbereich", () => {
    const k = require("./lade-app")(["kalenderDruckSpuren", "kalenderDruckStunden", "kalenderDruckTage"]);
    const e = (id, s, en) => ({ id, typ: "termin", startMin: s, endMin: en });
    // 9:00-9:45 allein; 10:00-11:30 und 11:00-11:45 überlappen; 11:30-12:15 passt in Spur 0 nach 11:30
    const r = k.kalenderDruckSpuren([e("a", 540, 585), e("b", 600, 690), e("c", 660, 705), e("d", 690, 735), { typ: "urlaub", titel: "Urlaub" }]);
    const m = {}; r.forEach(x => { m[x.e.id] = [x.spur, x.spuren]; });
    assert.deepEqual(rein(m), { a: [0, 1], b: [0, 2], c: [1, 2], d: [0, 2] });
    assert.equal(r.length, 4, "Urlaub ist kein Block");
    assert.deepEqual(rein(k.kalenderDruckStunden([{ eintraege: [e("x", 600, 645)] }])), { von: 8, bis: 18 });
    assert.deepEqual(rein(k.kalenderDruckStunden([{ eintraege: [e("x", 390, 435), e("y", 1200, 1290)] }])), { von: 6, bis: 22 });
    // Minuten kommen aus kalenderDruckTage (Berliner Zeit)
    const t = k.kalenderDruckTage([{ start_at: "2026-09-29T07:00:00Z", end_at: "2026-09-29T07:45:00Z", title: "Ida Lorenz", art: "AB", status: "confirmed" }], "2026-09-28", "2026-10-04", {});
    assert.equal(t[1].eintraege[0].startMin, 540); assert.equal(t[1].eintraege[0].endMin, 585);
});

test("Schüler-Mitteilungen: Texte je Typ in der Sprache des Schülers", () => {
    const k = require("./lade-app")(["mitteilungText", "tt"]);
    const de = (key, v) => k.tt("de", key, v), en = (key, v) => k.tt("en", key, v);
    const m = { typ: "verschoben", start_at: "2026-10-05T12:00:00Z", alt_start_at: "2026-10-05T11:00:00Z", art: "AB" };
    const t = k.mitteilungText(m, de, "de");
    assert.match(t, /^Termin verschoben auf .*05\.10\.2026.*14:00.*\(Autobahnfahrt\) \(vorher .*13:00/);
    assert.match(k.mitteilungText({ typ: "abgesagt", start_at: "2026-10-05T12:00:00Z", art: "ÜST" }, en, "en"), /^Lesson cancelled: /);
    for (const typ of ["neu", "bestaetigt", "verschoben", "abgesagt", "storno_ok", "storno_abgelehnt"])
        assert.doesNotMatch(k.mitteilungText({ typ, start_at: "2026-10-05T12:00:00Z" }, de, "de"), /^mt_/, typ + " ohne Text");
});

test("Rundnachricht: Empfänger-Gruppen und Nachrichtentext in der Schüler-App", () => {
    const k = require("./lade-app")(["rundnachrichtGruppen", "mitteilungText", "tt"]);
    const liste = [
        { id: "a", klasse: "B", standort: "s1", reif: true, ohneTermin: false },
        { id: "b", klasse: "A", standort: "s2", reif: false, ohneTermin: true },
        { id: "c", klasse: "B", standort: "", reif: false, ohneTermin: true },
    ];
    const g = k.rundnachrichtGruppen(liste, [{ id: "s1", name: "Innenstadt" }, { id: "s2", name: "Nord" }]);
    const m = {}; g.forEach(x => { m[x.id] = x.ids.join(","); });
    assert.deepEqual(rein(m), { alle: "a,b,c", reif: "a", ohneTermin: "b,c", "k:A": "b", "k:B": "a,c", "s:s1": "a", "s:s2": "b" });
    // eine Klasse, ein Standort, niemand reif: nur "Alle" und "Ohne nächsten Termin"
    const g2 = k.rundnachrichtGruppen([{ id: "x", klasse: "B", ohneTermin: true }], [{ id: "s1" }]);
    assert.deepEqual(rein(g2.map(x => x.id)), ["alle", "ohneTermin"]);
    const de = (key, v) => k.tt("de", key, v);
    assert.equal(k.mitteilungText({ typ: "nachricht", text: "Wir haben zu." }, de, "de"), "Wir haben zu.");
    for (const l of ["de", "en", "tr", "ru"]) {
        assert.doesNotMatch(k.tt(l, "mt_nachricht_von", { name: "Anna" }), /^mt_/, l);
        assert.match(k.tt(l, "mt_nachricht_von", { name: "Anna" }), /Anna/, l);
        assert.doesNotMatch(k.tt(l, "mt_nachricht_fs"), /^mt_/, l);
    }
});

test("SEPA-Lastschrift: IBAN, Gläubiger-ID, Bankarbeitstage, Bankdatei, Einzugsliste", () => {
    const k = require("./lade-app")(["ibanPruefen", "glaeubigerIdPruefen", "sepaFruehesterEinzug", "sepaIstBankarbeitstag", "sepaText",
        "sepaMandatsreferenz", "sepaLastschriftXml", "sepaEinzugKandidaten", "sepaMandatAktiv", "sepaAnfrageOffen", "sepaPostenAus"]);
    assert.equal(k.ibanPruefen("DE89 3704 0044 0532 0130 00").iban, "DE89370400440532013000");
    assert.equal(k.ibanPruefen("DE89370400440532013001").fehler, "pruefziffer");
    assert.equal(k.ibanPruefen("DE8937040044053201300").fehler, "laenge");
    assert.equal(k.glaeubigerIdPruefen("de98 zzz0 9999 9999 99").ok, true);
    assert.equal(k.glaeubigerIdPruefen("DE97ZZZ09999999999").fehler, "pruefziffer");
    // Fr 2.10. -> Di 6.10.; über Weihnachten (24.12. ist TARGET-Arbeitstag); über Ostern 2027
    assert.equal(k.sepaFruehesterEinzug("2026-10-02", 2), "2026-10-06");
    assert.equal(k.sepaFruehesterEinzug("2026-12-23", 2), "2026-12-28");
    assert.equal(k.sepaFruehesterEinzug("2027-03-25", 2), "2027-03-31");
    assert.equal(k.sepaIstBankarbeitstag("2026-05-01"), false);
    assert.equal(k.sepaText("Jürgen Müßig & Söhne", 70), "Juergen Muessig Soehne");
    assert.match(k.sepaMandatsreferenz("1b2c3d4e-aaaa-bbbb", "2026-10-02"), /^AD-[A-Z0-9]{1,12}-20261002$/);
    const xml = k.sepaLastschriftXml({ glaeubiger: { name: "Fahrschule Sonnenweg", iban: "DE89370400440532013000", bic: "", ci: "DE98ZZZ09999999999" },
        posten: [{ betrag: 45.5, name: "Ida <L>", iban: "DE02120300000000202051", mandat: "AD-X", mandatDatum: "2026-10-02", zweck: "R-1", e2e: "R-1", seq: "FRST" },
                 { betrag: 100, name: "Mia", iban: "DE02500105170137075030", bic: "INGDDEFFXXX", mandat: "AD-Y", mandatDatum: "2026-09-01", zweck: "R-2", e2e: "R-2", seq: "RCUR" },
                 { betrag: 0, name: "Null", iban: "DE02500105170137075030", mandat: "AD-Z", mandatDatum: "2026-09-01", zweck: "R-3", e2e: "R-3", seq: "RCUR" }],
        faelligAm: "2026-10-06", msgId: "AD-1", erstelltAm: "2026-10-02T10:00:00" });
    assert.match(xml, /pain\.008\.001\.08/);
    assert.match(xml, /<GrpHdr>.*<NbOfTxs>2<\/NbOfTxs><CtrlSum>145\.50<\/CtrlSum>/);
    assert.equal((xml.match(/<PmtInf>/g) || []).length, 2, "je Sequenztyp ein Sammelauftrag");
    assert.match(xml, /<SeqTp>FRST<\/SeqTp>.*<SeqTp>RCUR<\/SeqTp>/);
    assert.match(xml, /<Nm>Ida L<\/Nm>/, "Sonderzeichen entfernt, nichts unmaskiert");
    assert.match(xml, /<BICFI>INGDDEFFXXX<\/BICFI>/);
    assert.match(xml, /<Othr><Id>NOTPROVIDED<\/Id><\/Othr>/);
    // Einzugsliste: nur aktive Mandate, offene, nicht stornierte Rechnungen
    const mandat = { aktiv: true, referenz: "AD-A", datum: "2026-10-01", iban: "DE89370400440532013000", inhaber: "Anna A", stand: "2026-10-01T10:00:00.000Z" };
    const schueler = [
        { id: "a", vorname: "Anna", sepaMandat: mandat, invoices: [{ id: "i1", number: "R-1", total: 100 }, { id: "i2", number: "R-2", total: 50, cancelledBy: "S-1" }, { id: "i3", number: "R-3", total: 30 }],
          payments: [{ amount: 30, invoiceId: "i3" }] },
        { id: "b", vorname: "Ben", sepaMandat: { ...mandat, aktiv: false, widerrufenAm: "2026-10-02" }, invoices: [{ id: "i4", number: "R-4", total: 80 }] },
        { id: "c", vorname: "Cem", invoices: [{ id: "i5", number: "R-5", total: 80 }] },
    ];
    const kand = k.sepaEinzugKandidaten(schueler);
    assert.deepEqual(rein(kand.map(x => x.inv.number + ":" + x.offen)), ["R-1:100"]);
    const posten = k.sepaPostenAus(kand, "Sonnenweg");
    assert.equal(posten[0].seq, "FRST"); assert.equal(posten[0].mandat, "AD-A"); assert.equal(posten[0].name, "Anna A");
    // Anfrage: offen, bis ein neueres aktives Mandat existiert
    assert.equal(k.sepaAnfrageOffen({ sepaAnfrage: { am: "2026-10-02T09:00:00.000Z" } }), true);
    assert.equal(k.sepaAnfrageOffen({ sepaAnfrage: { am: "2026-10-02T09:00:00.000Z" }, sepaMandat: { ...mandat, stand: "2026-10-02T10:00:00.000Z" } }), false);
    assert.equal(k.sepaAnfrageOffen({ sepaAnfrage: { am: "2026-10-02T09:00:00.000Z" }, sepaMandat: mandat }), true, "älteres Mandat erledigt keine neue Anfrage");
});
