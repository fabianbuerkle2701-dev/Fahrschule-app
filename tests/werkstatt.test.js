// Werkstatt-Termine (Fabian 21.10.2026): Bausteine aus lib/werkstatt.js und die Regeln des Zeitjobs – ohne Netz.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const W = require("../netlify/functions/lib/werkstatt");
const V = require("../netlify/functions/vollautonom-werkstatt");

test("Berliner Zeit: Sommer- und Winterzeit, Umstellungstage", () => {
    assert.equal(W.berlinZeit("2026-10-23", 8), "2026-10-23T06:00:00.000Z");
    assert.equal(W.berlinZeit("2026-10-26", 8), "2026-10-26T07:00:00.000Z");
    assert.equal(W.berlinZeit("2026-03-30", 13), "2026-03-30T11:00:00.000Z");
    assert.deepEqual(W.berlinTeile("2026-10-28T07:00:00.000Z"), { datum: "2026-10-28", stunde: 8, minute: 0, wochentag: 3 });
});

test("Freie Zeiten: werktags, je Tag ein Fenster, vormittags vor nachmittags, ohne Belegtes", () => {
    const belegt = [
        { start: W.berlinZeit("2026-10-26", 9), ende: W.berlinZeit("2026-10-26", 10) },  // Mo vormittags belegt
        { start: W.berlinZeit("2026-10-27", 7), ende: W.berlinZeit("2026-10-27", 18) },  // Di ganz belegt
    ];
    const frei = W.freieZeiten(belegt, "2026-10-24", 3, 21); // ab Samstag
    assert.deepEqual(frei.map((z) => W.zeitText(z.start, z.ende)), [
        "Montag, 26.10.2026, nachmittags (13–17 Uhr)",
        "Mittwoch, 28.10.2026, vormittags (8–12 Uhr)",
        "Donnerstag, 29.10.2026, vormittags (8–12 Uhr)",
    ]);
    assert.deepEqual(W.freieZeiten([], "2026-10-24", 0, 21), []);
    assert.equal(W.zeitKurz(W.berlinZeit("2026-10-29", 8, 30), W.berlinZeit("2026-10-29", 14)), "Do 29.10., 8:30–14 Uhr");
});

test("Anfrage: Betreff und Text nach Vorlage, mit Ansprechpartner, Fälligkeit, Kilometern und Telefon", () => {
    const schule = { name: "Fahrschule Test", invoice_settings: { firma: "Fahrschule Test GmbH" }, locations: [{ name: "Mitte" }, { phone: "030 123" }] };
    const fahrzeug = { id: "v1", name: "VW Golf", plate: "S-FS 101", tuvDate: "2026-11-20", mileage: 84210 };
    const vorschlaege = W.freieZeiten([], "2026-10-26", 2, 21);
    assert.equal(W.anfrageBetreff("hu", fahrzeug), "Terminanfrage HU/TÜV · VW Golf (S-FS 101)");
    const hu = W.anfrageText({ schule, fahrzeug, werkstatt: { ansprechpartner: "Herr Kaya" }, anlass: "hu", vorschlaege });
    assert.match(hu, /^Guten Tag Herr Kaya,/);
    assert.match(hu, /steht die Hauptuntersuchung \(HU\/TÜV\) an, fällig im November 2026\./);
    assert.match(hu, /– Montag, 26\.10\.2026, vormittags \(8–12 Uhr\)\n– Dienstag, 27\.10\.2026, vormittags \(8–12 Uhr\)/);
    assert.match(hu, /Viele Grüße\nFahrschule Test GmbH\nTelefon 030 123$/);
    const service = W.anfrageText({ schule, fahrzeug, werkstatt: {}, anlass: "service", vorschlaege: [] });
    assert.match(service, /^Sehr geehrte Damen und Herren,/);
    assert.match(service, /die nächste Inspektion an\. Der Kilometerstand liegt bei etwa 84\.210 km\. Wann hätten Sie einen Termin frei\?/);
    assert.match(W.bestaetigungText({ schule, werkstatt: {}, fahrzeug, start: vorschlaege[0].start, ende: vorschlaege[0].ende }), /am Montag, 26\.10\.2026, vormittags \(8–12 Uhr\) eingetragen/);
});

