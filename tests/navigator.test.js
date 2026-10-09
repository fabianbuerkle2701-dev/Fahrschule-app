// Ausbildungsnavigator (v2.116.0): Lernstand in vier Stufen, ein Ziel je Stunde nach Prüfungsrelevanz,
// Übernahme in die normale ADK. Szenarien aus der Spezifikation und der Fahrlehrer-Didaktik.
const test = require("node:test");
const assert = require("node:assert/strict");
const k = require("./lade-app")(["navigatorPlan", "navigatorSignatur", "navigatorErgebnisAnwenden", "navigatorTexteVorschlag", "navigatorUebergabe",
    "navigatorTippFuer", "navigatorPruefungsthemen", "navPunktStand", "navAufgabeVon", "BVF_ADK", "DEFAULT_ADK"]);
const ADK = k.BVF_ADK;
const index = {}; ADK.forEach(s => s.items.forEach(it => { index[it.id] = it; }));
const sektion = id => ADK.find(s => s.id === id);
const HEUTE = "2026-10-08";
const plan = (stu, extra) => k.navigatorPlan({ stu, adk: ADK, dauer: 90, heute: HEUTE, gesamtPct: 0, sonder: [], ...(extra || {}) });
const summe = p => p.items.reduce((s, i) => s + i.minuten, 0);
const alleAdkIds = new Set(Object.keys(index));
const anwenden = (stu, ergebnisse, extra) => k.navigatorErgebnisAnwenden(stu, { heute: HEUTE, jetztIso: HEUTE + "T10:00:00Z", adkIndex: index, apptId: "t1", neueLessonId: "n1",
    ergebnisse, gut: "", naechstes: "", ratings: {}, ...(extra || {}) });
const json = x => JSON.stringify(x);

test("Lernstand aus Haken und Übungs-Verlauf: neu, eingeführt, geübt, unsicher, sitzt", () => {
    const it = { id: "p", label: "P", count: 2 };
    const ls = stu => k.navPunktStand(stu, it).lernstand;
    assert.equal(ls({}), "neu");
    assert.equal(ls({ adkLog: { p: [{ date: "2026-10-01", status: "angesprochen" }] } }), "eingefuehrt");
    assert.equal(ls({ adkLog: { p: [{ date: "2026-10-01", status: "geuebt", rating: "okay" }] } }), "geuebt");
    assert.equal(ls({ adkLog: { p: [{ date: "2026-10-01", status: "geuebt", rating: "bad" }] } }), "unsicher");
    assert.equal(ls({ adkLog: { p: [{ date: "2026-10-01", status: "gekonnt", rating: "good" }] } }), "sicher");
    assert.equal(ls({ items: { p: 1 } }), "geuebt", "halb abgehakt ohne Verlauf = geübt");
    assert.equal(ls({ items: { p: 2 } }), "sicher", "voll abgehakt = sitzt");
    // Voll abgehakt, danach aber als unsicher erlebt: bleibt unsicher, bis wieder abgehakt wird
    const unsicherNachHaken = { items: { p: 2 }, adkDates: { p: ["2026-09-20"] }, adkLog: { p: [{ date: "2026-10-01", status: "geuebt", rating: "bad" }] } };
    assert.equal(ls(unsicherNachHaken), "unsicher");
    assert.equal(ls({ ...unsicherNachHaken, adkDates: { p: ["2026-09-20", "2026-10-05"] } }), "sicher");
});

test("ADK-Punkte gehören zu Prüfungsthemen - Verkehrspunkte vor Bedienung", () => {
    const V3 = k.DEFAULT_ADK;
    const auf = (adk, sek, id) => { const s = adk.find(x => x.id === sek); return k.navAufgabeVon(s.items.find(i => i.id === id), s); };
    assert.equal(auf(V3, "aufbaustufe", "fb_ueberholen"), "vorbeifahren", "„Überholen (Spiegel/Schulterblick)“ ist kein Bedienpunkt");
    assert.equal(auf(V3, "aufbaustufe", "vt_rad"), "schutz", "„Radfahrer / Motorrad“ nicht als Motor-Bedienung");
    assert.equal(auf(V3, "aufbaustufe", "vf_rechts"), "kreuzung");
    assert.equal(auf(V3, "aufbaustufe", "vf_kreis"), "kreisverkehr");
    assert.equal(auf(V3, "aufbaustufe", "ab_innerorts"), "gerade");
    assert.equal(auf(ADK, "bvf_aufbau", "bvf_ab_gefaelle"), "bedienung");
    assert.equal(auf(ADK, "bvf_grund", "bvf_gs_spiegel"), "bedienung");
    assert.equal(auf(ADK, "bvf_autobahn", "bvf_bab_ein"), "fahrstreifen");
    assert.equal(auf(ADK, "bvf_leistung", "bvf_ls_bahn"), "schiene");
    assert.equal(auf(ADK, "bvf_grundfahr", "bvf_gf_umkehr"), "gfa");
    assert.equal(auf(ADK, "bvf_situativ", "bvf_sb_reifen"), "vorbereitung");
    assert.equal(auf(ADK, "bvf_reife", "bvf_rt_selbst_in"), "pruefung");
});

