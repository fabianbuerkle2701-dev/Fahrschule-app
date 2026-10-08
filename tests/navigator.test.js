// Ausbildungsnavigator: Regelwerk ohne KI und Übernahme in die normale ADK (Szenarien aus der Spezifikation).
const test = require("node:test");
const assert = require("node:assert/strict");
const k = require("./lade-app")(["navigatorPlan", "navigatorSignatur", "navigatorErgebnisAnwenden", "navigatorTexteVorschlag", "navigatorUebergabe", "navigatorTippFuer", "BVF_ADK"]);
const ADK = k.BVF_ADK;
const index = {}; ADK.forEach(s => s.items.forEach(it => { index[it.id] = it; }));
const HEUTE = "2026-10-08";
const plan = (stu, extra) => k.navigatorPlan({ stu, adk: ADK, dauer: 90, heute: HEUTE, gesamtPct: 0, sonder: [], ...(extra || {}) });
const summe = p => p.items.reduce((s, i) => s + i.minuten, 0);
const alleAdkIds = new Set(Object.keys(index));

test("1. Neuer Schüler ohne Historie: Einstieg laut ADK, keine erfundenen Schwächen", () => {
    const p = plan({});
    assert.equal(p.ersteStunde, true);
    assert.match(p.warum, /noch keine bisherigen Fahrstunden/);
    assert.ok(p.items.length >= 1);
    assert.ok(p.items.every(i => i.art === "neu"), "nur ADK-Einstieg");
    assert.equal(p.items[0].adkId, "bvf_gs_einsteigen", "erster Punkt der Grundstufe");
    assert.ok(!p.items.some(i => i.art === "fokus"));
});

test("2. Viele abgeschlossene ADK-Punkte: nächster offener Bereich, Fertiges nicht", () => {
    const items = {};
    ADK.find(s => s.id === "bvf_grund").items.forEach(it => { items[it.id] = it.count || 1; });
    const p = plan({ items, lessons: [{ id: "l1", date: "2026-10-01" }] }, { gesamtPct: 40 });
    const ids = p.items.map(i => i.adkId).filter(Boolean);
    assert.ok(ids.every(id => !ADK.find(s => s.id === "bvf_grund").items.some(it => it.id === id)), "keine fertigen Grundstufen-Punkte");
    assert.ok(p.items.some(i => i.art === "neu" && /Aufbaustufe/.test(i.sektion)));
});

test("3. Mehrere „weiter üben“-Punkte stehen vorne, Kette zählt", () => {
    const stu = { lessons: [{ id: "l1", date: "2026-10-01" }], adkLog: {
        bvf_ls_rvl: [{ date: "2026-09-24", status: "geuebt" }, { date: "2026-10-01", status: "geuebt" }],
        bvf_ls_abbiegen: [{ date: "2026-10-01", status: "geuebt" }] } };
    const p = plan(stu, { gesamtPct: 50 });
    assert.equal(p.items[0].adkId, "bvf_ls_rvl");
    assert.match(p.items[0].grund, /letzten 2 Fahrstunden/);
    assert.equal(p.items[1].adkId, "bvf_ls_abbiegen");
    assert.match(p.warum, /2 Punkte aus den letzten Stunden/);
});

test("4. Zuletzt nicht geschaffter Punkt wird nachgeholt, gekonnter nicht wieder", () => {
    const stu = { items: { bvf_gs_anfahr: 1 }, lessons: [{ id: "l1", date: "2026-10-01" }], adkLog: { bvf_gs_anfahr: [{ date: "2026-10-01", status: "gekonnt" }] },
        navigator: { verlauf: [{ datum: "2026-10-01", items: [{ adkId: "bvf_gs_anfahr", status: "sitzt" }, { adkId: "bvf_ls_engpass", status: "nicht" }] }] } };
    const p = plan(stu, { gesamtPct: 30 });
    assert.ok(p.items.some(i => i.adkId === "bvf_ls_engpass" && i.art === "nachholen"));
    assert.ok(!p.items.some(i => i.adkId === "bvf_gs_anfahr"), "sitzt -> nicht erneut im Hauptplan");
});

test("5./6. 45 Minuten: höchstens 3 Punkte, Zeit passt; 90 Minuten: mehr Inhalt", () => {
    const stu = { lessons: [{ id: "l1", date: "2026-10-01" }], adkLog: { bvf_ls_rvl: [{ date: "2026-10-01", status: "geuebt" }], bvf_ls_abbiegen: [{ date: "2026-10-01", status: "geuebt" }], bvf_ls_vorfahrt: [{ date: "2026-10-01", status: "geuebt" }], bvf_ls_fuss: [{ date: "2026-10-01", status: "geuebt" }] } };
    const p45 = plan(stu, { dauer: 45, gesamtPct: 50 });
    assert.ok(p45.items.length <= 3);
    assert.equal(summe(p45) + p45.reserve, 45, "45 Minuten werden nicht überschritten");
    const p90 = plan(stu, { dauer: 90, gesamtPct: 50 });
    assert.equal(summe(p90) + p90.reserve, 90);
    assert.ok(p90.items.length > p45.items.length);
});

