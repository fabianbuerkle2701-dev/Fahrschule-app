// Ally (v2.120.0): Kürzel statt Namen, Gesundheitsfilter, Kalender-Filter und Kontextzeile.
// Genau diese Teile entscheiden, was das Gerät verlässt - deshalb hier ohne Browser geprüft.
const test = require("node:test");
const assert = require("node:assert/strict");
const k = require("./lade-app")(["ALLY_WERKZEUGE", "allyNeueKarte", "allyKuerzel", "allyNamenErsetzen", "allyKuerzelAufloesen", "allyGesundheit",
    "allyFreitext", "allyFilterPasst", "allyFilterLeer", "allyKontextZeile", "allyNamePasst", "allyWunschzeiten", "allyAntwortText", "allyDatumOk", "allyZeitOk",
    "ALLY_PLAN_ARTEN", "allyPlanZeilen", "allyVerschiebenText", "allyTagAusText", "allyGesundheitWort", "allyAbsageText", "allyPlanRueckfrage", "allyFolgefragen",
    "allyPlanKnopf", "allyRueckgaengigText", "allyZahlart", "allyPunktWert"]);

const PERSONEN = [
    { schluessel: "s:1", vorname: "Lena", nachname: "Weber", anzeige: "Lena Weber" },
    { schluessel: "s:2", vorname: "Jonas", nachname: "Becker", anzeige: "Jonas Becker" },
    { schluessel: "s:3", vorname: "Jonas", nachname: "Müller", anzeige: "Jonas Müller" },
    { schluessel: "s:4", vorname: "Mai", nachname: "Berg", anzeige: "Mai Berg" },
    { schluessel: "p:lena schmidt", vorname: "Lena", nachname: "Schmidt", anzeige: "Lena Schmidt" },
];
const ersetze = (t, karte) => k.allyNamenErsetzen(t, PERSONEN, karte || k.allyNeueKarte()).text;

test("Volle Namen und eindeutige Vornamen werden zu Kürzeln, ohne dass ein Name übrig bleibt", () => {
    const karte = k.allyNeueKarte();
    const t = ersetze("Wann hat Jonas Becker die nächste Stunde? Und jonas müller?", karte);
    assert.equal(t, "Wann hat S1 die nächste Stunde? Und S2?");
    assert.doesNotMatch(t, /Jonas|Becker|Müller/i);
    assert.equal(ersetze("Lena Schmidt hat angefragt"), "P1 hat angefragt", "Anfragende ohne Akte bekommen P-Kürzel");
});

test("Mehrdeutige Vornamen werden zur Rückfrage, Genitiv-s gehört zum Namen", () => {
    assert.equal(ersetze("Was ist mit Jonas?"), "Was ist mit [S1 oder S2]?");
    assert.equal(ersetze("Zeig mir nur Anfragen von Lena"), "Zeig mir nur Anfragen von [S1 oder P1]");
    assert.equal(ersetze("Lenas nächste Stunde"), "[S1 oder P1] nächste Stunde");
});

test("Alltagswörter, die auch Namen sind, bleiben stehen - der volle Name nicht", () => {
    assert.equal(ersetze("Mai Berg übt im Mai das Anfahren am Berg"), "S1 übt im Mai das Anfahren am Berg");
    assert.equal(ersetze("Wer hat morgen frei?"), "Wer hat morgen frei?");
});

test("Kürzel in der Antwort werden zu Namen - Klassen und Terminarten bleiben", () => {
    const karte = k.allyNeueKarte();
    ersetze("Jonas Becker und Lena Schmidt", karte);
    k.allyKuerzel(karte, "t:abc", "Mo 20.10. 14:00");
    assert.equal(k.allyKuerzelAufloesen("S1 fährt Klasse A1, P1 fragt T1 an, #1 passt. S9 kenne ich nicht.", karte),
        "Jonas Becker fährt Klasse A1, Lena Schmidt fragt T1 an, Mo 20.10. 14:00 passt. S9 kenne ich nicht.");
});