test("1. Neuer Schüler ohne Historie: erste Stunde mit Bedienung, keine erfundenen Schwächen", () => {
    const p = plan({});
    assert.equal(p.ersteStunde, true);
    assert.equal(p.items.length, 4);
    assert.ok(p.items.every(i => i.art === "neu" && i.lernstand === "neu"));
    assert.equal(p.items[0].adkId, "bvf_gs_einsteigen", "erster Punkt der Grundstufe");
    assert.match(p.ziel, /Erste Fahrstunde/);
    assert.equal(p.zielKurz, "Erste Fahrstunde");
    assert.match(p.einstieg, /Sitz, Spiegel und Lenkrad/);
    assert.match(p.warum, /Erste Stunde/);
    assert.equal(p.schwach.length, 0);
    const p45 = plan({}, { dauer: 45 });
    assert.equal(p45.items.length, 3, "45 Minuten: drei kurze Einstiegspunkte");
    assert.ok(summe(p45) + p45.reserve <= 45);
});

test("2. Grundstufe fertig: weiter mit der Aufbaustufe, Fertiges nicht", () => {
    const items = {};
    sektion("bvf_grund").items.forEach(it => { items[it.id] = parseInt(it.count, 10) || 1; });
    const p = plan({ items, lessons: [{ id: "l1", date: "2026-10-01" }] }, { gesamtPct: 40 });
    const grund = new Set(sektion("bvf_grund").items.map(i => i.id));
    assert.ok(!p.items.some(i => grund.has(i.adkId)), "keine fertigen Grundstufen-Punkte");
    assert.ok(p.items.some(i => i.art === "neu" && /Aufbaustufe/.test(i.sektion)));
    assert.equal(p.stufen.find(s => s.status === "jetzt").key, "aufbau");
});

test("3. Geübte Punkte stehen vorne - wer öfter geübt wurde, zuerst; ein Ziel für die Stunde", () => {
    const stu = { lessons: [{ id: "l1", date: "2026-10-01" }], adkLog: {
        bvf_ls_rvl: [{ date: "2026-09-24", status: "geuebt", rating: "okay" }, { date: "2026-10-01", status: "geuebt", rating: "okay" }],
        bvf_ls_abbiegen: [{ date: "2026-10-01", status: "geuebt", rating: "okay" }] } };
    const p = plan(stu, { gesamtPct: 50 });
    assert.equal(p.items[0].adkId, "bvf_ls_rvl");
    assert.match(p.items[0].grund, /2-mal geübt/);
    assert.equal(p.items[1].adkId, "bvf_ls_abbiegen");
    assert.equal(p.zielAufgabe, "kreuzung");
    assert.match(p.ziel, /Kreuzungen und Einmündungen/);
    assert.match(p.situation, /Rechts-vor-links/);
    assert.match(p.warum, /Geübtes, bis es sitzt/);
    assert.match(p.warum, /häufigste Fehlerquelle/);
    assert.ok(p.items.every(i => i.aufgabe === "kreuzung"), "zuerst Punkte aus dem Ziel-Thema: " + p.items.map(i => i.titel).join(", "));
});

test("Unsicheres kommt vor Geübtem, Festigen und Neues gemischt", () => {
    const log = (st, r) => [{ date: "2026-10-01", status: st, rating: r }];
    const stu = { lessons: [{ id: "l1", date: "2026-10-01" }], adkLog: {
        bvf_ls_fahrbahn: log("geuebt", "okay"), bvf_ls_einordnen: log("geuebt", "okay"), bvf_ls_markierung: log("geuebt", "okay"),
        bvf_ls_fswechsel: log("geuebt", "okay"), bvf_ls_kreis: log("geuebt", "bad") } };
    const p = plan(stu, { gesamtPct: 50 });
    assert.equal(p.items[0].adkId, "bvf_ls_kreis", "unsicher zuerst");
    assert.equal(p.items[0].lernstand, "unsicher");
    assert.match(p.items[0].grund, /Zuletzt unsicher/);
    assert.equal(p.zielAufgabe, "kreisverkehr");
    assert.equal(p.items.length, 4);
    assert.equal(p.items.filter(i => i.art === "neu").length, 1, "ein Platz für Neues, damit die Ausbildung weiterkommt");
    assert.match(p.warum, /^Unsicheres zuerst\./);
});