test("Antwort der Werkstatt: Termin geprüft, Ende aus dem angefragten Fenster, eindeutig nur ohne Rückfrage", () => {
    const jetzt = Date.parse("2026-10-22T10:00:00Z");
    const vorschlaege = W.freieZeiten([], "2026-10-26", 3, 21);
    const ki = (x) => ({ zusage: false, gegenvorschlag: false, absage: false, termin_start: "", termin_ende: "", rueckfrage: false, zusammenfassung: "Text", ...x });
    let a = W.antwortPruefen(ki({ zusage: true, termin_start: "2026-10-27T08:00" }), vorschlaege, jetzt);
    assert.equal(a.start, "2026-10-27T07:00:00.000Z");
    assert.equal(a.ende, "2026-10-27T11:00:00.000Z", "Ende des angefragten Fensters");
    assert.equal(W.eindeutig(a), true);
    a = W.antwortPruefen(ki({ gegenvorschlag: true, termin_start: "2026-11-03T09:30", termin_ende: "2026-11-03T15:00" }), vorschlaege, jetzt);
    assert.equal(a.ende, "2026-11-03T14:00:00.000Z");
    assert.equal(W.eindeutig(a), true);
    a = W.antwortPruefen(ki({ gegenvorschlag: true, termin_start: "2026-11-04T10:00" }), vorschlaege, jetzt);
    assert.equal(new Date(a.ende) - new Date(a.start), 4 * 3600000, "ohne Ende und außerhalb der Fenster: vier Stunden");
    // Zusage ohne Termin, mit Rückfrage, Absage, Unsinn, zu weit weg → nicht eindeutig
    assert.equal(W.eindeutig(W.antwortPruefen(ki({ zusage: true }), vorschlaege, jetzt)), false);
    assert.equal(W.antwortPruefen(ki({ zusage: true }), vorschlaege, jetzt).rueckfrage, true);
    assert.equal(W.eindeutig(W.antwortPruefen(ki({ zusage: true, termin_start: "2026-10-27T08:00", rueckfrage: true }), vorschlaege, jetzt)), false);
    assert.equal(W.eindeutig(W.antwortPruefen(ki({ absage: true }), vorschlaege, jetzt)), false);
    assert.equal(W.antwortPruefen(ki({ zusage: true, termin_start: "morgen früh" }), vorschlaege, jetzt).start, null);
    assert.equal(W.antwortPruefen(ki({ zusage: true, termin_start: "2027-06-01T08:00" }), vorschlaege, jetzt).start, null);
    assert.equal(W.antwortPruefen(ki({ zusage: true, termin_start: "2026-10-01T08:00" }), vorschlaege, jetzt).start, null);
    assert.equal(W.antwortPruefen(null, vorschlaege, jetzt), null);
    // Schema: alle Felder Pflicht, nichts Zusätzliches (Bedingung der strukturierten Ausgabe)
    assert.deepEqual(W.SCHEMA.required.slice().sort(), Object.keys(W.SCHEMA.properties).sort());
    assert.equal(W.SCHEMA.additionalProperties, false);
    assert.doesNotMatch(W.SYSTEM, /\d{4}-\d{2}-\d{2}/, "kein Datum im System-Prompt");
});

test("Zeitjob: was ansteht, wann wieder angefragt wird, wann gesendet wird", () => {
    assert.deepEqual(V.anlaesse({ tuvDate: "2026-11-20", mileage: 84210, serviceIntervalKm: 30000, lastServiceKm: 60000 }, "2026-10-21"), ["hu"]);
    assert.deepEqual(V.anlaesse({ tuvDate: "2027-05-01", mileage: 89500, serviceIntervalKm: 30000, lastServiceKm: 60000 }, "2026-10-21"), ["service"]);
    assert.deepEqual(V.anlaesse({ tuvDate: "2026-09-01" }, "2026-10-21"), ["hu"], "überfällig");
    assert.deepEqual(V.anlaesse({}, "2026-10-21"), []);
    const jetzt = Date.parse("2026-10-21T10:00:00Z");
    const tageZurueck = (n) => new Date(jetzt - n * 86400000).toISOString();
    assert.equal(V.anfragenErlaubt([], jetzt), true);
    assert.equal(V.anfragenErlaubt([{ status: "gesendet", created_at: tageZurueck(40) }], jetzt), false);
    assert.equal(V.anfragenErlaubt([{ status: "gebucht", termin_start: tageZurueck(-5) }], jetzt), false, "Termin kommt noch");
    assert.equal(V.anfragenErlaubt([{ status: "gebucht", termin_start: tageZurueck(30) }], jetzt), false);
    assert.equal(V.anfragenErlaubt([{ status: "gebucht", termin_start: tageZurueck(70) }], jetzt), true);
    assert.equal(V.anfragenErlaubt([{ status: "abgelehnt", updated_at: tageZurueck(5) }], jetzt), false);
    assert.equal(V.anfragenErlaubt([{ status: "abgebrochen", updated_at: tageZurueck(20) }], jetzt), true);
    assert.equal(V.sendezeit(new Date("2026-10-21T06:30:00Z")), true, "Mi 8:30");
    assert.equal(V.sendezeit(new Date("2026-10-21T05:30:00Z")), false, "Mi 7:30");
    assert.equal(V.sendezeit(new Date("2026-10-25T09:00:00Z")), false, "Sonntag");
});