test("Gesundheitsangaben werden erkannt, Fahrschul-Wörter nicht", () => {
    for (const t of ["Ich bin morgen krank", "Lena hat einen Arzttermin", "OP am Knie", "Prüfungsangst abbauen", "nach der Physio", "Er ist schwanger", "Grippe"])
        assert.equal(k.allyGesundheit(t), true, t);
    for (const t of ["Vorfahrtsverletzung vermeiden", "Vorfahrt verletzt", "Opel parken", "Kurve fahren", "Abbruch der Stunde", "Verkehrsbehinderung", "Was steht morgen an?"])
        assert.equal(k.allyGesundheit(t), false, t);
});

test("Freitexte: Gesundheit wird zu [privat], Namen zu Kürzeln, lange Texte gekürzt", () => {
    const karte = k.allyNeueKarte();
    assert.equal(k.allyFreitext("Physio danach", PERSONEN, karte), "[privat]");
    assert.equal(k.allyFreitext("  Kreisverkehr mit  Jonas Becker üben ", PERSONEN, karte), "Kreisverkehr mit S1 üben");
    assert.equal(k.allyFreitext("x".repeat(300), PERSONEN, karte, 50).length, 50);
    assert.equal(k.allyFreitext("", PERSONEN, karte), "");
});

test("Kalender-Filter: alle Angaben gelten zusammen", () => {
    const f = { personen: [{ schluessel: "s:1", name: "Lena Weber" }], status: ["anfrage"] };
    assert.equal(k.allyFilterPasst(f, { schluessel: "s:1", status: "anfrage", art: "ÜST" }), true);
    assert.equal(k.allyFilterPasst(f, { schluessel: "s:1", status: "bestaetigt", art: "ÜST" }), false, "falscher Status");
    assert.equal(k.allyFilterPasst(f, { schluessel: "s:2", status: "anfrage", art: "ÜST" }), false, "andere Person");
    assert.equal(k.allyFilterPasst({ arten: ["ÜL"], fahrzeug: { id: "v1" } }, { status: "bestaetigt", art: "ÜL", fahrzeug: "v1" }), true);
    assert.equal(k.allyFilterPasst({ arten: ["ÜL"], fahrzeug: { id: "v1" } }, { status: "bestaetigt", art: "ÜL", fahrzeug: "v2" }), false);
    assert.equal(k.allyFilterLeer({ personen: [], status: [], arten: [] }), true);
    assert.equal(k.allyFilterPasst(null, { status: "anfrage" }), true, "ohne Filter alles sichtbar");
});

test("Kontextzeile: Berliner Datum und Uhrzeit, Ansicht und Filter", () => {
    assert.equal(k.allyKontextZeile(new Date("2026-10-18T08:15:00Z"), "Woche 13.10.–19.10.2026", ""),
        "[App] Jetzt: Sonntag, 18.10.2026, 10:15 Uhr. Kalender zeigt: Woche 13.10.–19.10.2026. Filter: keine.");
    assert.match(k.allyKontextZeile(new Date("2026-12-24T16:00:00Z"), "Tag", "Lena Weber · Anfragen"), /24\.12\.2026, 17:00 Uhr.*Filter: Lena Weber · Anfragen\./);
    assert.match(k.allyKontextZeile(new Date("2026-12-24T16:00:00Z"), "Tag", "", { schueler: "S3", aus: ["Zahlungen"] }), /Filter: keine\. Geöffnet: Schülerakte von S3\. Aus: Zahlungen\.$/);
    assert.doesNotMatch(k.allyKontextZeile(new Date("2026-12-24T16:00:00Z"), "Tag", "", { schueler: "", aus: [] }), /Geöffnet|Aus:/);
});

test("Namenssuche der KI verzeiht Tippfehler, aber nicht alles", () => {
    assert.equal(k.allyNamePasst("Jonnas", "Jonas", "Becker"), true);
    assert.equal(k.allyNamePasst("Beck", "Jonas", "Becker"), true, "Anfang des Nachnamens");
    assert.equal(k.allyNamePasst("jonas becker", "Jonas", "Becker"), true);
    assert.equal(k.allyNamePasst("Lisa", "Lena", "Weber"), false);
    assert.equal(k.allyNamePasst("J", "Jonas", "Becker"), false, "zu kurz");
});