test("4. Zuletzt nicht dran: wird nachgeholt; was sitzt, kommt nicht wieder", () => {
    const stu = { items: { bvf_gs_anfahr: 1 }, lessons: [{ id: "l1", date: "2026-10-01" }], adkLog: { bvf_gs_anfahr: [{ date: "2026-10-01", status: "gekonnt", rating: "good" }] },
        navigator: { verlauf: [{ datum: "2026-10-01", items: [{ adkId: "bvf_gs_anfahr", lernstand: "sicher" }, { adkId: "bvf_ls_engpass", lernstand: null }] }] } };
    const p = plan(stu, { gesamtPct: 30 });
    assert.ok(p.items.some(i => i.adkId === "bvf_ls_engpass" && i.art === "nachholen"));
    assert.ok(!p.items.some(i => i.adkId === "bvf_gs_anfahr"), "sitzt -> nicht erneut im Plan");
    // Verlauf aus v2.113/2.114 (status statt lernstand) wird genauso gelesen
    const alt = { ...stu, navigator: { verlauf: [{ datum: "2026-10-01", items: [{ adkId: "bvf_gs_anfahr", status: "sitzt" }, { adkId: "bvf_ls_engpass", status: "nicht" }] }] } };
    assert.ok(plan(alt, { gesamtPct: 30 }).items.some(i => i.adkId === "bvf_ls_engpass" && i.art === "nachholen"));
});

test("5./6. 45 Minuten: zwei Fahraufgaben, 90 Minuten: vier - Zeit passt", () => {
    const g = [{ date: "2026-10-01", status: "geuebt", rating: "okay" }];
    const stu = { lessons: [{ id: "l1", date: "2026-10-01" }], adkLog: { bvf_ls_rvl: g, bvf_ls_abbiegen: g, bvf_ls_vorfahrt: g, bvf_ls_fuss: g } };
    const p45 = plan(stu, { dauer: 45, gesamtPct: 50 });
    assert.equal(p45.items.length, 2);
    assert.ok(summe(p45) + p45.reserve <= 45);
    const p90 = plan(stu, { dauer: 90, gesamtPct: 50 });
    assert.equal(p90.items.length, 4);
    assert.ok(summe(p90) + p90.reserve <= 90);
});

test("10. Kurz vor der Prüfung: Prüfungsphase, zum Schluss selbstständig fahren", () => {
    const p = plan({ lessons: [{ id: "l1", date: "2026-10-05" }] }, { gesamtPct: 88, pruefDatum: "2026-10-20" });
    assert.equal(p.phase, "pruefung");
    assert.equal(p.pruefInTagen, 12);
    const letzter = p.items[p.items.length - 1];
    assert.equal(letzter.art, "anwenden");
    assert.match(letzter.grund, /Prüfung in 12 Tagen/);
    assert.equal(p.items.filter(i => /selbstständig/i.test(i.titel)).length, 1, "nur einmal selbstständig fahren");
});

test("Prüfungsnähe: auch eine 45-Minuten-Stunde endet prüfungsnah", () => {
    const p = plan({ lessons: [{ id: "l1", date: "2026-10-05" }] }, { dauer: 45, gesamtPct: 90 });
    assert.equal(p.phase, "pruefung");
    assert.ok(p.items.some(i => i.art === "anwenden"));
    assert.ok(summe(p) + p.reserve <= 45);
    assert.match(p.warum, /prüfungsnah/);
    assert.ok(!/^Dann/.test(p.warum), "„Warum“ beginnt nicht mit „Dann“");
});

test("11. Sonderfahrten: Hinweis ohne passenden Termin, zum Termin werden sie die Stunde", () => {
    const stu = { lessons: [{ id: "l1", date: "2026-10-05" }] };
    const sonder = [{ label: "Autobahn", erfuellt: false }, { label: "Überland", erfuellt: true }];
    const p = plan(stu, { gesamtPct: 70, sonder });
    assert.ok(p.hinweise.some(h => /Sonderfahrten noch offen: Autobahn/.test(h)));
    assert.ok(!p.items.some(i => i.art === "sonderfahrt"), "ohne passenden Termin keine Sonderfahrt-Punkte");
    const pAB = plan(stu, { gesamtPct: 70, sonder, terminArt: "AB" });
    assert.ok(pAB.items.length > 0 && pAB.items.every(i => i.art === "sonderfahrt" && /Autobahn/.test(i.sektion)));
    assert.match(pAB.ziel, /Autobahnfahrt/);
    assert.match(pAB.situation, /120 km\/h/);
    assert.equal(pAB.zielKurz, "Autobahnfahrt");
});

