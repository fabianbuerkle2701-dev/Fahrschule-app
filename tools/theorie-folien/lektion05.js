// Allindrive Theorie · Klasse B · Grundstoff Lektion 5 „Vorfahrt und Verkehrsregelung“
// Eigene Inhalte nach Anlage 1 FahrschAusbO und StVO (§§ 1, 6, 8, 9, 10, 11, 36, 37, Anlagen 2/3).
// Aufruf: node lektion05.js [nur=<Foliennummer>] → schreibt Lektion05.pptx bzw. einzel-<n>.pptx
const PptxGenJS = require("pptxgenjs");
const B = require("./bausteine");
const { C, W, text, kopf, folie, rect, rund, kreis, karte, nummer, pfad, kreuzung, ankunft, auto, radfahrer, weg } = B;

const nur = (process.argv.find(a => a.startsWith("nur=")) || "").split("=")[1];
const pres = new PptxGenJS();
pres.layout = "LAYOUT_WIDE";
pres.author = "Allindrive";
pres.company = "Allindrive";
pres.title = "Lektion 5 · Vorfahrt und Verkehrsregelung";
pres.subject = "Theorieunterricht Klasse B, Grundstoff";
B.init(pres);
B.masters(pres, "Allindrive · Klasse B · Lektion 5 · Vorfahrt und Verkehrsregelung");

const folien = [];
const neu = fn => folien.push(fn);

// Regel-Zeilen: Punkt + fetter Kurztitel + Text
function regeln(s, items, o) {
    const x = o.x, y0 = o.y, w = o.w, dunkel = !!o.dunkel, fs = o.fs || 19, hoehe = o.hoehe || 1.0;
    items.forEach((it, i) => {
        const y = y0 + i * hoehe;
        kreis(s, x + 0.12, y + 0.2, 0.17, it.farbe || C.orange);
        const runs = [];
        if (it.t) runs.push({ text: it.t + " ", options: { bold: true, color: dunkel ? C.weiss : C.text } });
        runs.push({ text: it.x, options: { color: dunkel ? "D5DAE0" : "343B44" } });
        text(s, runs, { x: x + 0.42, y, w: w - 0.42, h: hoehe - 0.08, fontSize: fs, lineSpacingMultiple: 1.05 });
    });
}
function abschnitt(nr, titel, satz) {
    neu(() => {
        const s = folie("DUNKEL");
        // dezente Kreuzungsmarke rechts (zuerst, damit sie nie über dem Text liegt)
        rect(s, 11.45, 1.2, 0.8, 4.6, C.nacht2); rect(s, 10.55, 3.1, 2.78, 0.8, C.nacht2);
        text(s, nr, { x: 0.6, y: 1.55, w: 4, h: 2.0, fontSize: 140, bold: true, color: C.orange });
        text(s, titel, { x: 0.6, y: 3.55, w: 9.7, h: 1.0, fontSize: 44, bold: true, color: C.weiss });
        text(s, satz, { x: 0.62, y: 4.65, w: 9.7, h: 0.6, fontSize: 22, color: C.grauHell });
        s.addNotes("Kapitelwechsel: kurz sagen, was jetzt kommt und warum es wichtig ist.");
        return s;
    });
}
function frage(s, kicker, titel) {
    text(s, kicker.toUpperCase(), { x: 0.6, y: 0.42, w: 8, h: 0.3, fontSize: 12, bold: true, charSpacing: 2, color: C.orange });
    text(s, titel, { x: 0.6, y: 0.74, w: 12.1, h: 0.8, fontSize: 32, bold: true, color: C.weiss });
}
function legende(s, x, y, eintraege, dunkel) {
    eintraege.forEach((e, i) => {
        const yy = y + i * 0.42;
        rund(s, x, yy + 0.04, 0.42, 0.24, e.farbe, 0.06, { line: { color: C.weiss, width: 1 } });
        text(s, e.text, { x: x + 0.55, y: yy, w: 5.2, h: 0.34, fontSize: 15, color: dunkel ? "D5DAE0" : "343B44", valign: "middle" });
    });
}

// ═════ 1 Titel ═════
neu(() => {
    const s = folie("TITEL");
    text(s, "KLASSE B · GRUNDSTOFF · LEKTION 5", { x: 0.7, y: 1.45, w: 6.5, h: 0.35, fontSize: 14, bold: true, charSpacing: 3, color: C.orange });
    text(s, "Vorfahrt und Verkehrs­regelung", { x: 0.7, y: 1.9, w: 6.3, h: 2.5, fontSize: 54, bold: true, color: C.weiss, lineSpacingMultiple: 0.95 });
    text(s, "Wer fährt zuerst – und warum?", { x: 0.7, y: 4.6, w: 6.3, h: 0.6, fontSize: 24, color: C.grauHell });
    text(s, [{ text: "Allindrive", options: { bold: true, color: C.weiss } }, { text: ".", options: { bold: true, color: C.orange } }, { text: "   Theorie · Doppelstunde, 90 Minuten", options: { color: "8A939D" } }],
        { x: 0.7, y: 6.55, w: 6.5, h: 0.4, fontSize: 15 });
    const k = kreuzung(s, { x: 7.4, y: 0.75, w: 5.3, h: 6.0, rw: 1.75, dunkel: true });
    const du = auto(s, ankunft(k, "s", 0.85), C.orange, { du: true });
    const blau = auto(s, ankunft(k, "o", 0.8), C.blau);
    const gruen = auto(s, ankunft(k, "w", 0.8), C.gruen);
    pfad(s, weg(k, blau, "g", 0.7), { farbe: C.weiss });
    pfad(s, weg(k, du, "g", 0.7), { farbe: C.orange, dash: "dash" });
    nummer(s, blau.x, blau.y - 0.62, 1);
    s.addNotes("Begrüßung. Einstieg mit der Frage auf der Folie: Wer von euch ist schon einmal unsicher an einer Kreuzung gewesen? Kurz sammeln, nicht auflösen – das Bild rechts kommt später als Aufgabe wieder.");
    return s;
});

// ═════ 2 Lernziele ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "Lektion 5 · Überblick", "Darum geht’s heute");
    const z = [
        ["01", "Rangfolge kennen", "Polizei vor Ampel vor Schild vor „rechts vor links“."],
        ["02", "Kreuzungen lesen", "Rechts vor links, Vorfahrtszeichen, abknickende Vorfahrt, Kreisverkehr."],
        ["03", "Ampel und Polizei", "Lichtzeichen, Grünpfeil und Handzeichen sicher deuten."],
        ["04", "Fair fahren", "Wartepflicht zeigen, sich verständigen – und auch mal verzichten."],
    ];
    const bw = 5.9, bh = 2.3;
    z.forEach((e, i) => {
        const x = 0.6 + (i % 2) * (bw + 0.33), y = 1.8 + Math.floor(i / 2) * (bh + 0.3);
        karte(s, x, y, bw, bh);
        text(s, e[0], { x: x + 0.4, y: y + 0.35, w: 1.2, h: 0.6, fontSize: 30, bold: true, color: C.orangeText });
        text(s, e[1], { x: x + 0.4, y: y + 0.98, w: bw - 2.0, h: 0.5, fontSize: 22, bold: true, color: C.text });
        text(s, e[2], { x: x + 0.4, y: y + 1.45, w: bw - 2.0, h: 0.75, fontSize: 16, color: C.grau });
        const ix = x + bw - 1.05, iy = y + bh / 2;
        if (i === 0) [0, 1, 2].forEach(j => rund(s, ix - 0.48, iy - 0.42 + j * 0.34, 0.96 - j * 0.22, 0.24, j === 0 ? C.orange : "C9D0D8", 0.06));
        if (i === 1) B.z205(s, ix, iy, 0.95);
        if (i === 2) B.ampel(s, ix - 0.2, iy - 0.55, 1.1, ["gruen"]);
        if (i === 3) { auto(s, { x: ix - 0.35, y: iy, dir: "n" }, C.blau, { L: 0.8, B: 0.42 }); auto(s, { x: ix + 0.35, y: iy, dir: "s" }, C.orange, { L: 0.8, B: 0.42 }); }
    });
    s.addNotes("Die vier Ziele kurz vorlesen lassen. Am Ende der Stunde mit der Lernstandskontrolle wieder darauf zurückkommen.");
    return s;
});

// ═════ 3 Einstieg: Prüfungsstatistik ═════
neu(() => {
    const s = folie("DUNKEL");
    text(s, "WARUM DAS SO WICHTIG IST", { x: 0.6, y: 0.42, w: 8, h: 0.3, fontSize: 12, bold: true, charSpacing: 2, color: C.orange });
    text(s, "57 %", { x: 0.55, y: 0.95, w: 6.0, h: 2.3, fontSize: 150, bold: true, color: C.orange });
    text(s, "aller Fehler, die in der praktischen Prüfung zum Durchfallen führen, passieren an Kreuzungen, Einmündungen und beim Einfahren.",
        { x: 6.4, y: 1.25, w: 6.3, h: 1.9, fontSize: 26, bold: true, color: C.weiss, lineSpacingMultiple: 1.05 });
    // gestapelter Balken
    const teile = [["Kreuzung, Einmündung, Einfahren", 57.5, C.orange], ["Geradeausfahren", 23.3, "7C8794"], ["Fahrstreifenwechsel", 9.6, "57616D"], ["Sonstige", 9.6, "3A424C"]];
    let x = 0.6; const bw = 12.13, y = 4.15, h = 0.62;
    teile.forEach(t => { const w = bw * t[1] / 100; rect(s, x, y, w - 0.03, h, t[2]); x += w; });
    x = 0.6;
    teile.forEach((t, i) => {
        const w = bw * t[1] / 100;
        text(s, String(t[1]).replace(".", ",") + " %", { x: x + 0.1, y: y + 0.12, w: Math.max(w - 0.2, 0.9), h: 0.4, fontSize: 16, bold: true, color: i === 0 ? C.text : C.weiss });
        if (i < 2) text(s, t[0], { x: x + 0.02, y: y + h + 0.12, w: Math.max(w - 0.1, 2.5), h: 0.35, fontSize: 14, color: C.grauHell });
        x += w;
    });
    text(s, "Häufigster Einzelfehler überhaupt: Vorfahrt oder Vorrang nicht beachtet.", { x: 0.6, y: 5.45, w: 12, h: 0.45, fontSize: 20, color: C.weiss });
    text(s, "Quelle: TÜV | DEKRA arge tp 21, Innovationsbericht 2019–2022 – Auswertung von 1.294.715 Prüfungen der Klasse B (10/2021 bis 09/2022), Fehler mit „nicht bestanden“.",
        { x: 0.6, y: 6.3, w: 12, h: 0.45, fontSize: 11, color: "7E8893" });
    s.addNotes("Die Zahl wirken lassen. Frage an die Gruppe: Warum gerade Kreuzungen? (Viele Beteiligte, wenig Zeit, Regeln überlagern sich.) Überleitung: Heute lernt ihr, wie man jede Kreuzung lesen kann.");
    return s;
});

