// Prüfungssimulation: Bewertung nach den 5 Prüfkriterien (wie im e-Prüfprotokoll) und Schnelleintrag ohne KI.
const test = require("node:test");
const assert = require("node:assert/strict");
const k = require("./lade-app")(["pruefungssimBewertung", "pruefungssimTextZerlegen", "pruefungssimSchnellEintraege", "pruefungssimSummary", "pruefungssimZaehlText",
    "pruefsimEintragArt", "pruefsimArtPatch", "pruefsimDauer", "pruefsimChronologisch", "PRUEFUNGS_KB_ERKLAERUNG"]);
const json = x => JSON.stringify(x);
const fehler = (kb, sg) => ({ type: "fehler", kompetenzbereich: kb, schweregrad: sg, text: "x" });
const gut = kb => ({ type: "gut", kompetenzbereich: kb, text: "x" });
const stufen = b => json(Object.fromEntries(b.bereiche.map(x => [x.id, x.stufe])));

test("Ohne Auffälligkeiten: alle fünf Bereiche „Sehr gut“, bestanden", () => {
    const b = k.pruefungssimBewertung([]);
    assert.equal(b.bereiche.length, 5);
    assert.ok(b.bereiche.every(x => x.stufe === "sehr_gut"));
    assert.equal(b.bestanden, true);
});

test("Stufen je Bereich: leicht → Gut, schwer → Ausreichend, Häufung → Ungenügend", () => {
    assert.equal(k.pruefungssimBewertung([fehler("beobachtung", "leicht")]).bereiche[0].stufe, "gut");
    assert.equal(k.pruefungssimBewertung([fehler("beobachtung", "leicht"), fehler("beobachtung", "leicht"), fehler("beobachtung", "leicht")]).bereiche[0].stufe, "ausreichend");
    assert.equal(k.pruefungssimBewertung([fehler("beobachtung", "erheblich")]).bereiche[0].stufe, "ausreichend", "ein schwerer Fehler ist die Ausnahme");
    const zweiSchwere = k.pruefungssimBewertung([fehler("position", "erheblich"), fehler("position", "erheblich")]);
    assert.equal(zweiSchwere.bereiche.find(x => x.id === "position").stufe, "ungenuegend");
    assert.equal(zweiSchwere.bestanden, false);
    const sechsLeichte = k.pruefungssimBewertung(Array.from({ length: 6 }, () => fehler("kommunikation", "leicht")));
    assert.equal(sechsLeichte.bereiche.find(x => x.id === "kommunikation").stufe, "ungenuegend", "Häufung leichter Fehler");
});

test("Gefährdung: immer Ungenügend und nicht bestanden – auch eine Anpassung ändert das nicht", () => {
    const b = k.pruefungssimBewertung([fehler("geschwindigkeit", "gefaehrdung"), gut("geschwindigkeit"), gut("geschwindigkeit")], { geschwindigkeit: "gut" });
    const g = b.bereiche.find(x => x.id === "geschwindigkeit");
    assert.equal(g.stufe, "ungenuegend");
    assert.equal(g.gesperrt, true);
    assert.equal(b.nb, true);
    assert.equal(b.bestanden, false);
});

test("Gutes gleicht leichte Fehler aus, aber keine schweren", () => {
    const b1 = k.pruefungssimBewertung([fehler("bedienung", "leicht"), fehler("bedienung", "leicht"), fehler("bedienung", "leicht"), gut("bedienung"), gut("bedienung")]);
    assert.equal(b1.bereiche.find(x => x.id === "bedienung").stufe, "gut", "3 leichte − 2× gut = 1 Punkt");
    const b2 = k.pruefungssimBewertung([fehler("bedienung", "erheblich"), gut("bedienung"), gut("bedienung"), gut("bedienung")]);
    assert.equal(b2.bereiche.find(x => x.id === "bedienung").stufe, "ausreichend", "schwerer Fehler: höchstens Ausreichend");
    const b3 = k.pruefungssimBewertung([gut("position")]);
    assert.equal(b3.bereiche.find(x => x.id === "position").stufe, "sehr_gut");
});