test("Sonderfahrten-Erinnerung ab etwa 15 Übungsstunden - als Hinweis, nicht als Sperre", () => {
    const sonder = [{ code: "AB", label: "Autobahn", ue: 0, sollUe: 4, erfuellt: false }];
    const frueh = plan({ lessons: [{ id: "l1", date: "2026-10-05" }] }, { ueGesamt: 8, sonder });
    assert.ok(!frueh.hinweise.some(h => /Sonderfahrten/.test(h)), "nach 8 Stunden noch keine Erinnerung");
    const spaeter = plan({ lessons: [{ id: "l1", date: "2026-10-05" }] }, { ueGesamt: 16, sonder });
    assert.ok(spaeter.hinweise.some(h => /Sonderfahrten noch offen: Autobahn \(0 von 4 UE\)/.test(h)));
    assert.ok(spaeter.items.length > 0, "die Stunde wird trotzdem geplant");
});

test("Wiederkehrende Schwäche lenkt das Ziel - und verliert Gewicht nach zweimal gut", () => {
    const r = (v, d) => ({ id: d, date: d, ratings: { tempo: v } });
    const schwach = plan({ lessons: [r(1, "2026-10-01"), r(1, "2026-09-28"), r(2, "2026-09-24")] }, { ueGesamt: 22 });
    assert.ok(schwach.schwach.indexOf("tempo") >= 0);
    assert.match(schwach.warum, /Geschwindigkeitsanpassung/);
    const besser = plan({ lessons: [r(3, "2026-10-07"), r(3, "2026-10-04"), r(1, "2026-10-01"), r(1, "2026-09-28")] }, { ueGesamt: 22 });
    assert.equal(besser.schwach.length, 0, "alte Auffälligkeit, zweimal danach gut -> keine Schwäche mehr");
});

test("14. Signatur ändert sich mit der Terminlänge (Plan wird neu berechnet)", () => {
    const stu = { lessons: [] };
    const e1 = { stu, adk: ADK, dauer: 90, heute: HEUTE, gesamtPct: 0, sonder: [] };
    const e2 = { ...e1, dauer: 45 };
    assert.notEqual(k.navigatorSignatur(e1, k.navigatorPlan(e1)), k.navigatorSignatur(e2, k.navigatorPlan(e2)));
});

test("Nur existierende ADK-IDs; lange Pause steht im Einstieg", () => {
    const stu = { lessons: [{ id: "l", date: "2026-09-01" }], adkLog: { gibts_nicht: [{ date: "2026-10-01", status: "geuebt" }] } };
    const p = plan(stu, { gesamtPct: 65, terminArt: "NF" });
    p.items.filter(i => i.adkId).forEach(i => assert.ok(alleAdkIds.has(i.adkId), i.adkId));
    assert.match(p.einstieg, /Nach 37 Tagen Pause/);
});

test("Statuspunkte wie „Testfahrt bestanden“ werden nie vorgeschlagen", () => {
    const p = k.navigatorPlan({ stu: { lessons: [{ id: "l1", date: "2026-10-01" }] }, adk: k.DEFAULT_ADK, dauer: 90, heute: HEUTE, gesamtPct: 0, sonder: [], ueGesamt: 30 });
    assert.ok(!p.items.some(i => /bestanden/i.test(i.titel)), p.items.map(i => i.titel).join(", "));
    const titel = p.items.map(i => i.titel.toLowerCase());
    assert.equal(new Set(titel).size, titel.length, "jeder Titel nur einmal: " + titel.join(", "));
    assert.ok(p.items.length >= 2);
});