// ═════ 4 Abschnitt 01 ═════
abschnitt("01", "Wer hat das Sagen?", "Die Rangfolge der Regeln – von der Polizei bis „rechts vor links“");

// ═════ 5 Rangfolge ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "01 · Rangfolge", "Was zuerst gilt", "§ 36, § 37, § 8 StVO");
    const stufen = [
        ["Polizei", "Zeichen und Weisungen gehen allen anderen Regeln vor.", C.nacht, C.weiss, "D5DAE0"],
        ["Ampel", "Lichtzeichen gehen Vorfahrtsschildern und der Grundregel vor.", "2E353E", C.weiss, "D5DAE0"],
        ["Verkehrszeichen", "Vorfahrt gewähren, Stopp, Vorfahrtstraße …", "56606B", C.weiss, "E6EAEE"],
        ["Grundregel", "Rechts vor links – überall, wo nichts anderes gilt.", "E3E8ED", C.text, "343B44"],
    ];
    stufen.forEach((st, i) => {
        const y = 1.8 + i * 1.2, w = 8.3 - i * 0.55;
        rund(s, 0.6, y, w, 1.02, st[2], 0.14);
        nummer(s, 1.12, y + 0.51, i + 1, { d: 0.56, fs: 20 });
        text(s, st[0], { x: 1.6, y: y + 0.12, w: w - 1.2, h: 0.42, fontSize: 22, bold: true, color: st[3] });
        text(s, st[1], { x: 1.6, y: y + 0.55, w: w - 1.2, h: 0.4, fontSize: 16, color: st[4] });
    });
    rund(s, 9.35, 1.8, 3.38, 4.62, C.orange, 0.2);
    text(s, "MERKE", { x: 9.7, y: 2.1, w: 2.8, h: 0.3, fontSize: 13, bold: true, charSpacing: 2, color: C.text });
    text(s, "Was weiter oben steht, gilt.", { x: 9.7, y: 2.5, w: 2.75, h: 1.3, fontSize: 26, bold: true, color: C.text });
    text(s, "Polizei schlägt Ampel. Ampel schlägt Schild. Schild schlägt „rechts vor links“.", { x: 9.7, y: 4.05, w: 2.75, h: 2.1, fontSize: 17, color: C.text });
    s.addNotes("§ 36 Abs. 1 StVO: Zeichen und Weisungen der Polizei gehen allen anderen Anordnungen und Regeln vor. § 37 Abs. 1: Lichtzeichen gehen Vorrangregeln und vorfahrtregelnden Zeichen vor. Beispiel: Ampel ausgefallen → Schilder gelten; keine Schilder → rechts vor links.");
    return s;
});

// ═════ 6 Frage 1 ═════
function polizeiAmpelBild(s) {
    karte(s, 0.6, 1.8, 5.2, 4.75, true);
    B.ampel(s, 1.35, 2.35, 3.2, ["gruen"]);
    B.polizist(s, 4.0, 2.9, 3.0, "hoch", true);
}
neu(() => {
    const s = folie("DUNKEL");
    frage(s, "Frage · Rangfolge", "Grün – aber der Polizist hebt den Arm. Was tust du?");
    polizeiAmpelBild(s);
    [["A", "Ich fahre – Grün ist Grün."], ["B", "Ich warte auf das nächste Zeichen."], ["C", "Ich fahre, wenn die Kreuzung frei ist."]].forEach((a, i) => {
        const y = 1.8 + i * 1.62;
        karte(s, 6.25, y, 6.48, 1.4, true);
        kreis(s, 6.95, y + 0.7, 0.7, C.nacht3);
        text(s, a[0], { x: 6.6, y: y + 0.35, w: 0.7, h: 0.7, fontSize: 24, bold: true, color: C.orange, align: "center", valign: "middle" });
        text(s, a[1], { x: 7.55, y: y + 0.2, w: 5.0, h: 1.0, fontSize: 22, color: C.weiss, valign: "middle" });
    });
    s.addNotes("Abstimmen lassen: 1, 2 oder 3 Finger. Erst dann weiterklicken. Richtig ist B (§ 36 Abs. 2 Nr. 2 StVO).");
    return s;
});
neu(() => {
    const s = folie("DUNKEL");
    frage(s, "Auflösung", "B – du wartest auf das nächste Zeichen");
    polizeiAmpelBild(s);
    rund(s, 6.25, 1.8, 6.48, 1.4, C.orange, 0.18);
    text(s, "B", { x: 6.6, y: 2.15, w: 0.7, h: 0.7, fontSize: 26, bold: true, color: C.text, align: "center", valign: "middle" });
    text(s, "Ich warte auf das nächste Zeichen.", { x: 7.55, y: 2.0, w: 5.0, h: 1.0, fontSize: 22, bold: true, color: C.text, valign: "middle" });
    regeln(s, [
        { t: "Arm hoch", x: "heißt: Alle warten auf das nächste Zeichen." },
        { t: "Polizei vor Ampel:", x: "Grün gilt in diesem Moment nicht." },
        { t: "Schon in der Kreuzung?", x: "Dann fährst du sie frei." },
    ], { x: 6.3, y: 3.65, w: 6.4, dunkel: true, fs: 19, hoehe: 0.9 });
    s.addNotes("§ 36 Abs. 2 Nr. 2 StVO: Hochheben eines Arms ordnet an: „Vor der Kreuzung auf das nächste Zeichen warten“. Wer sich bereits in der Kreuzung befindet, muss sie räumen.");
    return s;
});

// ═════ Abschnitt 02 ═════
abschnitt("02", "Rechts vor links", "Die Grundregel – immer dann, wenn nichts anderes geregelt ist");

// ═════ Rechts vor links ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "02 · Grundregel", "Rechts vor links", "§ 8 Abs. 1 StVO");
    regeln(s, [
        { t: "Wo?", x: "An Kreuzungen und Einmündungen ohne Polizei, Ampel oder Vorfahrtszeichen." },
        { t: "Wer?", x: "Wer von rechts kommt, fährt zuerst – egal, wohin er will." },
        { t: "Auch Radfahrer:", x: "Kommt ein Rad von rechts, hat es Vorfahrt." },
        { t: "Egal:", x: "Breite, Belag oder Verkehrsmenge der Straße zählen nicht." },
    ], { x: 0.6, y: 1.95, w: 5.7, fs: 19, hoehe: 1.12 });
    const k = kreuzung(s, { x: 6.7, y: 1.75, w: 6.03, h: 4.95, rw: 1.75 });
    const du = auto(s, ankunft(k, "s", 0.75), C.orange, { du: true });
    const blau = auto(s, ankunft(k, "o", 0.85), C.blau);
    pfad(s, weg(k, blau, "g", 0.6), { farbe: C.weiss });
    pfad(s, weg(k, du, "g", 0.6), { farbe: C.orange, dash: "dash" });
    nummer(s, blau.x + 0.05, blau.y - 0.6, 1); nummer(s, du.x + 0.62, du.y + 0.1, 2);
    s.addNotes("Blau kommt von rechts und fährt zuerst – auch wenn er links abbiegen würde. Frage: Woran erkennt ihr, dass hier rechts vor links gilt? (Keine Schilder, keine Ampel, keine Polizei.) Hinweis: An unübersichtlichen Stellen langsam heranfahren – sonst kommt die Bremsung zu spät.");
    return s;
});

// ═════ Einmündung ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "02 · Grundregel", "Auch an Einmündungen", "§ 8 Abs. 1 StVO");
    const k = kreuzung(s, { x: 0.6, y: 1.75, w: 6.03, h: 4.95, rw: 1.75, arme: { w: 1, o: 1, s: 1 }, cy: 3.55 });
    const du = auto(s, ankunft(k, "w", 0.9), C.orange, { du: true });
    const blau = auto(s, ankunft(k, "s", 0.75), C.blau);
    pfad(s, weg(k, blau, "l", 0.6), { farbe: C.weiss });
    pfad(s, weg(k, du, "g", 0.6), { farbe: C.orange, dash: "dash" });
    nummer(s, blau.x + 0.6, blau.y + 0.1, 1); nummer(s, du.x, du.y - 0.6, 2);
    regeln(s, [
        { t: "Die Falle:", x: "Du fährst auf der „großen“ Straße, von rechts mündet eine kleine Straße ein." },
        { t: "Trotzdem:", x: "Kommt dort jemand, hat er Vorfahrt – wenn kein Schild etwas anderes sagt." },
        { t: "Darum:", x: "An jeder Einmündung ohne Schild nach rechts schauen und bremsbereit sein." },
    ], { x: 7.05, y: 1.95, w: 5.7, fs: 19, hoehe: 1.4 });
    s.addNotes("Einmündung = T-Kreuzung. Die Grundregel gilt auch hier. Typischer Prüfungsfehler: auf der breiteren Straße einfach weiterfahren. Frage: Woran erkennt man vorab eine Einmündung? (Bordsteinabsenkung, Lücke in der Häuserreihe, Straßenschild, Verkehrszeichen 102 als Warnung.)");
    return s;
});