test("Kleinkram: Wunschzeiten, Antworttext, Datum und Uhrzeit prüfen", () => {
    assert.equal(k.allyWunschzeiten({ active: true, weekdays: [3, 1, 0], von: "15:00", bis: "19:00" }), "Mo, Mi, So 15:00–19:00");
    assert.equal(k.allyWunschzeiten({ active: false, weekdays: [1] }), null);
    assert.equal(k.allyAntwortText([{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: "Hallo" }, { type: "tool_use", name: "x" }, { type: "text", text: "Welt" }]), "Hallo\nWelt");
    assert.equal(k.allyDatumOk("2026-10-18"), true);
    assert.equal(k.allyDatumOk("18.10.2026"), false);
    assert.equal(k.allyZeitOk("09:30"), true);
    assert.equal(k.allyZeitOk("24:00"), false);
});

test("App und Server kennen dieselben Werkzeuge", () => {
    const Module = require("module");
    const alt = Module._load;
    Module._load = function (anfrage) { return anfrage === "@anthropic-ai/sdk" ? { default: function () {} } : alt.apply(this, arguments); };
    try {
        const fn = require("../netlify/functions/ally.js");
        assert.deepEqual(fn.WERKZEUGE.map(w => w.name).sort(), Array.from(k.ALLY_WERKZEUGE).sort());
    }
    finally { Module._load = alt; }
});

test("Plan: Rückfrage zählt nur Abgehaktes ohne Problem, Verschieben geht einzeln", () => {
    const punkte = [{ art: "annehmen" }, { art: "annehmen" }, { art: "ablehnen" }, { art: "vorschlag", problem: "Überschneidet sich." }, { art: "vorschlag" }, { art: "anbieten" }, { art: "verschieben" }];
    assert.deepEqual(Array.from(k.allyPlanZeilen(punkte, new Set([0, 1, 2, 3, 4, 5, 6]))), ["2 Anfragen werden bestätigt", "1 Anfrage wird abgelehnt und gelöscht",
        "1 Terminvorschlag wird angelegt", "1 freie Zeit wird der Warteliste angeboten"]);
    assert.deepEqual(Array.from(k.allyPlanZeilen(punkte, new Set([1]))), ["1 Anfrage wird bestätigt"]);
    assert.deepEqual(Array.from(k.allyPlanZeilen(punkte, new Set())), []);
});

test("Plan: Arten passen zum Server, WhatsApp-Text zum Verschieben kommt aus der App", () => {
    assert.deepEqual(Object.keys(k.ALLY_PLAN_ARTEN).sort(), ["ablehnen", "adk", "anbieten", "annehmen", "eintragen", "strecke", "verschieben", "vorschlag", "zahlung"]);
    assert.equal(Object.keys(k.ALLY_PLAN_ARTEN)[0], "eintragen", "Fest eintragen steht oben");
    assert.equal(k.allyVerschiebenText("Lena", "Donnerstag, 23.10.", "10:00", "09:15"),
        "Hallo Lena, würde es dir passen, wenn deine Fahrstunde am Donnerstag, 23.10. um 09:15 Uhr statt um 10:00 Uhr beginnt? Gib mir bitte kurz Bescheid. Danke!");
    assert.match(k.allyVerschiebenText("", "Mo", "8:00", "9:00"), /^Hallo, /);
});

test("Krank-Tag: heute, morgen, übermorgen, Wochentag oder Datum – sonst null", () => {
    const jetzt = new Date("2026-10-19T08:00:00Z"); // Montag
    assert.equal(k.allyTagAusText("Ich bin morgen krank", jetzt), "2026-10-20");
    assert.equal(k.allyTagAusText("heute krank", jetzt), "2026-10-19");
    assert.equal(k.allyTagAusText("Übermorgen beim Arzt", jetzt), "2026-10-21");
    assert.equal(k.allyTagAusText("Am Freitag krank", jetzt), "2026-10-23");
    assert.equal(k.allyTagAusText("Montag krank", jetzt), "2026-10-19", "heute eingeschlossen");
    assert.equal(k.allyTagAusText("Arzt am 3.11.", jetzt), "2026-11-03");
    assert.equal(k.allyTagAusText("Ich bin krank", jetzt), null);
    assert.equal(k.allyTagAusText("am Morgen krank", jetzt), null, "der Morgen ist kein Tag");
    assert.equal(k.allyTagAusText("31.02. krank", jetzt), null, "kein echtes Datum");
});