test("Der Fahrlehrer entscheidet: Anpassung gilt und bestimmt das Ergebnis", () => {
    const b = k.pruefungssimBewertung([fehler("beobachtung", "leicht")], { beobachtung: "ungenuegend", position: "quatsch" });
    const beo = b.bereiche.find(x => x.id === "beobachtung");
    assert.equal(beo.vorschlag, "gut");
    assert.equal(beo.stufe, "ungenuegend");
    assert.equal(beo.angepasst, true);
    assert.equal(b.bereiche.find(x => x.id === "position").stufe, "sehr_gut", "ungültige Stufe wird ignoriert");
    assert.equal(b.bestanden, false);
});

test("Schnelleintrag ohne KI: ganze Notiz → einzelne gute und schlechte Beobachtungen", () => {
    const e = k.pruefungssimTextZerlegen("Anfahren sauber, Schulterblick beim Spurwechsel vergessen, im Kreisverkehr zu schnell, Parken sehr gut.");
    assert.equal(json(e.map(x => [x.art, x.kompetenzbereich, x.fahraufgabe])), json([
        ["gut", "bedienung", "anfahren"], ["leicht", "beobachtung", "streifenwechsel"], ["leicht", "geschwindigkeit", "kreisverkehr"], ["gut", "position", "parken"]]));
    assert.equal(e[1].text, "Schulterblick beim Spurwechsel vergessen");
});

test("Schnelleintrag: Zusätze bleiben beim Satz, Eingreifen des Fahrlehrers macht eine Gefährdung", () => {
    const a = k.pruefungssimTextZerlegen("Schulterblick vergessen, war aber ungefährlich. Blinker beim Abbiegen vergessen.");
    assert.equal(a.length, 2);
    assert.equal(a[0].text, "Schulterblick vergessen, war aber ungefährlich");
    assert.equal(a[0].art, "leicht", "„ungefährlich“ ist keine Gefährdung");
    assert.equal(json([a[1].art, a[1].kompetenzbereich, a[1].fahraufgabe]), json(["leicht", "kommunikation", "abbiegen"]));
    const b = k.pruefungssimTextZerlegen("Vorfahrt missachtet an der Einmündung, ich musste bremsen. Rechts vor links gut beachtet.");
    assert.equal(json(b.map(x => [x.art, x.kompetenzbereich])), json([["gefaehrdung", "beobachtung"], ["gut", "beobachtung"]]));
    const c = k.pruefungssimTextZerlegen("Bei Gelb noch über die Ampel, Situation blieb ruhig.");
    assert.equal(c.length, 1);
    assert.equal(c[0].art, "leicht");
});

test("Schnelleintrag: Unklares wird Notiz, nichts geht verloren", () => {
    const e = k.pruefungssimTextZerlegen("Wetter regnerisch. Strecke über die B27.");
    assert.ok(e.length >= 1);
    assert.ok(e.every(x => x.art === "notiz" && x.kompetenzbereich === null));
    assert.equal(k.pruefungssimTextZerlegen("").length, 0);
});

test("Bestätigte Vorschläge werden normale Einträge; Zusammenfassung zählt auch „gut“", () => {
    const e = k.pruefungssimSchnellEintraege([
        { art: "gut", kompetenzbereich: "position", fahraufgabe: "parken", text: "Parken sehr gut" },
        { art: "erheblich", kompetenzbereich: "beobachtung", fahraufgabe: null, text: "Radfahrer übersehen" },
        { art: "notiz", kompetenzbereich: null, fahraufgabe: null, text: "Regen" },
        { art: "leicht", kompetenzbereich: "kommunikation", text: "   " },
    ], 1000);
    assert.equal(json(e.map(x => x.type)), json(["gut", "fehler", "freitext"]), "leere Zeilen fallen weg");
    assert.equal(e[1].schweregrad, "erheblich");
    assert.equal(new Set(e.map(x => x.id)).size, 3, "eindeutige IDs");
    assert.equal(json(k.pruefungssimSummary(e)), json({ leicht: 0, erheblich: 1, gefaehrdung: 0, freitext: 1, gut: 1 }));
    const b = k.pruefungssimBewertung(e);
    assert.equal(k.pruefungssimZaehlText(b.bereiche.find(x => x.id === "beobachtung")), "1 schwerer Fehler");
    assert.equal(k.pruefungssimZaehlText(b.bereiche.find(x => x.id === "geschwindigkeit")), "Nichts festgehalten");
});