// ═════ Einfahren ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "02 · Grundregel", "Einfahren heißt: alle durchlassen", "§ 8 Abs. 1, § 10 StVO");
    const karten = [
        ["Feld- und Waldwege", "Wer aus einem Feld- oder Waldweg auf eine andere Straße fährt, hat keine Vorfahrt.", "feld"],
        ["Grundstück, Parkplatz, Tankstelle", "Beim Einfahren auf die Straße darfst du niemanden gefährden.", "grund"],
        ["Verkehrsberuhigter Bereich", "Auch hier und über einen abgesenkten Bordstein wartest du auf alle – Fußgänger eingeschlossen.", "bord"],
    ];
    karten.forEach((kd, i) => {
        const x = 0.6 + i * 4.13, y = 1.8, w = 3.85, h = 4.3;
        karte(s, x, y, w, h);
        // kleine Szene: Hauptstraße waagerecht, Zufahrt von unten
        const sx = x + 0.35, sy = y + 0.35, sw = w - 0.7, sh = 1.75;
        rund(s, sx, sy, sw, sh, C.panelHell, 0.12);
        rect(s, sx, sy + 0.25, sw, 0.75, C.asphalt);
        const zf = kd[2] === "feld" ? "9C7B4F" : kd[2] === "grund" ? "8D97A3" : "B9C1CA";
        rect(s, sx + sw / 2 - 0.35, sy + 1.0, 0.7, sh - 1.0, zf);
        if (kd[2] === "bord") rect(s, sx + sw / 2 - 0.45, sy + 0.98, 0.9, 0.06, C.weiss);
        if (kd[2] === "grund") { rect(s, sx + sw / 2 - 0.5, sy + sh - 0.12, 1.0, 0.12, "5B6571"); }
        auto(s, { x: sx + sw / 2, y: sy + sh - 0.4, dir: "n" }, C.orange, { L: 0.62, B: 0.36 });
        auto(s, { x: sx + 0.7, y: sy + 0.8, dir: "o" }, C.blau, { L: 0.62, B: 0.36 });
        pfad(s, [[sx + 1.05, sy + 0.8], [sx + sw - 0.25, sy + 0.8]], { farbe: C.weiss, breite: 2.5, spitze: 0.18 });
        text(s, kd[0], { x: x + 0.35, y: y + 2.3, w: w - 0.7, h: 0.75, fontSize: 18, bold: true, color: C.text });
        text(s, kd[1], { x: x + 0.35, y: y + 3.1, w: w - 0.7, h: 1.1, fontSize: 15, color: C.grau });
    });
    text(s, "Eine Gefährdung muss ausgeschlossen sein – wenn nötig, lässt du dich einweisen.", { x: 0.6, y: 6.3, w: 12.1, h: 0.45, fontSize: 18, bold: true, color: C.text });
    s.addNotes("§ 8 Abs. 1 Satz 2 Nr. 2 StVO: keine Vorfahrt für Fahrzeuge aus Feld- oder Waldwegen. § 10 StVO: Wer aus einem Grundstück, einem Fußgängerbereich, einem verkehrsberuhigten Bereich oder über einen abgesenkten Bordstein einfährt, muss eine Gefährdung anderer ausschließen; erforderlichenfalls einweisen lassen. Frage: Wo kommt das in eurem Alltag vor? (Supermarkt-Parkplatz, Tankstelle, Hofeinfahrt.)");
    return s;
});

// ═════ Frage 2: drei Autos ═════
function dreiAutos(s, aufloesung) {
    const k = kreuzung(s, { x: 6.2, y: 1.75, w: 6.53, h: 4.95, rw: 1.75, dunkel: true });
    const du = auto(s, ankunft(k, "s", 0.75), C.orange, { du: true });
    const blau = auto(s, ankunft(k, "o", 0.9), C.blau);
    const gruen = auto(s, ankunft(k, "w", 0.9), C.gruen);
    pfad(s, weg(k, blau, "g", 0.55), { farbe: C.weiss });
    pfad(s, weg(k, du, "g", 0.55), { farbe: C.orange, dash: "dash" });
    pfad(s, weg(k, gruen, "g", 0.55), { farbe: C.weiss });
    if (aufloesung) { nummer(s, blau.x, blau.y - 0.6, 1); nummer(s, du.x + 0.62, du.y + 0.1, 2); nummer(s, gruen.x, gruen.y + 0.6, 3); }
}
neu(() => {
    const s = folie("DUNKEL");
    frage(s, "Frage · Rechts vor links", "Wer fährt zuerst?");
    dreiAutos(s, false);
    regeln(s, [
        { t: "Keine Schilder,", x: "keine Ampel, keine Polizei." },
        { t: "Alle", x: "wollen geradeaus." },
        { t: "Ordne:", x: "Blau, Grün und du – in welcher Reihenfolge?" },
    ], { x: 0.6, y: 1.95, w: 5.2, dunkel: true, fs: 21, hoehe: 1.15 });
    s.addNotes("Zeit geben, Reihenfolge aufschreiben lassen. Tipp: Für jedes Auto einzeln fragen: Kommt jemand von rechts?");
    return s;
});
neu(() => {
    const s = folie("DUNKEL");
    frage(s, "Auflösung", "Blau, dann du, dann Grün");
    dreiAutos(s, true);
    regeln(s, [
        { t: "1 Blau:", x: "Rechts von Blau ist frei." },
        { t: "2 Du:", x: "Blau kam von rechts – jetzt bist du dran." },
        { t: "3 Grün:", x: "Du kamst von rechts – Grün wartet auf dich." },
    ], { x: 0.6, y: 1.95, w: 5.2, dunkel: true, fs: 21, hoehe: 1.15 });
    s.addNotes("Die Kette erklären: Jeder schaut nur nach rechts. Wer rechts frei hat, beginnt. Danach rückt die Reihenfolge nach.");
    return s;
});

// ═════ Alle vier ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "02 · Grundregel", "Alle vier gleichzeitig?", "§ 11 Abs. 3 StVO");
    const k = kreuzung(s, { x: 6.7, y: 1.75, w: 6.03, h: 4.95, rw: 1.75 });
    auto(s, ankunft(k, "s", 0.75), C.orange, { du: true }); auto(s, ankunft(k, "n", 0.75), C.lila);
    auto(s, ankunft(k, "o", 0.85), C.blau); auto(s, ankunft(k, "w", 0.85), C.gruen);
    kreis(s, k.cx, k.cy, 0.8, C.orange, { line: { color: C.weiss, width: 2 } });
    text(s, "?", { x: k.cx - 0.4, y: k.cy - 0.4, w: 0.8, h: 0.8, fontSize: 32, bold: true, color: C.text, align: "center", valign: "middle" });
    regeln(s, [
        { t: "Patt:", x: "Jeder hat jemanden rechts – die Grundregel hilft nicht weiter." },
        { t: "Lösung:", x: "Verständigen. Einer verzichtet deutlich – mit Handzeichen und Blickkontakt." },
        { t: "Erst dann fahren,", x: "wenn der andere dich sicher verstanden hat." },
    ], { x: 0.6, y: 1.95, w: 5.7, fs: 19, hoehe: 1.4 });
    s.addNotes("§ 11 Abs. 3 StVO: Auf einen Verzicht darf man nur vertrauen, wenn man sich mit dem Verzichtenden verständigt hat. Rollenspiel: vier Freiwillige als Autos, einer verzichtet mit Handzeichen.");
    return s;
});

// ═════ Abschnitt 03 ═════
abschnitt("03", "Vorfahrt durch Zeichen", "Schilder gehen der Grundregel vor");

// ═════ Fünf Zeichen ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "03 · Zeichen", "Fünf Zeichen regeln die Vorfahrt", "Anlage 2 und 3 StVO");
    const z = [
        ["205", "Vorfahrt gewähren", "Warten, die Vorfahrt der anderen beachten.", (x, y) => B.z205(s, x, y, 1.45)],
        ["206", "Halt. Vorfahrt gewähren.", "Anhalten, dann Vorfahrt gewähren.", (x, y) => B.z206(s, x, y, 1.35)],
        ["301", "Vorfahrt", "Vorfahrt nur an der nächsten Kreuzung oder Einmündung.", (x, y) => B.z301(s, x, y, 1.45)],
        ["306", "Vorfahrtstraße", "Vorfahrt bis zum nächsten Zeichen 205, 206 oder 307.", (x, y) => B.raute(s, x, y, 1.45, false)],
        ["307", "Ende der Vorfahrtstraße", "Danach gelten wieder die allgemeinen Regeln.", (x, y) => B.raute(s, x, y, 1.45, true)],
    ];
    const bw = 2.3;
    z.forEach((e, i) => {
        const x = 0.6 + i * (bw + 0.16);
        karte(s, x, 1.8, bw, 4.25);
        e[3](x + bw / 2, 2.75);
        text(s, "Zeichen " + e[0], { x: x + 0.22, y: 3.75, w: bw - 0.44, h: 0.3, fontSize: 12, bold: true, color: C.orangeText });
        text(s, e[1], { x: x + 0.22, y: 4.07, w: bw - 0.44, h: 0.75, fontSize: 17, bold: true, color: C.text });
        text(s, e[2], { x: x + 0.22, y: 4.85, w: bw - 0.44, h: 1.15, fontSize: 14, color: C.grau });
    });
    text(s, "Außerorts darfst du auf der Fahrbahn einer Vorfahrtstraße nicht parken.", { x: 0.6, y: 6.3, w: 12.1, h: 0.45, fontSize: 18, bold: true, color: C.text });
    s.addNotes("Zeichen 205 und 206 stehen unmittelbar vor der Kreuzung oder Einmündung (Anlage 2 lfd. Nr. 2 und 3). Zeichen 301 gilt nur für die nächste Kreuzung, Zeichen 306 bis zum nächsten 205, 206 oder 307 (Anlage 3). Frage: Woran erkennt ihr Vorfahrt-gewähren auch von hinten oder bei Schnee? (Form: Spitze nach unten; Stopp: Achteck.)");
    return s;
});