test("10. Kurz vor der Prüfung: Prüfungsphase, selbstständiges Fahren", () => {
    const stu = { lessons: [{ id: "l1", date: "2026-10-05" }] };
    const p = plan(stu, { gesamtPct: 88, pruefDatum: "2026-10-20" });
    assert.equal(p.phase, "pruefung");
    assert.equal(p.pruefInTagen, 12);
    assert.ok(p.items.some(i => i.art === "anwenden" && /Prüfung in 12 Tagen/.test(i.grund)));
});

test("11. Fehlende Sonderfahrten: Hinweis, zum passenden Termin werden sie Planpunkte", () => {
    const stu = { lessons: [{ id: "l1", date: "2026-10-05" }] };
    const sonder = [{ label: "Autobahn", erfuellt: false }, { label: "Überland", erfuellt: true }];
    const p = plan(stu, { gesamtPct: 70, sonder });
    assert.ok(p.hinweise.some(h => /Noch offen: Autobahn/.test(h)));
    assert.ok(!p.items.some(i => i.art === "sonderfahrt"), "ohne passenden Termin keine Sonderfahrt-Punkte");
    const pAB = plan(stu, { gesamtPct: 70, sonder, terminArt: "AB" });
    assert.ok(pAB.items[0].art === "sonderfahrt" && /Autobahn/.test(pAB.items[0].sektion));
});

test("Wiederkehrende Schwäche wird Fokus - und verliert Priorität nach zweimal gut", () => {
    const r = (v, d) => ({ id: d, date: d, ratings: { tempo: v } });
    const schwach = { lessons: [r(1, "2026-10-01"), r(1, "2026-09-28"), r(2, "2026-09-24")] };
    assert.ok(plan(schwach, { gesamtPct: 40 }).items.some(i => i.art === "fokus" && /Geschwindigkeitsanpassung/.test(i.titel)));
    const besser = { lessons: [r(3, "2026-10-07"), r(3, "2026-10-04"), r(1, "2026-10-01"), r(1, "2026-09-28")] };
    assert.ok(!plan(besser, { gesamtPct: 40 }).items.some(i => i.art === "fokus"), "alte Auffälligkeit, zweimal danach gut -> kein Fokus");
});

test("14. Signatur ändert sich mit der Terminlänge (Plan wird neu berechnet)", () => {
    const stu = { lessons: [] };
    const e1 = { stu, adk: ADK, dauer: 90, heute: HEUTE, gesamtPct: 0, sonder: [] };
    const e2 = { ...e1, dauer: 45 };
    assert.notEqual(k.navigatorSignatur(e1, k.navigatorPlan(e1)), k.navigatorSignatur(e2, k.navigatorPlan(e2)));
});

test("Alle Planpunkte verweisen nur auf existierende ADK-IDs", () => {
    const stu = { lessons: [{ id: "l", date: "2026-09-01" }], adkLog: { gibts_nicht: [{ date: "2026-10-01", status: "geuebt" }] } };
    const p = plan(stu, { gesamtPct: 65, terminArt: "NF" });
    p.items.filter(i => i.adkId).forEach(i => assert.ok(alleAdkIds.has(i.adkId), i.adkId));
    assert.ok(p.hinweise.some(h => /vor 37 Tagen/.test(h)), "lange Pause erkannt");
});

test("Ergebnisse -> normale ADK: sitzt = vollständig, weiter = offen, nicht = unverändert", () => {
    const stu = { items: { bvf_ls_rvl: 0 }, lessons: [{ id: "l1", date: "2026-10-08", apptId: "A1", thema: "", ratings: {} }] };
    const neu = k.navigatorErgebnisAnwenden(stu, { heute: HEUTE, jetztIso: "2026-10-08T10:00:00Z", adkIndex: index, apptId: "A1", neueLessonId: "lsX",
        ergebnisse: [{ adkId: "bvf_gs_anfahr", titel: "Anfahr-/Anhalteübungen", status: "sitzt" }, { adkId: "bvf_ls_rvl", titel: "rechts vor links", status: "weiter" },
            { adkId: "bvf_ls_engpass", titel: "Engpass", status: "nicht" }, { adkId: "erfunden", titel: "X", status: "sitzt" }],
        gut: "Anfahren sitzt.", naechstes: "rechts vor links festigen.", ratings: { tempo: 2 } });
    assert.equal(neu.items.bvf_gs_anfahr, 1, "sitzt -> Soll erreicht");
    assert.equal(neu.items.bvf_ls_rvl, 0, "weiter üben bei Soll 1 bleibt offen");
    assert.equal(neu.items.bvf_ls_engpass, undefined, "nicht behandelt -> ADK unverändert");
    assert.equal(neu.items.erfunden, undefined, "unbekannte ID verworfen");
    assert.equal(JSON.stringify(neu.adkDates.bvf_gs_anfahr), JSON.stringify([HEUTE]));
    assert.equal(neu.adkLog.bvf_ls_rvl[0].status, "geuebt");
    assert.equal(neu.lessons.length, 1, "vorhandener Termin-Eintrag ergänzt, keine Doppeldokumentation");
    assert.equal(neu.lessons[0].thema, "Anfahr-/Anhalteübungen, rechts vor links");
    assert.equal(neu.lastNote, "rechts vor links festigen.");
    assert.equal(neu.navigator.verlauf[0].items.length, 3, "unbekannte ID auch nicht im Verlauf");
    assert.equal(neu.navigator.plan, null);
});