test("Ergebnisse -> normale ADK: Sitzt voll, Geübt +1, Unsicher/Eingeführt nur Verlauf, Nicht dran nichts", () => {
    const idx = { s: { id: "s", count: 2 }, g: { id: "g", count: 3 }, u: { id: "u", count: 2 }, e: { id: "e", count: 2 }, n: { id: "n", count: 2 } };
    const stu = { items: { u: 1 }, lessons: [{ id: "l1", date: HEUTE, apptId: "A1", thema: "", ratings: {} }] };
    const neu = k.navigatorErgebnisAnwenden(stu, { heute: HEUTE, jetztIso: HEUTE + "T10:00:00Z", adkIndex: idx, apptId: "A1", neueLessonId: "lsX", ziel: "Kreuzungen sicher",
        ergebnisse: [{ adkId: "s", titel: "S", lernstand: "sicher" }, { adkId: "g", titel: "G", lernstand: "geuebt" }, { adkId: "u", titel: "U", lernstand: "unsicher" },
            { adkId: "e", titel: "E", lernstand: "eingefuehrt" }, { adkId: "n", titel: "N", lernstand: null }, { adkId: "erfunden", titel: "X", lernstand: "sicher" }],
        gut: "S sitzt.", naechstes: "U wiederholen.", ratings: { tempo: 2 } });
    assert.equal(neu.items.s, 2, "Sitzt -> Soll erreicht");
    assert.equal(neu.items.g, 1, "Geübt -> eine Übung mehr");
    assert.equal(neu.items.u, 1, "Unsicher -> Haken bleiben");
    assert.equal(neu.items.e, undefined, "Eingeführt -> kein Haken");
    assert.equal(neu.items.n, undefined, "Nicht dran -> nichts");
    assert.equal(neu.items.erfunden, undefined, "unbekannte ID verworfen");
    assert.equal(json(neu.adkDates.s), json([HEUTE]));
    assert.equal(neu.adkDates.u, undefined, "ohne neuen Haken kein Datum");
    assert.equal(json(neu.adkLog.s.map(x => [x.status, x.rating])), json([["gekonnt", "good"]]));
    assert.equal(json(neu.adkLog.u.map(x => [x.status, x.rating])), json([["geuebt", "bad"]]));
    assert.equal(neu.adkLog.e[0].status, "angesprochen");
    assert.equal(neu.adkLog.n, undefined);
    assert.equal(neu.lessons.length, 1, "vorhandener Termin-Eintrag ergänzt, keine Doppeldokumentation");
    assert.equal(neu.lessons[0].thema, "S, G, U, E");
    assert.equal(neu.lastNote, "U wiederholen.");
    assert.equal(neu.navigator.verlauf[0].ziel, "Kreuzungen sicher");
    assert.equal(neu.navigator.verlauf[0].items.length, 5, "unbekannte ID auch nicht im Verlauf");
    assert.equal(neu.navigator.plan, null);
    // Der Lernstand danach - wie ihn der nächste Plan sieht
    const lsNach = id => k.navPunktStand(neu, idx[id]).lernstand;
    assert.equal(json(["s", "g", "u", "e", "n"].map(lsNach)), json(["sicher", "geuebt", "unsicher", "eingefuehrt", "neu"]));
});

test("Ältere Ergebnisse (sitzt/weiter/nicht) werden richtig übernommen", () => {
    const neu = k.navigatorErgebnisAnwenden({}, { heute: HEUTE, adkIndex: index, neueLessonId: "n",
        ergebnisse: [{ adkId: "bvf_gs_anfahr", titel: "Anfahren", status: "sitzt" }, { adkId: "bvf_ls_rvl", titel: "rvl", status: "weiter" }, { adkId: "bvf_ls_engpass", titel: "Engpass", status: "nicht" }] });
    assert.equal(neu.items.bvf_gs_anfahr, parseInt(index.bvf_gs_anfahr.count, 10) || 1);
    assert.equal(neu.adkLog.bvf_ls_rvl[0].status, "geuebt");
    assert.equal(neu.adkLog.bvf_ls_engpass, undefined);
});

test("Geübt bei mehrfachem Soll zählt hoch, aber nie bis fertig", () => {
    const idx = { p: { id: "p", count: 3 } };
    const e = st => k.navigatorErgebnisAnwenden({ items: { p: st } }, { heute: HEUTE, adkIndex: idx, neueLessonId: "n", ergebnisse: [{ adkId: "p", titel: "P", lernstand: "geuebt" }] }).items.p;
    assert.equal(e(0), 1); assert.equal(e(1), 2); assert.equal(e(2), 2, "bleibt bei Soll-1"); assert.equal(e(3), 3, "schon fertig: nicht zurückgesetzt");
});

test("8. Übergabe-Überblick: sitzt / unsicher / geübt / noch nicht begonnen", () => {
    const stu = { items: { bvf_gs_einsteigen: 1 }, adkDates: { bvf_gs_einsteigen: ["2026-10-01"] },
        adkLog: { bvf_gs_sitz: [{ date: "2026-10-01", status: "geuebt", rating: "okay" }], bvf_gs_spiegel: [{ date: "2026-10-01", status: "geuebt", rating: "bad" }] } };
    const u = k.navigatorUebergabe(stu, ADK);
    assert.equal(u.sicher[0].titel, "Besonderheiten beim Einsteigen");
    assert.ok(u.weiter.some(w => w.titel === "Sitz"));
    assert.ok(u.unsicher.some(w => w.titel === "Spiegel"));
    assert.equal(u.offenBereich, "Grundstufe");
});

test("Übergabe zählt auch abgehakte Punkte ohne Datum (Import, „Alles abhaken“)", () => {
    const grund = sektion("bvf_grund").items;
    const items = {}; grund.forEach(it => { items[it.id] = parseInt(it.count, 10) || 1; });
    const u = k.navigatorUebergabe({ items }, ADK);
    assert.equal(u.sicherAnzahl, grund.length);
    assert.equal(u.sicher.length, 0, "ohne Datum keine „zuletzt“-Liste");
    assert.ok(u.gesamt > u.sicherAnzahl);
});