// ═════ Stopp ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "03 · Zeichen", "Stopp heißt: Räder stehen still", "Zeichen 206 · Anlage 2 StVO");
    const k = kreuzung(s, { x: 0.6, y: 1.75, w: 6.03, h: 4.95, rw: 1.75, arme: { w: 1, o: 1, s: 1 }, cy: 3.25 });
    // Haltlinie über die eigene Spur
    rect(s, k.cx, k.cy + k.half + 0.08, k.half, 0.12, C.weiss);
    const du = auto(s, { x: k.cx + k.q, y: k.cy + k.half + 0.85, dir: "n" }, C.orange, { du: true });
    B.z206(s, k.cx + k.half + 0.65, k.cy + k.half + 0.65, 0.75);
    auto(s, ankunft(k, "w", 1.2), C.blau); auto(s, ankunft(k, "o", 1.4), C.gruen);
    text(s, "Haltlinie →", { x: k.cx - k.half - 1.75, y: k.cy + k.half + 0.0, w: 1.6, h: 0.3, fontSize: 13, bold: true, color: C.text, align: "right" });
    regeln(s, [
        { t: "Immer anhalten –", x: "auch wenn die Straße frei ist." },
        { t: "Mit Haltlinie:", x: "an der Haltlinie halten." },
        { t: "Ohne Haltlinie:", x: "dort halten, wo du die Straße einsehen kannst." },
        { t: "Danach:", x: "Vorfahrt gewähren, wenn nötig langsam vortasten." },
    ], { x: 7.05, y: 1.95, w: 5.7, fs: 19, hoehe: 1.05 });
    text(s, "In der Prüfung zählt nur der echte Halt – Rollen reicht nicht.", { x: 7.05, y: 6.25, w: 5.7, h: 0.45, fontSize: 16, bold: true, color: C.orangeText });
    s.addNotes("Anlage 2 lfd. Nr. 3 StVO: Wer ein Fahrzeug führt, muss anhalten und Vorfahrt gewähren. Ist keine Haltlinie (Zeichen 294) vorhanden, ist dort anzuhalten, wo die andere Straße zu übersehen ist. Häufiger Prüfungsfehler: rollendes Anhalten.");
    return s;
});

// ═════ Wartepflicht zeigen ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "03 · Zeichen", "So zeigst du, dass du wartest", "§ 8 Abs. 2 StVO");
    const schritte = [
        ["Erkennen", "Schild oder Einmündung früh sehen."],
        ["Tempo runter", "Mäßig fahren zeigt: Ich warte."],
        ["Schauen", "Rechts, links, rechts – Radweg nicht vergessen."],
        ["Vortasten", "Unübersichtlich? Langsam vor, bis du siehst."],
        ["Fahren", "Nur wenn niemand gefährdet oder wesentlich behindert wird."],
    ];
    const x0 = 1.75, dx = 2.45, y = 2.55;
    rect(s, x0, y - 0.02, dx * 4, 0.04, "C9D0D8");
    schritte.forEach((st, i) => {
        const cx = x0 + i * dx;
        nummer(s, cx, y, i + 1, { d: 0.72, fs: 24, farbe: i === 4 ? C.orange : C.nacht, textFarbe: i === 4 ? C.text : C.weiss, rand: C.weiss });
        text(s, st[0], { x: cx - 1.15, y: y + 0.6, w: 2.3, h: 0.45, fontSize: 20, bold: true, color: C.text, align: "center" });
        text(s, st[1], { x: cx - 1.12, y: y + 1.1, w: 2.24, h: 1.3, fontSize: 15, color: C.grau, align: "center" });
    });
    karte(s, 0.6, 5.35, 12.13, 1.2);
    kreis(s, 1.15, 5.95, 0.5, C.orange);
    text(s, "!", { x: 0.9, y: 5.7, w: 0.5, h: 0.5, fontSize: 22, bold: true, color: C.text, align: "center", valign: "middle" });
    text(s, "Auch wenn der Vorfahrtberechtigte abbiegt, darfst du ihn nicht wesentlich behindern.", { x: 1.65, y: 5.55, w: 10.8, h: 0.8, fontSize: 19, bold: true, color: C.text, valign: "middle" });
    s.addNotes("§ 8 Abs. 2 StVO: Wartepflichtige müssen rechtzeitig durch mäßige Geschwindigkeit zeigen, dass sie warten; weiterfahren nur, wenn der Vorfahrtberechtigte weder gefährdet noch wesentlich behindert wird; bei unübersichtlicher Stelle vorsichtig hineintasten. Anlage 1 FahrschAusbO: „Handeln in der richtigen Reihenfolge“ – Bremsen, Schalten, Beschleunigen.");
    return s;
});

// ═════ Reicht die Lücke? ═════
neu(() => {
    const s = folie("DUNKEL");
    frage(s, "Einschätzen", "Reicht die Lücke?");
    // Straße waagerecht, du wartest unten in der Einmündung, Auto kommt von links
    rund(s, 0.6, 1.8, 12.13, 2.6, C.panelDunkel, 0.2);
    rect(s, 0.6, 2.25, 12.13, 1.55, C.asphalt);
    s.addShape(pres.shapes.LINE, { x: 0.75, y: 3.025, w: 11.85, h: 0, line: { color: C.markierung, width: 1.75, dashType: "dash" } });
    rect(s, 9.3, 3.8, 1.55, 0.6, C.asphalt);
    auto(s, { x: 10.47, y: 4.05, dir: "n" }, C.orange, { du: true, L: 0.78, B: 0.46 });
    auto(s, { x: 1.4, y: 3.42, dir: "o" }, C.blau, { L: 0.9, B: 0.48 });
    pfad(s, [[2.0, 3.42], [9.2, 3.42]], { farbe: C.weiss, dash: "dash", breite: 2.5 });
    text(s, "≈ 47 m bei 50 km/h", { x: 3.2, y: 2.38, w: 5, h: 0.45, fontSize: 20, bold: true, color: C.orange, align: "center" });
    regeln(s, [
        { t: "Vom Stand über die Kreuzung", x: "brauchst du rund 3 bis 4 Sekunden." },
        { t: "Ein Auto mit 50 km/h", x: "fährt in dieser Zeit fast 50 Meter." },
        { t: "Ist es näher:", x: "warten. Lieber eine Lücke mehr als einen zum Bremsen zwingen." },
    ], { x: 0.6, y: 4.75, w: 12.1, dunkel: true, fs: 20, hoehe: 0.62 });
    text(s, "Beispielrechnung: 11,5 m Weg (7 m Fahrbahn + 4,5 m Auto), Anfahren mit 2 m/s² ≈ 3,4 s; 50 km/h ≈ 13,9 m/s × 3,4 s ≈ 47 m.", { x: 0.6, y: 6.6, w: 12.1, h: 0.3, fontSize: 11, color: "7E8893" });
    s.addNotes("Anlage 1 FahrschAusbO: Spurtstärke, Bedarf an Straßenraum und Zeit beim Überqueren einer Kreuzung einschätzen lernen. Mit der Gruppe die Rechnung nachvollziehen; Variante: Landstraße mit 100 km/h → rund 95 m.");
    return s;
});

// ═════ Abknickende Vorfahrt ═════
function knickBild(s, o) {
    // Vorfahrtstraße kommt von Westen und knickt nach Süden ab
    const k = kreuzung(s, { x: o.x, y: o.y, w: o.w, h: o.h, rw: 1.75, dunkel: o.dunkel });
    // Verlauf der Vorfahrtstraße als gelbe Randlinien (wie eine Markierung), Ecke innen abgerundet
    const g = { farbe: C.gelb, breite: 5, spitze: false };
    // vier Punkte = gerader Linienzug (drei Punkte wären eine Kurve)
    const ecke = (a, e, b) => [a, e, [e[0] + (b[0] - e[0]) * 0.001, e[1] + (b[1] - e[1]) * 0.001], b];
    pfad(s, ecke([k.x + 0.05, k.cy - k.half + 0.06], [k.cx + k.half - 0.06, k.cy - k.half + 0.06], [k.cx + k.half - 0.06, k.y + k.h - 0.05]), { ...g });
    pfad(s, ecke([k.x + 0.05, k.cy + k.half - 0.06], [k.cx - k.half + 0.06, k.cy + k.half - 0.06], [k.cx - k.half + 0.06, k.y + k.h - 0.05]), { ...g });
    return k;
}
neu(() => {
    const s = folie("HELL");
    kopf(s, "03 · Zeichen", "Abknickende Vorfahrt", "Anlage 3 lfd. Nr. 2.1 StVO");
    const k = knickBild(s, { x: 6.7, y: 1.75, w: 6.03, h: 4.95 });
    B.raute(s, k.x + 0.8, k.cy + k.half + 0.62, 0.8, false);
    B.zusatzAbknickend(s, k.x + 0.8, k.cy + k.half + 1.42, 0.72, { dick: ["w", "s"], duenn: ["n", "o"] });
    const gruen = auto(s, ankunft(k, "w", 1.6), C.gruen, { blinker: "r" });
    pfad(s, weg(k, gruen, "r", 0.6), { farbe: C.weiss });
    text(s, "Vorfahrtstraße", { x: k.x + 0.2, y: k.cy - k.half - 0.42, w: 2.5, h: 0.32, fontSize: 13, bold: true, color: C.text });
    regeln(s, [
        { t: "Verlauf:", x: "Das Zusatzzeichen zeigt, wohin die Vorfahrtstraße knickt (dicke Linie)." },
        { t: "Folgst du dem Knick:", x: "blinken." },
        { t: "Fußgänger", x: "besonders beachten, notfalls warten." },
        { t: "Die Wartepflichtigen", x: "untereinander: rechts vor links." },
    ], { x: 0.6, y: 1.95, w: 5.7, fs: 19, hoehe: 1.1 });
    s.addNotes("Anlage 3 lfd. Nr. 2.1 StVO: Wer dem abknickenden Verlauf folgen will, muss dies rechtzeitig und deutlich ankündigen (Fahrtrichtungsanzeiger); auf Fußgänger besonders Rücksicht nehmen, wenn nötig warten. Für die Fahrzeuge auf den untergeordneten Straßen gilt untereinander die Grundregel rechts vor links.");
    return s;
});
function knickFrage(s, aufloesung) {
    const k = knickBild(s, { x: 6.2, y: 1.75, w: 6.53, h: 4.95, dunkel: true });
    const gruen = auto(s, ankunft(k, "w", 1.0), C.gruen, { blinker: "r" });
    const du = auto(s, ankunft(k, "n", 0.75), C.orange, { du: true });
    const blau = auto(s, ankunft(k, "o", 0.95), C.blau);
    pfad(s, weg(k, gruen, "r", 0.5), { farbe: C.weiss });
    pfad(s, weg(k, du, "g", 0.5), { farbe: C.orange, dash: "dash" });
    pfad(s, weg(k, blau, "g", 0.5), { farbe: C.weiss });
    if (aufloesung) { nummer(s, gruen.x, gruen.y + 0.6, 1); nummer(s, du.x - 0.62, du.y - 0.1, 2); nummer(s, blau.x, blau.y - 0.6, 3); }
}
neu(() => {
    const s = folie("DUNKEL");
    frage(s, "Frage · Abknickende Vorfahrt", "Wer fährt zuerst?");
    knickFrage(s, false);
    regeln(s, [
        { t: "Gelbe Linien:", x: "Verlauf der Vorfahrtstraße (von links nach unten)." },
        { t: "Grün", x: "folgt dem Knick, du und Blau wollen geradeaus." },
        { t: "Ordne:", x: "Grün, Blau und du." },
    ], { x: 0.6, y: 1.95, w: 5.2, dunkel: true, fs: 21, hoehe: 1.2 });
    s.addNotes("Erst klären: Wer ist auf der Vorfahrtstraße? Dann die Wartepflichtigen untereinander mit rechts vor links ordnen.");
    return s;
});
neu(() => {
    const s = folie("DUNKEL");
    frage(s, "Auflösung", "Grün, dann du, dann Blau");
    knickFrage(s, true);
    regeln(s, [
        { t: "1 Grün", x: "fährt auf der Vorfahrtstraße – und blinkt, weil er dem Knick folgt." },
        { t: "2 Du:", x: "Unter den Wartepflichtigen kommst du für Blau von rechts." },
        { t: "3 Blau", x: "wartet auf Grün und auf dich." },
    ], { x: 0.6, y: 1.95, w: 5.2, dunkel: true, fs: 20, hoehe: 1.3 });
    s.addNotes("Häufiger Denkfehler: Blau fährt vor dir, weil er „gerade über die Hauptstraße“ will. Entscheidend ist aber: Beide sind wartepflichtig, untereinander gilt rechts vor links.");
    return s;
});