test("Gefährdung ohne Prüfkriterium (ältere Simulation): trotzdem nicht bestanden", () => {
    const b = k.pruefungssimBewertung([{ type: "fehler", schweregrad: "gefaehrdung", text: "Radfahrer übersehen" }]);
    assert.equal(b.nb, true);
    assert.equal(b.bestanden, false);
    assert.ok(b.bereiche.every(x => x.stufe === "sehr_gut"), "die Bereiche selbst bleiben unberührt");
});

test("Beobachtung ändern: Art umstellen, Text und Prüfkriterium bleiben", () => {
    const e = { id: "x", type: "fehler", schweregrad: "leicht", kompetenzbereich: "beobachtung", fahraufgabe: "kreuzung", text: "Schulterblick vergessen" };
    assert.equal(k.pruefsimEintragArt(e), "leicht");
    const gut = { ...e, ...k.pruefsimArtPatch("gut") };
    assert.equal(k.pruefsimEintragArt(gut), "gut");
    assert.equal(JSON.parse(JSON.stringify(gut)).schweregrad, undefined, "kein Schweregrad mehr im gespeicherten Eintrag");
    assert.equal(json([gut.text, gut.kompetenzbereich, gut.fahraufgabe]), json(["Schulterblick vergessen", "beobachtung", "kreuzung"]));
    const notiz = { ...gut, ...k.pruefsimArtPatch("notiz") };
    assert.equal(notiz.type, "freitext");
    assert.equal(k.pruefsimEintragArt(notiz), "notiz");
    const gef = { ...notiz, ...k.pruefsimArtPatch("gefaehrdung") };
    assert.equal(json([gef.type, gef.schweregrad, gef.kompetenzbereich]), json(["fehler", "gefaehrdung", "beobachtung"]));
    assert.equal(k.pruefungssimBewertung([gef]).bestanden, false);
    assert.equal(k.pruefsimEintragArt({ type: "fehler", schweregrad: "quatsch" }), "notiz", "Unbekanntes gilt als Notiz");
});

test("Schnelleintrag: Zeilen eines Textes gehören zusammen und behalten ihre Reihenfolge", () => {
    const e = k.pruefungssimSchnellEintraege([{ art: "gut", kompetenzbereich: "position", text: "Anfahren sauber" }, { art: "leicht", kompetenzbereich: "beobachtung", text: "Schulterblick vergessen" }], 5000);
    assert.equal(json(e.map(x => x.gruppe)), json([5000, 5000]));
    assert.ok(e[0].at < e[1].at);
});

test("Dauer in Minuten statt Uhrzeit-Schreibweise", () => {
    assert.equal(k.pruefsimDauer(1980), "33 Min.");
    assert.equal(k.pruefsimDauer(20), "unter 1 Min.");
    assert.equal(k.pruefsimDauer(undefined), "unter 1 Min.");
});

test("Protokoll für die Akte: Reihenfolge wie gefahren, Schnelleintrag in Textreihenfolge", () => {
    const e = [{ id: "spaet", at: 9000, text: "c" }, ...k.pruefungssimSchnellEintraege([{ art: "gut", kompetenzbereich: "position", text: "a" }, { art: "leicht", kompetenzbereich: "position", text: "b" }], 5000), { id: "frueh", at: 1000, text: "z" }];
    assert.equal(json(k.pruefsimChronologisch(e).map(x => x.text)), json(["z", "a", "b", "c"]));
    assert.equal(k.pruefsimChronologisch(undefined).length, 0);
});

test("Auswertung für den Schüler: jedes Prüfkriterium hat eine kurze Erklärung", () => {
    for (const id of ["beobachtung", "position", "geschwindigkeit", "kommunikation", "bedienung"])
        assert.ok((k.PRUEFUNGS_KB_ERKLAERUNG[id] || "").length > 10, id);
});