test("Weiter üben bei mehrfachem Soll zählt hoch, aber nie bis fertig", () => {
    const idx = { p: { id: "p", count: 3 } };
    const e = st => k.navigatorErgebnisAnwenden({ items: { p: st } }, { heute: HEUTE, adkIndex: idx, neueLessonId: "n", ergebnisse: [{ adkId: "p", titel: "P", status: "weiter" }] }).items.p;
    assert.equal(e(0), 1); assert.equal(e(1), 2); assert.equal(e(2), 2, "bleibt bei Soll-1"); assert.equal(e(3), 3, "schon fertig: nicht zurückgesetzt");
});

test("8. Übergabe-Überblick: sicher / weiter üben / noch nicht begonnen", () => {
    const stu = { items: { bvf_gs_einsteigen: 1 }, adkDates: { bvf_gs_einsteigen: ["2026-10-01"] }, adkLog: { bvf_gs_sitz: [{ date: "2026-10-01", status: "geuebt" }] } };
    const u = k.navigatorUebergabe(stu, ADK);
    assert.equal(u.sicher[0].titel, "Besonderheiten beim Einsteigen");
    assert.ok(u.weiter.some(w => w.titel === "Sitz"));
    assert.equal(u.offenBereich, "Grundstufe");
});

test("Texte ohne KI und Praxistipps", () => {
    const t = k.navigatorTexteVorschlag([{ titel: "Anfahren", status: "sitzt" }, { titel: "rechts vor links", status: "weiter" }, { titel: "Engpass", status: "nicht" }]);
    assert.equal(t.gut, "Anfahren sitzt.");
    assert.match(t.naechstes, /rechts vor links weiter festigen\. Engpass beginnen/);
    assert.match(k.navigatorTippFuer("rechts vor links").tipp, /Kreuzung laut ankündigen/);
    assert.match(k.navigatorTippFuer("Einfahren in BAB").tipp, /Lückenerkennung/);
});

test("7./12. ADK von Hand geändert: Signatur ändert sich, abgehakter Punkt fällt raus", () => {
    const stu = { lessons: [{ id: "l1", date: "2026-10-01" }] };
    const e = { stu, adk: ADK, dauer: 90, heute: HEUTE, gesamtPct: 20, sonder: [] };
    const p = k.navigatorPlan(e);
    const erster = p.items.find(i => i.adkId);
    assert.equal(k.navigatorSignatur(e, p), k.navigatorSignatur(e, k.navigatorPlan(e)), "ohne Änderung gleiche Signatur - ein angepasster Plan bleibt stehen");
    const stu2 = { ...stu, items: { [erster.adkId]: Math.max(1, parseInt(index[erster.adkId].count, 10) || 1) } };
    const e2 = { ...e, stu: stu2 };
    const p2 = k.navigatorPlan(e2);
    assert.notEqual(k.navigatorSignatur(e2, p2), k.navigatorSignatur(e, p));
    assert.ok(!p2.items.some(i => i.adkId === erster.adkId));
});

test("13. Mehrere Stunden hintereinander: Ergebnis der ersten Stunde bestimmt die zweite", () => {
    const stu0 = { lessons: [{ id: "l0", date: "2026-10-01" }] };
    const p1 = plan(stu0, { gesamtPct: 30 });
    const [a, b] = p1.items.filter(i => i.adkId);
    const nach = k.navigatorErgebnisAnwenden(stu0, { heute: HEUTE, jetztIso: HEUTE + "T10:00:00Z", adkIndex: index, apptId: "t1", neueLessonId: "n1",
        ergebnisse: [{ adkId: a.adkId, titel: a.titel, status: "sitzt" }, { adkId: b.adkId, titel: b.titel, status: "weiter" }], gut: "", naechstes: "", ratings: {} });
    const p2 = plan(nach, { gesamtPct: 32 });
    assert.ok(!p2.items.some(i => i.adkId === a.adkId), "Gesessenes kommt nicht direkt wieder");
    assert.equal(p2.items[0].adkId, b.adkId, "„Weiter üben“ steht in der Folgestunde vorne");
    assert.equal(p2.items[0].art, "wiederholen");
});