// ═════ Engstellen ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "03 · Zeichen", "Engstellen: Wer darf zuerst?", "Zeichen 208, 308 · § 6 StVO");
    karte(s, 0.6, 1.8, 5.95, 2.8); karte(s, 6.78, 1.8, 5.95, 2.8);
    B.z208(s, 1.75, 3.2, 1.6);
    text(s, "Vorrang des Gegenverkehrs", { x: 2.85, y: 2.25, w: 3.5, h: 0.75, fontSize: 19, bold: true, color: C.text });
    text(s, "Du wartest vor der Engstelle und lässt den Gegenverkehr durch.", { x: 2.85, y: 3.05, w: 3.5, h: 1.3, fontSize: 16, color: C.grau });
    B.z308(s, 7.93, 3.2, 1.5);
    text(s, "Vorrang vor dem Gegenverkehr", { x: 9.03, y: 2.25, w: 3.5, h: 0.75, fontSize: 19, bold: true, color: C.text });
    text(s, "Du darfst zuerst fahren – der Gegenverkehr wartet.", { x: 9.03, y: 3.05, w: 3.5, h: 1.3, fontSize: 16, color: C.grau });
    // Szene ohne Schild
    rund(s, 0.6, 4.85, 7.4, 1.75, C.panelHell, 0.16);
    rect(s, 0.6, 5.2, 7.4, 1.05, C.asphalt);
    s.addShape(pres.shapes.LINE, { x: 0.75, y: 5.725, w: 7.1, h: 0, line: { color: C.markierung, width: 1.5, dashType: "dash" } });
    rund(s, 3.6, 5.79, 1.5, 0.42, "6B7480", 0.08, { line: { color: C.weiss, width: 1 } });
    text(s, "Hindernis", { x: 3.6, y: 5.79, w: 1.5, h: 0.42, fontSize: 11, bold: true, color: C.weiss, align: "center", valign: "middle" });
    auto(s, { x: 2.3, y: 6.0, dir: "o" }, C.orange, { du: true, L: 0.8, B: 0.4 });
    auto(s, { x: 6.2, y: 5.46, dir: "w" }, C.blau, { L: 0.8, B: 0.4 });
    text(s, "Ohne Schild: Wer das Hindernis auf seiner Seite hat, lässt den Gegenverkehr durch.", { x: 8.3, y: 4.95, w: 4.43, h: 1.55, fontSize: 18, bold: true, color: C.text, valign: "middle" });
    s.addNotes("Zeichen 208 (Anlage 2 lfd. Nr. 4) und 308 (Anlage 3 lfd. Nr. 4). § 6 StVO: Wer an einer Fahrbahnverengung, einem Hindernis auf der Fahrbahn oder einem haltenden Fahrzeug links vorbeifahren will, muss entgegenkommende Fahrzeuge durchfahren lassen. Merkhilfe für 208/308: Der rote Pfeil zeigt, wer warten muss.");
    return s;
});

// ═════ Abschnitt 04 ═════
abschnitt("04", "Abbiegen und Gegenverkehr", "Wer abbiegt, lässt durch");

// ═════ Linksabbiegen ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "04 · Abbiegen", "Links abbiegen: Gegenverkehr zuerst", "§ 9 StVO");
    const k = kreuzung(s, { x: 6.7, y: 1.75, w: 6.03, h: 4.95, rw: 1.75 });
    const du = auto(s, { x: k.cx + 0.25, y: k.cy + k.half + 0.65, dir: "n" }, C.orange, { du: true, blinker: "l" });
    const gruen = auto(s, ankunft(k, "n", 0.75), C.gruen, { blinker: "r" });
    pfad(s, weg(k, gruen, "r", 0.55), { farbe: C.weiss });
    pfad(s, [[du.x, du.y - 0.55], [du.x - 0.1, k.cy + 0.1], [k.cx - k.half - 0.55, k.cy - k.q]], { farbe: C.orange, dash: "dash" });
    nummer(s, gruen.x + 0.62, gruen.y, 1); nummer(s, du.x + 0.62, du.y + 0.1, 2);
    regeln(s, [
        { t: "Vorher:", x: "ankündigen, einordnen, doppelte Rückschau." },
        { t: "Gegenverkehr zuerst –", x: "auch wenn er dir entgegenkommt und rechts abbiegt." },
        { t: "Durchlassen:", x: "Radfahrer, E-Scooter, Straßenbahn, Linienbusse auf Sonderfahrstreifen." },
        { t: "Fußgänger", x: "beim Abbiegen besonders beachten, notfalls warten." },
    ], { x: 0.6, y: 1.95, w: 5.7, fs: 19, hoehe: 1.12 });
    s.addNotes("§ 9 Abs. 1: rechtzeitig und deutlich ankündigen, einordnen, vor dem Einordnen und nochmals vor dem Abbiegen auf den nachfolgenden Verkehr achten. § 9 Abs. 3: entgegenkommende Fahrzeuge durchfahren lassen, auch Schienenfahrzeuge, Fahrräder, E-Scooter und Linienbusse auf Sonderfahrstreifen; auf Fußgänger besondere Rücksicht. § 9 Abs. 4: Wer links abbiegt, muss auch entgegenkommende Rechtsabbieger durchfahren lassen. Grün im Bild biegt rechts ab (Blinker), bleibt aber im Bild vor dir dran.");
    return s;
});

// ═════ Voreinander / hintereinander ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "04 · Zwei Linksabbieger", "Voreinander oder hintereinander?", "§ 9 Abs. 4 StVO");
    const teil = (x, art) => {
        const k = kreuzung(s, { x, y: 1.75, w: 5.95, h: 3.7, rw: 1.75 });
        const a = { x: k.cx + k.q, y: k.cy + k.half + 0.65, dir: "n" }, b = { x: k.cx - k.q, y: k.cy - k.half - 0.65, dir: "s" };
        auto(s, a, C.orange, { du: true, blinker: "l" }); auto(s, b, C.blau, { blinker: "l" });
        if (art === "vor") {
            pfad(s, [[a.x, a.y - 0.55], [k.cx + 0.12, k.cy + 0.22], [k.cx - k.half - 0.5, k.cy - k.q]], { farbe: C.orange });
            pfad(s, [[b.x, b.y + 0.55], [k.cx - 0.12, k.cy - 0.22], [k.cx + k.half + 0.5, k.cy + k.q]], { farbe: C.weiss });
        } else {
            pfad(s, [[a.x, a.y - 0.55], [a.x, k.cy - k.q], [k.cx - k.half - 0.5, k.cy - k.q]], { farbe: C.orange });
            pfad(s, [[b.x, b.y + 0.55], [b.x, k.cy + k.q], [k.cx + k.half + 0.5, k.cy + k.q]], { farbe: C.weiss });
        }
    };
    teil(0.6, "vor"); teil(6.78, "hinter");
    text(s, "Voreinander – der Normalfall", { x: 0.6, y: 5.6, w: 5.95, h: 0.4, fontSize: 19, bold: true, color: C.text });
    text(s, "Jeder biegt vor dem anderen ab, die Wege kreuzen sich nicht.", { x: 0.6, y: 6.0, w: 5.95, h: 0.7, fontSize: 16, color: C.grau });
    text(s, "Hintereinander – wenn es nötig ist", { x: 6.78, y: 5.6, w: 5.95, h: 0.4, fontSize: 19, bold: true, color: C.text });
    text(s, "Wenn Markierungen oder die Lage es verlangen: erst aneinander vorbei, dann abbiegen.", { x: 6.78, y: 6.0, w: 5.95, h: 0.7, fontSize: 16, color: C.grau });
    s.addNotes("§ 9 Abs. 4 Satz 2 StVO: Einander entgegenkommende Fahrzeuge, die jeweils nach links abbiegen wollen, müssen voreinander abbiegen, es sei denn, die Verkehrslage oder die Gestaltung der Kreuzung erfordern, erst dann abzubiegen, wenn die Fahrzeuge aneinander vorbeigefahren sind.");
    return s;
});