test("Lernstand nach Prüfungsthemen: Kreuzungen zuerst, Zählung je Stand", () => {
    const g = s => [{ date: "2026-10-01", status: s.split(":")[0], rating: s.split(":")[1] }];
    const stu = { items: { bvf_ls_vorfahrt: 1, bvf_ls_rvl: 1 }, adkLog: { bvf_ls_abbiegen: g("geuebt:okay"), bvf_ls_einordnen: g("geuebt:bad") } };
    const t = k.navigatorPruefungsthemen(stu, ADK);
    assert.equal(t[0].key, "kreuzung", "nach Bedeutung in der Prüfung sortiert");
    const kr = t[0];
    assert.equal(kr.sicher, 2);
    assert.equal(kr.geuebt, 1);
    assert.equal(kr.unsicher, 1);
    assert.equal(kr.sicher + kr.geuebt + kr.unsicher + kr.neu, kr.n);
    assert.equal(kr.status, "unsicher");
    assert.ok(!t.some(x => x.key === "bedienung" || x.key === "pruefung"), "nur Prüfungsthemen");
    assert.ok(t.some(x => x.key === "gfa") && t.some(x => x.key === "vorbereitung"));
});

test("Texte ohne KI und Praxistipps", () => {
    const t = k.navigatorTexteVorschlag([{ titel: "Anfahren", lernstand: "sicher" }, { titel: "rechts vor links", lernstand: "unsicher" },
        { titel: "Abbiegen", lernstand: "geuebt" }, { titel: "Engpass", lernstand: null }]);
    assert.equal(t.gut, "Anfahren sitzt.");
    assert.equal(t.naechstes, "rechts vor links noch unsicher – wiederholen. Abbiegen weiter üben. Engpass nachholen.");
    assert.match(k.navigatorTippFuer("rechts vor links").tipp, /Kreuzung laut ankündigen/);
    assert.match(k.navigatorTippFuer("Einfahren in BAB").tipp, /Lückenerkennung/);
});

test("7./12. ADK von Hand geändert: Signatur ändert sich, gesessener Punkt fällt raus", () => {
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
    const nach = anwenden(stu0, [{ adkId: a.adkId, titel: a.titel, lernstand: "sicher" }, { adkId: b.adkId, titel: b.titel, lernstand: "unsicher" }], { ziel: p1.ziel });
    const p2 = plan(nach, { gesamtPct: 32 });
    assert.ok(!p2.items.some(i => i.adkId === a.adkId), "was sitzt, kommt nicht direkt wieder");
    assert.equal(p2.items[0].adkId, b.adkId, "Unsicheres steht in der Folgestunde vorne");
    assert.equal(p2.items[0].lernstand, "unsicher");
    assert.match(p2.einstieg, new RegExp("Letzte Stunde \\(08\\.10\\.\\):.*" + a.titel + " sitzt.*" + b.titel + " noch unsicher"));
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
    assert.ok(!geplant.hinweise.some(h => /noch offen/i.test(h) || /reicht in die Dunkelheit/.test(h)));
});

test("Nichts behandelt: kein leerer Fahrstunden-Eintrag, aber nachholen beim nächsten Mal", () => {
    const stu = { lessons: [{ id: "l1", date: "2026-10-01" }] };
    const nach = anwenden(stu, [{ adkId: "bvf_ls_engpass", titel: "Engpass", lernstand: null }], { apptId: "t9", neueLessonId: "n9" });
    assert.equal(nach.lessons.length, 1, "kein leerer Eintrag");
    assert.equal(nach.navigator.verlauf.length, 1);
    assert.ok(plan(nach, { gesamtPct: 30 }).items.some(i => i.adkId === "bvf_ls_engpass" && i.art === "nachholen"));
});

test("Bestehender Schüler mit vielen Stunden, kaum ADK-Haken: beginnt nicht am Anfang", () => {
    const p = plan({ lessons: [{ id: "l1", date: "2026-10-01" }] }, { ueGesamt: 22, ueSonder: 0, gesamtPct: 40 });
    const frueh = new Set([...sektion("bvf_grund").items, ...sektion("bvf_aufbau").items, ...sektion("bvf_grundfahr").items].map(i => i.id));
    assert.ok(!p.items.some(i => frueh.has(i.adkId)), "keine Grund-/Aufbaustufe und keine Grundfahraufgaben laut Stundenzahl");
    assert.equal(p.stufeLautStunden, true);
    assert.equal(json(p.stufen.filter(s => s.status === "fertig").map(s => s.key)), json(["grund", "aufbau", "gfa", "leistung"]));
    assert.equal(p.ersteStunde, false);
});