test("Sonderfahrten: Uhrzeit geprüft, schon eingetragene nicht als offen gemeldet", () => {
    const stu = { lessons: [{ id: "l1", date: "2026-10-05" }] };
    const sonder = [{ code: "AB", label: "Autobahn", ue: 1, sollUe: 4, erfuellt: false }, { code: "NF", label: "Dämmerungsfahrt", ue: 0, sollUe: 3, erfuellt: false }];
    const zuFrueh = plan(stu, { gesamtPct: 70, sonder, terminArt: "NF", dunkel: { beginn: "16:00", dunkelAb: "19:10", startZuFrueh: true, endetImDunkeln: false } });
    assert.ok(zuFrueh.hinweise.some(h => /beginnt um 16:00 Uhr.*19:10/.test(h)));
    const imDunkeln = plan(stu, { gesamtPct: 70, sonder, dunkel: { beginn: "18:30", dunkelAb: "19:10", startZuFrueh: true, endetImDunkeln: true } });
    assert.ok(imDunkeln.hinweise.some(h => /reicht in die Dunkelheit/.test(h)));
    assert.ok(imDunkeln.hinweise.some(h => /Autobahn \(1 von 4 UE\)/.test(h)));
    const geplant = plan(stu, { gesamtPct: 70, sonder, geplanteSonder: { AB: "14.10.", NF: "20.10." }, dunkel: { beginn: "18:30", dunkelAb: "19:10", startZuFrueh: true, endetImDunkeln: true } });
    assert.ok(geplant.hinweise.some(h => /Bereits eingetragen: Autobahn am 14\.10\., Dämmerungsfahrt am 20\.10\./.test(h)));
    assert.ok(!geplant.hinweise.some(h => /Noch offen/.test(h) || /reicht in die Dunkelheit/.test(h)));
});

test("Nichts behandelt: kein leerer Fahrstunden-Eintrag, aber nachholen beim nächsten Mal", () => {
    const stu = { lessons: [{ id: "l1", date: "2026-10-01" }] };
    const nach = k.navigatorErgebnisAnwenden(stu, { heute: HEUTE, jetztIso: HEUTE + "T10:00:00Z", adkIndex: index, apptId: "t9", neueLessonId: "n9",
        ergebnisse: [{ adkId: "bvf_ls_engpass", titel: "Engpass", status: "nicht" }], gut: "", naechstes: "", ratings: {} });
    assert.equal(nach.lessons.length, 1, "kein leerer Eintrag");
    assert.equal(nach.navigator.verlauf.length, 1);
    assert.ok(plan(nach, { gesamtPct: 30 }).items.some(i => i.adkId === "bvf_ls_engpass" && i.art === "nachholen"));
});

test("Prüfungsnähe: auch eine 45-Minuten-Stunde enthält prüfungsnahes Fahren", () => {
    const p = plan({ lessons: [{ id: "l1", date: "2026-10-05" }] }, { dauer: 45, gesamtPct: 90 });
    assert.equal(p.phase, "pruefung");
    assert.ok(p.items.some(i => i.art === "anwenden"));
    assert.equal(summe(p) + p.reserve, 45);
    assert.match(p.warum, /prüfungsnah/);
    assert.ok(!/^Danach/.test(p.warum), "„Warum“ beginnt nicht mit „Danach“");
});

test("Übergabe zählt auch abgehakte Punkte ohne Datum (Import, „Alles abhaken“)", () => {
    const grund = ADK.find(s => s.id === "bvf_grund").items;
    const items = {}; grund.forEach(it => { items[it.id] = parseInt(it.count, 10) || 1; });
    const u = k.navigatorUebergabe({ items }, ADK);
    assert.equal(u.sicherAnzahl, grund.length);
    assert.equal(u.sicher.length, 0, "ohne Datum keine „zuletzt“-Liste");
    assert.ok(u.gesamt > u.sicherAnzahl);
});

test("Erste Stunde: mehrere kurze Einstiegspunkte statt eines langen, Zeit passt", () => {
    const p45 = plan({}, { dauer: 45 });
    assert.equal(p45.items.length, 3);
    assert.ok(p45.items.every(i => i.art === "neu" && i.minuten <= 20));
    assert.equal(summe(p45) + p45.reserve, 45);
    const p90 = plan({}, { dauer: 90 });
    assert.equal(p90.items.length, 4);
    assert.equal(summe(p90) + p90.reserve, 90);
});