// ═════ Frage 4 ═════
function abbiegeFrage(s, aufloesung) {
    const k = kreuzung(s, { x: 6.2, y: 1.75, w: 6.53, h: 4.95, rw: 1.75, dunkel: true });
    const du = auto(s, { x: k.cx + 0.25, y: k.cy + k.half + 0.65, dir: "n" }, C.orange, { du: true, blinker: "l" });
    const blau = auto(s, ankunft(k, "n", 1.15), C.blau, { blinker: "r" });
    const rad = { x: k.cx - k.half + 0.12, y: k.cy - k.half - 0.32, dir: "s" };
    radfahrer(s, rad, C.gruen);
    pfad(s, [[du.x, du.y - 0.55], [du.x - 0.1, k.cy + 0.1], [k.cx - k.half - 0.55, k.cy - k.q]], { farbe: C.orange, dash: "dash" });
    pfad(s, weg(k, blau, "r", 0.5), { farbe: C.weiss });
    pfad(s, [[rad.x, rad.y + 0.38], [rad.x, k.cy + k.half + 0.6]], { farbe: C.gruen, breite: 2.5, spitze: 0.2 });
    if (aufloesung) { nummer(s, rad.x - 0.45, rad.y, 1); nummer(s, blau.x + 0.62, blau.y, 2); nummer(s, du.x + 0.62, du.y + 0.1, 3); }
}
neu(() => {
    const s = folie("DUNKEL");
    frage(s, "Frage · Abbiegen", "Wer fährt zuerst?");
    abbiegeFrage(s, false);
    regeln(s, [
        { t: "Du", x: "willst links abbiegen." },
        { t: "Blau", x: "kommt dir entgegen und biegt rechts ab." },
        { t: "Grün", x: "fährt mit dem Rad geradeaus." },
    ], { x: 0.6, y: 1.95, w: 5.2, dunkel: true, fs: 21, hoehe: 1.1 });
    s.addNotes("Reihenfolge aufschreiben lassen. Hinweis: Auch der Rechtsabbieger muss jemanden durchlassen.");
    return s;
});
neu(() => {
    const s = folie("DUNKEL");
    frage(s, "Auflösung", "Rad, dann Blau, dann du");
    abbiegeFrage(s, true);
    regeln(s, [
        { t: "1 Rad:", x: "fährt geradeaus – Blau muss es beim Abbiegen durchlassen." },
        { t: "2 Blau:", x: "Gegenverkehr, auch als Rechtsabbieger vor dir." },
        { t: "3 Du:", x: "Linksabbieger lassen den Gegenverkehr durch." },
    ], { x: 0.6, y: 1.95, w: 5.2, dunkel: true, fs: 20, hoehe: 1.25 });
    s.addNotes("§ 9 Abs. 3 StVO: Wer abbiegt, muss Fahrräder durchfahren lassen, auch wenn sie in derselben Richtung fahren. § 9 Abs. 4: Linksabbieger lassen entgegenkommende Rechtsabbieger durch.");
    return s;
});

// ═════ Abschnitt 05 ═════
abschnitt("05", "Ampel und Polizei", "Lichtzeichen und Handzeichen gehen den Schildern vor");

// ═════ Ampel ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "05 · Ampel", "Was die Ampel sagt", "§ 37 Abs. 2 StVO");
    const phasen = [
        [["gruen"], "Grün", "Fahren. Beim Abbiegen trotzdem Gegenverkehr, Rad- und Fußverkehr durchlassen."],
        [["gelb"], "Gelb", "Vor der Kreuzung auf das nächste Zeichen warten – anhalten, wenn das mit normaler Bremsung möglich ist."],
        [["rot"], "Rot", "Vor der Kreuzung halten."],
        [["rot", "gelb"], "Rot und Gelb", "Gleich wird es Grün – du stehst noch."],
    ];
    phasen.forEach((p, i) => {
        const y = 1.8 + i * 1.18;
        B.ampel(s, 0.75, y, 1.05, p[0]);
        text(s, p[1], { x: 1.45, y: y + 0.05, w: 2.0, h: 0.4, fontSize: 20, bold: true, color: C.text });
        text(s, p[2], { x: 1.45, y: y + 0.45, w: 6.4, h: 0.65, fontSize: 15, color: C.grau });
    });
    karte(s, 8.3, 1.8, 4.43, 2.2);
    text(s, "Ampel geht vor Schild", { x: 8.6, y: 2.05, w: 3.9, h: 0.45, fontSize: 19, bold: true, color: C.text });
    text(s, "Lichtzeichen gehen Vorfahrtsschildern und der Grundregel vor.", { x: 8.6, y: 2.55, w: 3.9, h: 1.3, fontSize: 16, color: C.grau });
    karte(s, 8.3, 4.2, 4.43, 2.3);
    text(s, "Ampel aus oder gelbes Blinklicht?", { x: 8.6, y: 4.45, w: 3.9, h: 0.75, fontSize: 19, bold: true, color: C.text });
    text(s, "Dann gelten die Schilder – gibt es keine: rechts vor links.", { x: 8.6, y: 5.2, w: 3.9, h: 1.2, fontSize: 16, color: C.grau });
    s.addNotes("§ 37 Abs. 2 Nr. 1 StVO: Farbfolge Grün – Gelb – Rot – Rot und Gelb – Grün. Grün: Verkehr freigegeben, abbiegen nach § 9. Gelb: vor der Kreuzung auf das nächste Zeichen warten. Rot: Halt vor der Kreuzung. Frage: Was macht ihr, wenn die Ampel gelb wird und ihr schon sehr nah dran seid?");
    return s;
});

// ═════ Grünpfeil ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "05 · Ampel", "Grünpfeil-Schild oder grüner Pfeil?", "§ 37 Abs. 2 StVO");
    karte(s, 0.6, 1.8, 5.95, 4.9); karte(s, 6.78, 1.8, 5.95, 4.9);
    B.ampel(s, 1.05, 2.15, 2.1, ["rot"]); B.gruenpfeilSchild(s, 2.35, 2.57, 0.7);
    text(s, "Grünpfeil-Schild", { x: 3.15, y: 2.2, w: 3.2, h: 0.45, fontSize: 20, bold: true, color: C.text });
    text(s, "Blechschild neben dem roten Licht", { x: 3.15, y: 2.65, w: 3.2, h: 0.65, fontSize: 14, color: C.grau });
    regeln(s, [
        { x: "Erst anhalten, dann bei Rot rechts abbiegen." },
        { x: "Nur vom rechten Fahrstreifen." },
        { x: "Niemanden behindern oder gefährden – besonders Fuß- und Radverkehr mit Grün." },
    ], { x: 0.95, y: 4.4, w: 5.4, fs: 16, hoehe: 0.72 });
    B.ampel(s, 7.25, 2.15, 2.1, ["gruen"], { pfeil: "l" });
    text(s, "Grüner Leuchtpfeil", { x: 8.35, y: 2.2, w: 4.2, h: 0.45, fontSize: 20, bold: true, color: C.text });
    text(s, "leuchtet in der Ampel", { x: 8.35, y: 2.65, w: 4.2, h: 0.65, fontSize: 14, color: C.grau });
    regeln(s, [
        { x: "Du fährst nur in Pfeilrichtung." },
        { x: "Grüner Linkspfeil hinter der Kreuzung: Der Gegenverkehr hat Rot – du biegst ungehindert ab." },
    ], { x: 7.13, y: 4.4, w: 5.4, fs: 16, hoehe: 0.95 });
    s.addNotes("§ 37 Abs. 2 Nr. 1 StVO: Grünpfeil-Schild rechts neben dem Rotlicht erlaubt nach dem Anhalten das Rechtsabbiegen bei Rot; nur aus dem rechten Fahrstreifen; Behinderung oder Gefährdung anderer, insbesondere des Fußgänger- und Fahrzeugverkehrs der freigegebenen Richtung, ausschließen. Grüner Pfeil im Lichtzeichen: nur in Pfeilrichtung; ein grüner Pfeil links hinter der Kreuzung zeigt, dass der Gegenverkehr Rot hat.");
    return s;
});

// ═════ Polizei ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "05 · Polizei", "Handzeichen der Polizei", "§ 36 Abs. 2 StVO");
    karte(s, 0.6, 1.8, 3.95, 4.9); karte(s, 4.78, 1.8, 3.95, 4.9);
    B.polizist(s, 2.575, 2.25, 2.1, "seitlich");
    text(s, "Arm seitlich ausgestreckt", { x: 0.9, y: 4.6, w: 3.4, h: 0.45, fontSize: 18, bold: true, color: C.text });
    text(s, "Siehst du Brust oder Rücken: Halt vor der Kreuzung. Der Querverkehr hat frei.", { x: 0.9, y: 5.05, w: 3.4, h: 1.5, fontSize: 15, color: C.grau });
    B.polizist(s, 6.755, 2.55, 2.0, "hoch");
    text(s, "Arm hoch", { x: 5.08, y: 4.6, w: 3.4, h: 0.45, fontSize: 18, bold: true, color: C.text });
    text(s, "Alle warten auf das nächste Zeichen. Wer schon in der Kreuzung ist, fährt sie frei.", { x: 5.08, y: 5.05, w: 3.4, h: 1.5, fontSize: 15, color: C.grau });
    // Draufsicht
    const k = kreuzung(s, { x: 8.96, y: 1.8, w: 3.77, h: 3.9, rw: 1.3 });
    kreis(s, k.cx, k.cy, 0.34, "2C5282", { line: { color: C.weiss, width: 1.5 } });
    rect(s, k.cx - 0.55, k.cy - 0.05, 1.1, 0.1, "2C5282");
    rect(s, k.cx + 0.05, k.cy + k.half + 0.15, k.q * 1.6, 0.1, C.rotStop);
    rect(s, k.cx - 0.05 - k.q * 1.6, k.cy - k.half - 0.25, k.q * 1.6, 0.1, C.rotStop);
    pfad(s, [[k.x + 0.25, k.cy + k.q], [k.cx - 0.45, k.cy + k.q]], { farbe: C.gruenOk, breite: 3, spitze: 0.2 });
    pfad(s, [[k.x + k.w - 0.25, k.cy - k.q], [k.cx + 0.45, k.cy - k.q]], { farbe: C.gruenOk, breite: 3, spitze: 0.2 });
    text(s, "Brust oder Rücken = Halt. Seite = Fahren.", { x: 8.96, y: 5.85, w: 3.77, h: 0.8, fontSize: 16, bold: true, color: C.text });
    s.addNotes("§ 36 Abs. 2 StVO: Seitliches Ausstrecken eines Arms oder beider Arme quer zur Fahrtrichtung bedeutet „Halt vor der Kreuzung“, der Querverkehr ist freigegeben. Hochheben eines Arms: „Vor der Kreuzung auf das nächste Zeichen warten“; wer in der Kreuzung ist, muss sie räumen. Die Zeichen gelten, solange sie gegeben werden oder die Grundstellung beibehalten wird.");
    return s;
});