test("Gesundheitsfilter: Fahrschulwörter und Orte schlagen nicht mehr an, das Wort wird genannt", () => {
    for (const t of ["Panikbremsung üben", "Abholung am Klinikum", "Kooperation mit der Schule", "Fehlerdiagnose am Auto"])
        assert.equal(k.allyGesundheit(t), false, t);
    for (const t of ["Operation am Knie", "Diagnose kam heute", "Ich bin krank"])
        assert.equal(k.allyGesundheit(t), true, t);
    assert.equal(k.allyGesundheitWort("Lena hat einen Arzttermin"), "Arzttermin");
    assert.equal(k.allyGesundheitWort("Ich bin morgen krank"), "krank");
    assert.equal(k.allyGesundheitWort("Was steht morgen an?"), "");
});
test("Gesundheitsfilter: eindeutige Wörter (Hörgerät, Rollstuhl, Sehhilfe …), Fahrschulstoff bleibt frei", () => {
    for (const t of ["Tim fährt mit Hörgerät", "Sie sitzt im Rollstuhl", "Sehhilfe nicht vergessen", "Kontaktlinsen vergessen", "Bandscheibenvorfall", "Er hat Autismus"])
        assert.equal(k.allyGesundheit(t), true, t);
    for (const t of ["Verhalten an der Unfallstelle", "Alkohol am Steuer besprochen", "Abholung am Klinikum"])
        assert.equal(k.allyGesundheit(t), false, t);
});

test("Plan: Rückfrage nennt Abzulehnende mit Namen, warnt und erklärt die Warteliste ehrlich", () => {
    const punkte = [{ art: "annehmen", titel: "Mia Hoffmann · Mi 21.10. 10:00–10:45" }, { art: "ablehnen", titel: "Lena Berger · Fr 23.10. 10:00–10:45" }, { art: "anbieten", titel: "Mo 19.10. 15:00–15:45" }];
    const alle = k.allyPlanRueckfrage(punkte, new Set([0, 1, 2]));
    assert.equal(alle.gefahr, true);
    assert.match(alle.text, /Abgelehnt und gelöscht wird:\n• Lena Berger · Fr 23\.10\./);
    assert.match(alle.text, /rückgängig/);
    assert.match(alle.text, /sehen passende Schüler sofort/);
    const nurAnnehmen = k.allyPlanRueckfrage(punkte, new Set([0]));
    assert.equal(nurAnnehmen.gefahr, false);
    assert.equal(nurAnnehmen.noetig, true, "eine Bestätigung lässt sich nicht zurücknehmen");
    assert.match(nurAnnehmen.text, /Von allein geht nichts raus/);
    assert.equal(alle.noetig, true);
});

test("Plan v2.123.0: Eintragen und Vorschläge ohne Rückfrage, Knopf sagt, was passiert", () => {
    const punkte = [{ art: "eintragen", titel: "Lena · Di 20.10. 14:00–15:30" }, { art: "eintragen", titel: "Werkstatt · Mi 21.10. 08:00–09:00" },
        { art: "vorschlag" }, { art: "annehmen" }, { art: "eintragen", problem: "Überschneidet sich." }, { art: "verschieben" }];
    assert.deepEqual(Array.from(k.allyPlanZeilen(punkte, new Set([0, 1, 2, 4]))), ["2 Termine werden fest eingetragen", "1 Terminvorschlag wird angelegt"]);
    assert.equal(k.allyPlanRueckfrage(punkte, new Set([0, 1, 2])).noetig, false, "alles lässt sich zurücknehmen");
    assert.equal(k.allyPlanRueckfrage(punkte, new Set([0, 3])).noetig, true);
    assert.equal(k.allyPlanRueckfrage(punkte, new Set([4, 5])).noetig, false, "Probleme und Verschieben zählen nicht");
    assert.equal(k.allyPlanKnopf(punkte, new Set([0])), "Eintragen");
    assert.equal(k.allyPlanKnopf(punkte, new Set([0, 1, 4])), "2 eintragen");
    assert.equal(k.allyPlanKnopf(punkte, new Set([2])), "Vorschlag anlegen");
    assert.equal(k.allyPlanKnopf(punkte, new Set([0, 3])), "2 übernehmen");
    assert.equal(k.allyPlanKnopf(punkte, new Set([4, 5])), "Nichts abgehakt");
    assert.equal(k.allyRueckgaengigText([{ was: "Eingetragen" }, { was: "Eingetragen" }, { was: "Vorgeschlagen" }], [{}]),
        "2 Termine eingetragen, 1 Vorschlag angelegt, 1 Anfrage abgelehnt");
    assert.equal(k.allyRueckgaengigText([{ was: "Eingetragen" }], []), "1 Termin eingetragen");
    assert.equal(k.allyRueckgaengigText([], []), "", "nur Bestätigungen: nichts zurückzunehmen");
});