test("8 Stunden ohne ADK-Haken: Aufbaustufe statt Grundstufe", () => {
    const p = plan({}, { ueGesamt: 8 });
    const aufbau = new Set(sektion("bvf_aufbau").items.map(i => i.id));
    assert.equal(p.ersteStunde, false, "8 Stunden sind keine erste Stunde");
    assert.ok(p.items.filter(i => i.art === "neu").every(i => aufbau.has(i.adkId)));
    assert.equal(p.stufen.find(s => s.status === "jetzt").key, "aufbau");
});

test("Gepflegte ADK hat Vorrang vor der Stundenzahl (langsamer Schüler)", () => {
    const items = {}; sektion("bvf_grund").items.forEach(it => { items[it.id] = parseInt(it.count, 10) || 1; });
    const ersterAufbau = sektion("bvf_aufbau").items[0];
    items[ersterAufbau.id] = parseInt(ersterAufbau.count, 10) || 1;
    const p = plan({ items, lessons: [{ id: "l1", date: "2026-10-01" }] }, { ueGesamt: 12 });
    assert.equal(p.stufen.find(s => s.status === "jetzt").key, "aufbau", "offene Aufbaustufe zuerst, obwohl 12 Stunden");
    assert.ok(p.items.some(i => i.art === "neu" && /Aufbaustufe/.test(i.sektion)));
    assert.equal(p.stufeLautStunden, false);
});

test("Gepflegte ADK: offene Grundfahraufgaben kommen auch in der Leistungsstufe noch dran", () => {
    const items = {};
    ["bvf_grund", "bvf_aufbau"].forEach(id => sektion(id).items.forEach(it => { items[it.id] = parseInt(it.count, 10) || 1; }));
    items.bvf_ls_fahrbahn = 1;
    const stu = { lessons: [{ id: "l1", date: "2026-10-01" }], items, adkLog: { bvf_gf_rueckw: [{ date: "2026-10-01", status: "geuebt", rating: "bad" }] } };
    const p = plan(stu, { ueGesamt: 18 });
    assert.equal(p.stufen.find(s => s.status === "jetzt").key, "leistung");
    assert.equal(p.zielAufgabe, "gfa");
    const gfa = new Set(sektion("bvf_grundfahr").items.map(i => i.id));
    assert.equal(p.items[0].adkId, "bvf_gf_rueckw");
    assert.ok(p.items.some(i => gfa.has(i.adkId) && i.lernstand === "neu"), "noch nicht begonnene Grundfahraufgabe dabei: " + p.items.map(i => i.titel).join(", "));
});

test("Sonderfahrten im Kalender verfälschen die Übungsstufe nicht", () => {
    const p = plan({}, { ueGesamt: 14, ueSonder: 12 });
    assert.equal(p.stufen.find(s => s.status === "jetzt").key, "grund", "nur 2 Übungs-UE");
});

test("Prüfungsreife erst nach den 12 Sonderfahrten - inklusive Doppelstunde", () => {
    const sf = (ulFertig, ulDoppel) => [
        { code: "ÜL", label: "Überland", ue: ulFertig ? 5 : 2, sollUe: 5, erfuellt: ulFertig, langeFahrtDabei: ulDoppel },
        { code: "AB", label: "Autobahn", ue: 4, sollUe: 4, erfuellt: true, langeFahrtDabei: true },
        { code: "NF", label: "Dämmerungsfahrt", ue: 3, sollUe: 3, erfuellt: true, langeFahrtDabei: true }];
    const stu = { lessons: [{ id: "l1", date: "2026-10-05" }] };
    const status = p => json(Object.fromEntries(p.stufen.map(x => [x.key, x.status])));
    const ohneDoppel = plan(stu, { ueGesamt: 40, ueSonder: 12, sonder: sf(true, false) });
    assert.match(status(ohneDoppel), /"sonder":"jetzt"/);
    assert.match(status(ohneDoppel), /"reife":"offen"/);
    assert.notEqual(ohneDoppel.phase, "pruefung", "ohne Doppelstunde noch nicht prüfungsnah");
    assert.ok(ohneDoppel.hinweise.some(h => /Überland \(5 von 5 UE, Doppelstunde fehlt\)/.test(h)));
    assert.ok(ohneDoppel.sonderStand.find(x => x.code === "ÜL").doppelstundeFehlt);
    const fertig = plan(stu, { ueGesamt: 40, ueSonder: 12, sonder: sf(true, true) });
    assert.match(status(fertig), /"sonder":"fertig"/);
    assert.match(status(fertig), /"reife":"jetzt"/);
    assert.equal(fertig.phase, "pruefung");
    const laeuft = plan(stu, { ueGesamt: 10, ueSonder: 2, sonder: sf(false, true) });
    assert.match(status(laeuft), /"sonder":"teil"/, "Sonderfahrten laufen schon, Kernstufen noch nicht durch");
});