// ═════ Abschnitt 06 ═════
abschnitt("06", "Besondere Lagen", "Kreisverkehr, Stau, Rettungsgasse – und Gelassenheit");

// ═════ Kreisverkehr ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "06 · Besondere Lagen", "Kreisverkehr", "§ 8 Abs. 1a, § 9 StVO · Zeichen 215");
    const x = 6.7, y = 1.75, w = 6.03, h = 4.95, cx = x + w / 2, cy = y + h / 2, rw = 1.5;
    rund(s, x, y, w, h, C.panelHell, 0.22);
    rect(s, cx - rw / 2, y, rw, h, C.asphalt); rect(s, x, cy - rw / 2, w, rw, C.asphalt);
    kreis(s, cx, cy, 3.6, C.asphalt);
    kreis(s, cx, cy, 1.6, "9FB8A0", { line: { color: C.weiss, width: 3 } });
    // Autos: im Kreis (Vorfahrt), einfahrend (wartet), ausfahrend (blinkt rechts)
    auto(s, { x: cx - 1.33, y: cy + 0.1, dir: "s" }, C.blau, { L: 0.8, B: 0.44 });
    auto(s, { x: cx + rw / 4, y: cy + 1.98, dir: "n" }, C.orange, { du: true, L: 0.8, B: 0.44 });
    auto(s, { x: cx + 1.15, y: cy - 0.95, dir: "n" }, C.gruen, { L: 0.8, B: 0.44, blinker: "r" });
    B.z215(s, x + w - 0.62, y + h - 1.28, 0.62); B.z205(s, x + w - 0.62, y + h - 0.5, 0.62);
    regeln(s, [
        { t: "Mit „Vorfahrt gewähren“:", x: "Wer im Kreis fährt, hat Vorfahrt." },
        { t: "Blinker:", x: "beim Einfahren nicht – beim Ausfahren rechts." },
        { t: "Im Kreis", x: "nicht halten, Mittelinsel nicht überfahren (Ausnahme: große Fahrzeuge, wenn es anders nicht geht)." },
        { t: "Ohne „Vorfahrt gewähren“", x: "gilt rechts vor links: Dann haben die Einfahrenden Vorfahrt." },
    ], { x: 0.6, y: 1.95, w: 5.7, fs: 18, hoehe: 1.18 });
    s.addNotes("§ 8 Abs. 1a StVO: Ist an der Einmündung in einen Kreisverkehr Zeichen 215 unter Zeichen 205 angeordnet, hat der Verkehr auf der Kreisfahrbahn Vorfahrt; beim Einfahren ist das Setzen des Fahrtrichtungsanzeigers unzulässig. Ausfahren ist Abbiegen (§ 9 Abs. 1): blinken. Anlage 2 lfd. Nr. 8: Fahrtrichtung rechts herum, Mittelinsel nicht überfahren (Ausnahme große Fahrzeuge ohne Gefährdung), auf der Kreisfahrbahn nicht halten.");
    return s;
});

// ═════ Stau und Rettungsgasse ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "06 · Besondere Lagen", "Stau: Kreuzung frei halten, Gasse bilden", "§ 11 Abs. 1 und 2 StVO");
    karte(s, 0.6, 1.8, 5.95, 4.9); karte(s, 6.78, 1.8, 5.95, 4.9);
    // links: Stau hinter der Kreuzung
    const k = kreuzung(s, { x: 0.95, y: 2.1, w: 5.25, h: 2.75, rw: 1.25, cx: 3.2, cy: 3.475 });
    [0, 1].forEach(i => auto(s, { x: k.cx + k.half + 0.5 + i * 0.95, y: k.cy + k.q, dir: "o" }, "8D97A3", { L: 0.78, B: 0.4 }));
    auto(s, { x: k.cx - k.half - 0.55, y: k.cy + k.q, dir: "o" }, C.orange, { du: true, L: 0.78, B: 0.4 });
    B.ampel(s, k.cx - k.half - 0.35, k.cy + k.half + 0.08, 0.62, ["gruen"]);
    text(s, "Stockt der Verkehr: nicht in die Kreuzung fahren, wenn du dort warten müsstest – auch bei Grün oder mit Vorfahrt.", { x: 0.95, y: 5.05, w: 5.25, h: 1.5, fontSize: 16, bold: true, color: C.text });
    // rechts: Rettungsgasse auf drei Fahrstreifen
    const gx = 7.3, gy = 2.1, gw = 4.9, gh = 2.75;
    rund(s, gx, gy, gw, gh, C.panelHell, 0.14);
    rect(s, gx + 0.5, gy, gw - 1.0, gh, C.asphalt);
    const sp = (gw - 1.0) / 3;
    [1, 2].forEach(i => s.addShape(pres.shapes.LINE, { x: gx + 0.5 + i * sp, y: gy + 0.1, w: 0, h: gh - 0.2, line: { color: C.markierung, width: 1.5, dashType: "dash" } }));
    // Autos: links nach links, Mitte und rechts nach rechts
    [[0, -0.33], [1, 0.3], [2, 0.3]].forEach(([spur, versatz]) => [0.75, 2.0].forEach(yy => auto(s, { x: gx + 0.5 + sp * spur + sp / 2 + versatz, y: gy + yy, dir: "n" }, spur === 0 ? C.blau : "8D97A3", { L: 0.78, B: 0.4 })));
    rect(s, gx + 0.5 + sp - 0.13, gy + 0.15, 0.26, gh - 0.3, C.orange, { fill: { color: C.orange, transparency: 35 } });
    pfad(s, [[gx + 0.5 + sp, gy + gh - 0.05], [gx + 0.5 + sp, gy + 0.25]], { farbe: "E5322D", breite: 3, spitze: 0.22 });
    text(s, "Rettungsgasse: zwischen dem ganz linken und dem Fahrstreifen rechts daneben – sobald es nur noch Schritttempo gibt oder steht.", { x: 7.13, y: 5.05, w: 5.25, h: 1.5, fontSize: 16, bold: true, color: C.text });
    s.addNotes("§ 11 Abs. 1 StVO: Bei stockendem Verkehr darf trotz Vorfahrt oder Grün nicht in die Kreuzung eingefahren werden, wenn auf ihr gewartet werden müsste. § 11 Abs. 2: Auf Autobahnen und Außerortsstraßen mit mindestens zwei Fahrstreifen je Richtung muss bei Schrittgeschwindigkeit oder Stillstand eine Gasse für Polizei- und Hilfsfahrzeuge zwischen dem äußerst linken und dem unmittelbar rechts daneben liegenden Fahrstreifen gebildet werden.");
    return s;
});

// ═════ Haltung ═════
neu(() => {
    const s = folie("DUNKEL");
    text(s, "HALTUNG", { x: 0.6, y: 0.42, w: 8, h: 0.3, fontSize: 12, bold: true, charSpacing: 2, color: C.orange });
    text(s, "Vorfahrt ist kein Freifahrtschein", { x: 0.6, y: 0.74, w: 9, h: 0.8, fontSize: 32, bold: true, color: C.weiss });
    const p = [
        ["Mitdenken", "Rechne mit Fehlern anderer – besonders bei Kindern, älteren Menschen und unsicheren Fahrern."],
        ["Verzichten", "Verlangt es die Lage, lass den anderen fahren – deutlich, mit Handzeichen und Blickkontakt."],
        ["Verständigen", "Verlass dich auf einen Verzicht erst, wenn ihr euch verständigt habt."],
    ];
    p.forEach((e, i) => {
        const x = 0.6 + i * 4.13;
        karte(s, x, 1.95, 3.85, 4.4, true);
        nummer(s, x + 0.75, 2.75, i + 1, { d: 0.8, fs: 26, rand: C.nacht2 });
        text(s, e[0], { x: x + 0.4, y: 3.45, w: 3.1, h: 0.55, fontSize: 24, bold: true, color: C.weiss });
        text(s, e[1], { x: x + 0.4, y: 4.05, w: 3.1, h: 2.1, fontSize: 17, color: "D5DAE0" });
    });
    s.addNotes("Anlage 1 FahrschAusbO: Gefährlichkeit einer Kreuzung beurteilen, Notwendigkeit der Verständigung, für die anderen mitdenken, Gelassenheit und Geduld, gegebenenfalls auf Vorfahrt verzichten. § 1 StVO (ständige Vorsicht, gegenseitige Rücksicht) und § 11 Abs. 3 StVO. Diskussion: Wann habt ihr schon einmal erlebt, dass jemand auf seine Vorfahrt bestanden hat?");
    return s;
});