test("Plan v2.124.0: Zahlungen und Haken – ohne Rückfrage, mit Rückgängig", () => {
    const punkte = [{ art: "zahlung" }, { art: "zahlung" }, { art: "adk" }, { art: "strecke" }, { art: "annehmen" }];
    assert.deepEqual(Array.from(k.allyPlanZeilen(punkte, new Set([0, 1, 2, 3]))), ["2 Zahlungen werden erfasst", "1 ADK-Punkt wird abgehakt", "1 Streckenpunkt wird abgehakt"]);
    assert.equal(k.allyPlanRueckfrage(punkte, new Set([0, 2, 3])).noetig, false, "lässt sich zurücknehmen");
    assert.equal(k.allyPlanRueckfrage(punkte, new Set([0, 4])).noetig, true);
    assert.equal(k.allyPlanKnopf(punkte, new Set([0])), "Erfassen");
    assert.equal(k.allyPlanKnopf(punkte, new Set([0, 1])), "2 erfassen");
    assert.equal(k.allyPlanKnopf(punkte, new Set([2, 3])), "2 abhaken");
    assert.equal(k.allyPlanKnopf(punkte, new Set([3])), "Abhaken");
    assert.equal(k.allyPlanKnopf(punkte, new Set([0, 2])), "2 übernehmen");
    assert.equal(k.allyRueckgaengigText([{ was: "Erfasst" }, { was: "Abgehakt" }, { was: "Abgehakt" }], []), "1 Zahlung erfasst, 2 Punkte abgehakt");
});

test("Zahlart in der Schreibweise des Formulars (Kasse oder Bank im DATEV-Export)", () => {
    for (const [ein, aus] of [["bar", "Bar"], ["in bar", "Bar"], ["Bargeld", "Bar"], ["Überweisung", "Überweisung"], ["überwiesen", "Überweisung"],
        ["EC-Karte", "Karte"], ["Karte", "Karte"], ["PayPal", "PayPal"], ["SEPA-Lastschrift", "Lastschrift"], ["", ""], ["Scheck", "Scheck"]])
        assert.equal(k.allyZahlart(ein), aus, ein);
});

test("Stand eines Punkts: Zahl, alte Einträge, gedeckelt auf Soll", () => {
    assert.equal(k.allyPunktWert(1, 2), 1);
    assert.equal(k.allyPunktWert(5, 2), 2);
    assert.equal(k.allyPunktWert(undefined, 2), 0);
    assert.equal(k.allyPunktWert({ level: 3 }, 2), 2);
    assert.equal(k.allyPunktWert({ level: 2 }, 2), 1);
    assert.equal(k.allyPunktWert({ level: 1 }, 2), 0);
});

test("Absage-Text und Folgefragen", () => {
    assert.equal(k.allyAbsageText("Lena", "Freitag, 23.10.", "10:00", ""),
        "Hallo Lena, deinen Terminwunsch am Freitag, 23.10. um 10:00 Uhr kann ich leider nicht annehmen. Schick mir gern einen anderen Termin. Danke für dein Verständnis!");
    assert.match(k.allyAbsageText("", "Mo", "8:00", "https://x"), /^Hallo, .*Such dir gern einen anderen Termin aus: https:\/\/x/);
    assert.deepEqual(Array.from(k.allyFolgefragen("Plane meine Woche")), ["Was ist noch offen?", "Was steht morgen an?"]);
    assert.equal(Array.from(k.allyFolgefragen("Was steht morgen an?")).indexOf("Was steht morgen an?"), -1);
});