test("Sicherheitskontrolle: nie das Ziel, höchstens ein Punkt vorab am stehenden Auto", () => {
    const items = {};
    ["bvf_grund", "bvf_aufbau", "bvf_grundfahr", "bvf_leistung"].forEach(id => sektion(id).items.forEach(it => { items[it.id] = parseInt(it.count, 10) || 1; }));
    const g = [{ date: "2026-10-01", status: "geuebt", rating: "okay" }];
    const stu = { lessons: [{ id: "l1", date: "2026-10-05" }], items, adkLog: { bvf_sb_reifen: g, bvf_sb_funktion: g, bvf_sb_bremsen: g } };
    const p = plan(stu, { ueGesamt: 30 });
    assert.notEqual(p.zielAufgabe, "vorbereitung");
    const sk = p.items.filter(i => i.aufgabe === "vorbereitung");
    assert.equal(sk.length, 1, p.items.map(i => i.titel).join(", "));
    assert.equal(p.items[0].aufgabe, "vorbereitung", "vorab, vor der Fahrt");
    assert.match(p.items[0].grund, /stehenden Auto/);
    assert.ok(!/Neues aus der Situative/.test(p.warum));
});

test("Alles sitzt außer der Sicherheitskontrolle: Ziel prüfungsnah fahren, Kontrolle vorab", () => {
    const items = {};
    ADK.filter(s => s.id !== "bvf_situativ").forEach(s => s.items.forEach(it => { items[it.id] = parseInt(it.count, 10) || 1; }));
    const sonder = ["ÜL", "AB", "NF"].map(c => ({ code: c, label: c, ue: 5, sollUe: 5, erfuellt: true, langeFahrtDabei: true }));
    const p = plan({ lessons: [{ id: "l1", date: "2026-10-05" }], items }, { ueGesamt: 40, ueSonder: 12, sonder, gesamtPct: 95 });
    assert.equal(p.phase, "pruefung");
    assert.equal(p.zielAufgabe, "pruefung");
    assert.equal(p.zielKurz, "Prüfungsnah fahren");
    assert.equal(p.items.filter(i => i.aufgabe === "vorbereitung").length, 2);
    assert.equal(p.items[p.items.length - 1].art, "anwenden", "zum Schluss prüfungsnah fahren");
});

test("Wetter-Punkte werden nie vorgeschlagen; ohne Prüfungsbezug zählt nichts als Prüfungsthema", () => {
    const sit = sektion("bvf_situativ");
    const wetter = sit.items.filter(it => k.navAufgabeVon(it, sit) === "wetter").map(it => it.id);
    assert.equal(json(wetter), json(["bvf_sb_witterung", "bvf_sb_aquaplaning", "bvf_sb_wind"]));
    assert.equal(k.navAufgabeVon(sit.items.find(i => i.id === "bvf_sb_nebel"), sit), "vorbereitung", "Nebelschlussleuchte ist Fahrzeugkontrolle");
    const ls = sektion("bvf_leistung");
    assert.equal(k.navAufgabeVon(ls.items.find(i => i.id === "bvf_ls_schwung"), ls), "sonst");
    assert.equal(k.navAufgabeVon(ls.items.find(i => i.id === "bvf_ls_geschw"), ls), "gerade");
    const dk = sektion("bvf_daemmerung");
    assert.equal(k.navAufgabeVon(dk.items.find(i => i.id === "bvf_dk_fern"), dk), "sonst");
    // Auch zur passenden Sonderfahrt kein Wetter-Punkt
    const p = plan({ lessons: [{ id: "l1", date: "2026-10-05" }] }, { gesamtPct: 70, terminArt: "NF", dauer: 240 });
    assert.ok(!p.items.some(i => /witterung/i.test(i.titel)));
    const gerade = k.navigatorPruefungsthemen({}, ADK).find(t => t.key === "gerade");
    assert.ok(gerade.n < 20, "nur echte Tempo-/Abstand-/Schilder-Punkte: " + gerade.n);
});

test("Sonderfahrt, deren Punkte schon sitzen: trotzdem Fahraufgaben zum Festigen", () => {
    const items = {}; sektion("bvf_autobahn").items.forEach(it => { items[it.id] = parseInt(it.count, 10) || 1; });
    const p = plan({ lessons: [{ id: "l1", date: "2026-10-05" }], items }, { gesamtPct: 70, terminArt: "AB" });
    assert.equal(p.items.length, 4);
    assert.ok(p.items.every(i => /Autobahn/.test(i.sektion) && i.lernstand === "sicher"));
    assert.ok(new Set(p.items.map(i => i.aufgabe)).size >= 3, "je Thema einer: " + p.items.map(i => i.titel).join(", "));
    assert.ok(p.items.some(i => i.aufgabe === "fahrstreifen"), "Einfädeln/Fahrstreifen gehört dazu");
    assert.match(p.items[0].grund, /festigen/);
    assert.match(p.warum, /sitzen schon/);
});