// ═════ Umweltbewusst ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "06 · Besondere Lagen", "Spritsparend durch die Kreuzung", "Anlage 1 FahrschAusbO");
    // Tempo-Verlauf: hektisch vs. vorausschauend
    const x = 6.7, y = 1.8, w = 6.03, h = 3.6;
    karte(s, x, y, w, h);
    const ax = x + 0.6, ay = y + 0.4, aw = w - 1.0, ah = h - 1.2;
    s.addShape(pres.shapes.LINE, { x: ax, y: ay + ah, w: aw, h: 0, line: { color: "B7C0CA", width: 1.25 } });
    s.addShape(pres.shapes.LINE, { x: ax, y: ay, w: 0, h: ah, line: { color: "B7C0CA", width: 1.25 } });
    text(s, "Tempo", { x: x + 0.15, y: ay - 0.05, w: 0.9, h: 0.3, fontSize: 12, color: C.grau });
    text(s, "Weg bis zur roten Ampel →", { x: ax + aw - 3.0, y: ay + ah + 0.1, w: 3.0, h: 0.3, fontSize: 12, color: C.grau, align: "right" });
    const P = (fx, fy) => [ax + aw * fx, ay + ah * (1 - fy)];
    s.addShape(pres.shapes.CUSTOM_GEOMETRY, (() => { const pts = [P(0, 0.6), P(0.45, 0.9), P(0.8, 0.9), P(1, 0.02)]; const x0 = ax, y0 = ay; return { x: x0, y: y0, w: aw, h: ah, points: pts.map(q => ({ x: q[0] - x0, y: q[1] - y0 })), line: { color: "8D97A3", width: 3 } }; })());
    s.addShape(pres.shapes.CUSTOM_GEOMETRY, (() => { const a = P(0, 0.6), b = P(0.25, 0.62), c = P(1, 0.02); const x0 = ax, y0 = ay; return { x: x0, y: y0, w: aw, h: ah, points: [{ x: a[0] - x0, y: a[1] - y0 }, { x: b[0] - x0, y: b[1] - y0 }, { x: c[0] - x0, y: c[1] - y0, curve: { type: "quadratic", x1: P(0.75, 0.55)[0] - x0, y1: P(0.75, 0.55)[1] - y0 } }], line: { color: C.orange, width: 4 } }; })());
    legende(s, x + 0.35, y + h + 0.2, [{ farbe: "8D97A3", text: "Gas bis kurz vorher, dann hart bremsen" }, { farbe: C.orange, text: "Früh vom Gas, rollen lassen" }]);
    regeln(s, [
        { t: "Früh sehen:", x: "Rote Ampel oder Wartepflicht erkannt? Vom Gas, rollen lassen." },
        { t: "Im Schub", x: "verbraucht ein Verbrenner fast nichts, ein E-Auto gewinnt Energie zurück." },
        { t: "Zügig anfahren,", x: "früh hochschalten, nicht bis zur Haltlinie beschleunigen." },
        { t: "Längeres Warten:", x: "Start-Stopp arbeiten lassen bzw. Motor aus." },
    ], { x: 0.6, y: 1.95, w: 5.7, fs: 18, hoehe: 1.15 });
    s.addNotes("Anlage 1 FahrschAusbO: Umweltbewusstes Befahren von Kreuzungen und Einmündungen. § 30 Abs. 1 StVO: unnötiger Lärm und vermeidbare Abgasbelästigungen sind verboten, insbesondere unnötiges Laufenlassen von Motoren. Frage: Wo seht ihr auf eurem Schulweg früh, dass die Ampel rot wird?");
    return s;
});

// ═════ Das Wichtigste ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "Zusammenfassung", "Das Wichtigste in sechs Sätzen");
    const satz = [
        "Polizei vor Ampel vor Schild vor „rechts vor links“.",
        "Rechts vor links gilt überall, wo nichts anderes geregelt ist – auch an Einmündungen.",
        "Wer einfährt – aus Grundstück, Feldweg oder verkehrsberuhigtem Bereich –, wartet auf alle.",
        "Stopp heißt: Räder stehen still.",
        "Linksabbieger lassen den Gegenverkehr durch – auch Rechtsabbieger.",
        "Kreisverkehr mit „Vorfahrt gewähren“: Drinnen hat Vorfahrt, beim Ausfahren blinken.",
    ];
    const bw = 3.9, bh = 2.25;
    satz.forEach((t, i) => {
        const x = 0.6 + (i % 3) * (bw + 0.215), y = 1.8 + Math.floor(i / 3) * (bh + 0.3);
        karte(s, x, y, bw, bh);
        nummer(s, x + 0.55, y + 0.55, i + 1, { d: 0.6, fs: 20 });
        text(s, t, { x: x + 0.35, y: y + 1.0, w: bw - 0.7, h: bh - 1.15, fontSize: 17, bold: true, color: C.text });
    });
    s.addNotes("Die sechs Sätze reihum vorlesen lassen. Wer kann zu jedem Satz ein Beispiel aus der eigenen Umgebung nennen?");
    return s;
});

// ═════ Lernstandskontrolle ═════
const fragen = [
    ["Du fährst aus einer Tankstelle auf die Straße. Wer hat Vorfahrt?", "Alle auf der Straße – du wartest (§ 10 StVO)."],
    ["Was bedeutet das Zeichen „Vorfahrt“ (Zeichen 301)?", "Vorfahrt nur an der nächsten Kreuzung oder Einmündung."],
    ["Die Ampel ist aus, es gibt kein Schild. Was gilt?", "Rechts vor links."],
    ["Der Polizist zeigt dir die Brust, beide Arme seitlich. Was tust du?", "Halt vor der Kreuzung – der Querverkehr hat frei."],
    ["Kreisverkehr mit „Vorfahrt gewähren“: Blinkst du beim Einfahren?", "Nein. Nur beim Ausfahren rechts blinken."],
];
function quizListe(s, mitAntwort) {
    fragen.forEach((f, i) => {
        const y = 1.8 + i * 0.98;
        karte(s, 0.6, y, 12.13, 0.85, true);
        nummer(s, 1.08, y + 0.425, i + 1, { d: 0.5, fs: 17, rand: C.nacht2 });
        text(s, f[0], { x: 1.55, y: y + 0.1, w: mitAntwort ? 6.0 : 10.9, h: 0.65, fontSize: 17, color: C.weiss, valign: "middle" });
        if (mitAntwort) text(s, f[1], { x: 7.75, y: y + 0.1, w: 4.8, h: 0.65, fontSize: 16, bold: true, color: C.orange, valign: "middle" });
    });
}
neu(() => {
    const s = folie("DUNKEL");
    frage(s, "Lernstandskontrolle", "Teste dich – fünf schnelle Fragen");
    quizListe(s, false);
    s.addNotes("Zwei Minuten Zeit geben, Antworten aufschreiben lassen, dann auflösen.");
    return s;
});
neu(() => {
    const s = folie("DUNKEL");
    frage(s, "Lernstandskontrolle · Auflösung", "Die Antworten");
    quizListe(s, true);
    s.addNotes("Bei Fehlern kurz auf die passende Folie zurückspringen.");
    return s;
});

// ═════ Ausblick ═════
neu(() => {
    const s = folie("TITEL");
    text(s, "WIE ES WEITERGEHT", { x: 0.7, y: 1.4, w: 8, h: 0.35, fontSize: 14, bold: true, charSpacing: 3, color: C.orange });
    text(s, "In der Fahrstunde üben wir Kreuzungen und Einmündungen.", { x: 0.7, y: 1.85, w: 7.2, h: 2.0, fontSize: 40, bold: true, color: C.weiss });
    text(s, "Früh beobachten, Vorfahrt klar erkennen, sauber abbiegen.", { x: 0.7, y: 3.95, w: 7.2, h: 0.9, fontSize: 22, color: C.grauHell });
    karte(s, 0.7, 5.15, 7.2, 1.15, true);
    text(s, [{ text: "Nächste Theorie-Lektion: ", options: { color: C.grauHell } }, { text: "Verkehrszeichen und Bahnübergänge", options: { bold: true, color: C.weiss } }], { x: 1.0, y: 5.15, w: 6.7, h: 1.15, fontSize: 18, valign: "middle" });
    const k = kreuzung(s, { x: 8.6, y: 0.9, w: 4.1, h: 5.7, rw: 1.5, dunkel: true, arme: { n: 1, s: 1, w: 1 } });
    const du = auto(s, { x: k.cx + k.q, y: k.cy + k.half + 1.0, dir: "n" }, C.orange, { du: true, blinker: "l" });
    pfad(s, [[du.x, du.y - 0.55], [du.x, k.cy - k.q], [k.x + 0.35, k.cy - k.q]], { farbe: C.orange });
    text(s, [{ text: "Allindrive", options: { bold: true, color: C.weiss } }, { text: ".", options: { bold: true, color: C.orange } }], { x: 0.7, y: 6.6, w: 3, h: 0.4, fontSize: 15 });
    s.addNotes("Abschluss: Fragen sammeln. Hinweis auf die nächste Fahrstunde – im Navigator steht für diese Lektion das Ziel „Kreuzungen und Einmündungen“.");
    return s;
});

// ═════ Quellen ═════
neu(() => {
    const s = folie("HELL");
    kopf(s, "Anhang", "Rechtsgrundlagen und Quellen");
    const q = [
        "Straßenverkehrs-Ordnung (StVO): § 1, § 6, § 8, § 9, § 10, § 11, § 30, § 36, § 37; Anlage 2 lfd. Nr. 2, 3, 4, 8; Anlage 3 lfd. Nr. 1–4 – gesetze-im-internet.de",
        "Fahrschüler-Ausbildungsordnung (FahrschAusbO), Anlage 1, Thema 5 „Vorfahrt und Verkehrsregelungen“ – gesetze-im-internet.de",
        "TÜV | DEKRA arge tp 21: Innovationsbericht zur Fahrerlaubnisprüfung 2019–2022, Kap. 4.4 (Fehlerschwerpunkte der praktischen Prüfung)",
        "Alle Texte, Grafiken und Verkehrszeichen-Darstellungen: eigene Gestaltung Allindrive. Rechtsstand Oktober 2026 – bitte vor dem Einsatz auf Änderungen prüfen.",
    ];
    q.forEach((t, i) => {
        const y = 1.85 + i * 1.12;
        nummer(s, 0.88, y + 0.3, i + 1, { d: 0.46, fs: 15 });
        text(s, t, { x: 1.35, y, w: 11.3, h: 0.95, fontSize: 16, color: "343B44" });
    });
    s.addNotes("Quellenfolie – im Unterricht überspringen.");
    return s;
});

// ── Ausgabe ──
(async () => {
    const liste = nur ? [folien[Number(nur) - 1]] : folien;
    liste.forEach(fn => fn());
    const name = nur ? "einzel-" + nur + ".pptx" : "Lektion05.pptx";
    await pres.writeFile({ fileName: name });
    console.log(name, "·", liste.length, "Folien (gesamt", folien.length + ")");
})();
