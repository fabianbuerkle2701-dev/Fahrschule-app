// Gemeinsame Bausteine für die Allindrive-Theoriefolien: Farben, Folienrahmen, Kreuzungen, Autos,
// Pfeile, Verkehrszeichen, Ampel, Polizei. Alles als native PowerPoint-Formen (bearbeitbar).
const C = {
    nacht: "101318", nacht2: "1A1F26", nacht3: "262C35",
    weiss: "FFFFFF", text: "15181D", grau: "56606B", grauHell: "A3ACB7", linie: "DCE1E7", flaeche: "F1F3F6",
    orange: "FF9300", orangeText: "9E4F00", orangeHell: "FFE7C7",
    asphalt: "3B414A", markierung: "F2F4F6", panelHell: "E3E8ED", panelDunkel: "1C2129",
    blau: "3B82F6", gruen: "12A150", lila: "8B5CF6", rot: "D7261E", gelb: "FFCC00", schildBlau: "1F5FAE",
    schwarz: "17191C", ampel: "1E2228", aus: "3A3F46", ampelRot: "E5322D", ampelGelb: "F7B500", ampelGruen: "19B45A",
    gruenOk: "16A34A", rotStop: "DC2626",
};
const FONT = "Arial";
const W = 13.333, H = 7.5;
let P = null, R = null;
function init(pres) { P = pres; R = pres.shapes; }

// ── Rahmen ───────────────────────────────────────────────────────────────────────────────
function masters(pres, fusszeile) {
    const fuss = (farbe) => [{ text: { text: fusszeile, options: { x: 0.6, y: 7.02, w: 9, h: 0.3, fontFace: FONT, fontSize: 9, color: farbe, margin: 0 } } }];
    pres.defineSlideMaster({ title: "HELL", background: { color: C.weiss }, objects: fuss("8A939D"),
        slideNumber: { x: 12.13, y: 7.02, w: 0.6, h: 0.3, fontFace: FONT, fontSize: 9, color: "8A939D", align: "right" } });
    pres.defineSlideMaster({ title: "DUNKEL", background: { color: C.nacht }, objects: fuss("6E7782"),
        slideNumber: { x: 12.13, y: 7.02, w: 0.6, h: 0.3, fontFace: FONT, fontSize: 9, color: "6E7782", align: "right" } });
    pres.defineSlideMaster({ title: "TITEL", background: { color: C.nacht }, objects: [] });
}
function text(s, t, o) { s.addText(t, { fontFace: FONT, margin: 0, isTextBox: true, valign: "top", ...o }); }
// Kopf einer Inhaltsfolie: Kicker (Abschnitt) + Titel, rechts der Paragrafen-Chip
function kopf(s, kicker, titel, paragraf, dunkel) {
    text(s, kicker.toUpperCase(), { x: 0.6, y: 0.42, w: 8.5, h: 0.3, fontSize: 12, bold: true, charSpacing: 2, color: dunkel ? C.orange : C.orangeText });
    text(s, titel, { x: 0.6, y: 0.74, w: paragraf ? 9.0 : 12.1, h: 0.8, fontSize: 32, bold: true, color: dunkel ? C.weiss : C.text });
    if (paragraf) {
        const w = Math.max(1.6, paragraf.length * 0.095 + 0.5);
        s.addShape(R.ROUNDED_RECTANGLE, { x: W - 0.6 - w, y: 0.5, w, h: 0.42, fill: { color: dunkel ? C.nacht3 : C.flaeche }, line: { color: dunkel ? C.nacht3 : C.flaeche }, rectRadius: 0.21 });
        text(s, paragraf, { x: W - 0.6 - w, y: 0.5, w, h: 0.42, fontSize: 12, bold: true, color: dunkel ? C.grauHell : C.grau, align: "center", valign: "middle" });
    }
}
function folie(art) { return P.addSlide({ masterName: art }); }

// ── Formen ───────────────────────────────────────────────────────────────────────────────
function rect(s, x, y, w, h, farbe, o) { s.addShape(R.RECTANGLE, { x, y, w, h, fill: { color: farbe }, line: { color: farbe, width: 0 }, ...(o || {}) }); }
function rund(s, x, y, w, h, farbe, radius, o) { s.addShape(R.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: farbe }, line: { color: farbe, width: 0 }, rectRadius: radius == null ? 0.15 : radius, ...(o || {}) }); }
function kreis(s, cx, cy, d, farbe, o) { s.addShape(R.OVAL, { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: { color: farbe }, line: { color: farbe, width: 0 }, ...(o || {}) }); }
function karte(s, x, y, w, h, dunkel) {
    s.addShape(R.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: dunkel ? C.nacht2 : C.flaeche }, line: { color: dunkel ? C.nacht2 : C.flaeche, width: 0 }, rectRadius: 0.18 });
}
// Nummer im orangefarbenen Kreis
function nummer(s, cx, cy, n, o) {
    const d = (o && o.d) || 0.46;
    kreis(s, cx, cy, d, (o && o.farbe) || C.orange, { line: { color: (o && o.rand) || C.weiss, width: 1.5 } });
    text(s, String(n), { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fontSize: (o && o.fs) || 17, bold: true, color: (o && o.textFarbe) || C.text, align: "center", valign: "middle" });
}
// Linie/Pfad mit Pfeilspitze (2 Punkte gerade, 3 Punkte = quadratische Kurve)
function pfad(s, pts, o) {
    const farbe = (o && o.farbe) || C.weiss, breite = (o && o.breite) || 3.5, spitze = o && o.spitze === false ? 0 : ((o && o.spitze) || 0.26);
    const end = pts[pts.length - 1], vor = pts[pts.length - 2];
    const dx = end[0] - vor[0], dy = end[1] - vor[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const kurz = [end[0] - ux * spitze * 0.85, end[1] - uy * spitze * 0.85];
    const p = pts.slice(0, -1).concat([kurz]);
    const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(Math.max(...xs) - x0, 0.02), h = Math.max(Math.max(...ys) - y0, 0.02);
    const rel = q => ({ x: q[0] - x0, y: q[1] - y0 });
    const points = p.length === 3 ? [rel(p[0]), { ...rel(p[2]), curve: { type: "quadratic", x1: p[1][0] - x0, y1: p[1][1] - y0 } }] : p.map(rel);
    s.addShape(R.CUSTOM_GEOMETRY, { x: x0, y: y0, w, h, points, line: { color: farbe, width: breite, dashType: (o && o.dash) || "solid", cap: "round" } });
    if (spitze) {
        const a = Math.atan2(ux, -uy) * 180 / Math.PI;
        const cx = end[0] - ux * spitze / 2, cy = end[1] - uy * spitze / 2;
        s.addShape(R.ISOSCELES_TRIANGLE, { x: cx - spitze / 2, y: cy - spitze / 2, w: spitze, h: spitze, fill: { color: farbe }, line: { color: farbe, width: 0 }, rotate: (a + 360) % 360 });
    }
}
// Blockpfeil (für Zeichen 208/308 und den Grünpfeil): Schaft + Spitze, Richtung "n" | "s" | "o"
function blockPfeil(s, cx, cy, laenge, breite, richtung, farbe) {
    const kopfH = breite * 1.25, kopfW = breite * 2.3, schaft = laenge - kopfH * 0.9;
    if (richtung === "n") rect(s, cx - breite / 2, cy - laenge / 2 + kopfH * 0.9, breite, schaft, farbe);
    if (richtung === "s") rect(s, cx - breite / 2, cy - laenge / 2, breite, schaft, farbe);
    if (richtung === "o") rect(s, cx - laenge / 2, cy - breite / 2, schaft, breite, farbe);
    if (richtung === "w") rect(s, cx - laenge / 2 + kopfH * 0.9, cy - breite / 2, schaft, breite, farbe);
    const hc = { n: [cx, cy - laenge / 2 + kopfH / 2], s: [cx, cy + laenge / 2 - kopfH / 2], o: [cx + laenge / 2 - kopfH / 2, cy], w: [cx - laenge / 2 + kopfH / 2, cy] }[richtung];
    s.addShape(R.ISOSCELES_TRIANGLE, { x: hc[0] - kopfW / 2, y: hc[1] - kopfH / 2, w: kopfW, h: kopfH, fill: { color: farbe }, line: { color: farbe, width: 0 }, rotate: { n: 0, o: 90, s: 180, w: 270 }[richtung] });
}

// ── Kreuzung von oben ────────────────────────────────────────────────────────────────────
// o: {x,y,w,h, arme:{n,o,s,w}, rw (Straßenbreite), dunkel, panel:false}
function kreuzung(s, o) {
    const a = o.arme || { n: 1, o: 1, s: 1, w: 1 };
    const rw = o.rw || 1.7, half = rw / 2;
    if (o.panel !== false) rund(s, o.x, o.y, o.w, o.h, o.dunkel ? C.panelDunkel : C.panelHell, 0.22);
    const cx = o.cx != null ? o.cx : o.x + o.w / 2, cy = o.cy != null ? o.cy : o.y + o.h / 2;
    const inset = 0.0;
    const top = a.n ? o.y + inset : cy - half, bottom = a.s ? o.y + o.h - inset : cy + half;
    const left = a.w ? o.x + inset : cx - half, right = a.o ? o.x + o.w - inset : cx + half;
    rect(s, cx - half, top, rw, bottom - top, C.asphalt);
    rect(s, left, cy - half, right - left, rw, C.asphalt);
    const dash = { color: C.markierung, width: 1.75, dashType: "dash" };
    const rand = 0.12;
    if (a.n) s.addShape(R.LINE, { x: cx, y: o.y + rand, w: 0, h: cy - half - o.y - rand - 0.12, line: dash });
    if (a.s) s.addShape(R.LINE, { x: cx, y: cy + half + 0.12, w: 0, h: o.y + o.h - (cy + half) - rand - 0.12, line: dash });
    if (a.w) s.addShape(R.LINE, { x: o.x + rand, y: cy, w: cx - half - o.x - rand - 0.12, h: 0, line: dash });
    if (a.o) s.addShape(R.LINE, { x: cx + half + 0.12, y: cy, w: o.x + o.w - (cx + half) - rand - 0.12, h: 0, line: dash });
    return { cx, cy, half, rw, q: half / 2, x: o.x, y: o.y, w: o.w, h: o.h };
}
// Position eines Autos, das aus Arm "von" auf die Kreuzung zufährt (Rechtsverkehr), abstand = Abstand der Wagenmitte vom Kreuzungsrand
function ankunft(k, von, abstand) {
    const d = abstand == null ? 0.75 : abstand;
    if (von === "s") return { x: k.cx + k.q, y: k.cy + k.half + d, dir: "n" };
    if (von === "n") return { x: k.cx - k.q, y: k.cy - k.half - d, dir: "s" };
    if (von === "o") return { x: k.cx + k.half + d, y: k.cy - k.q, dir: "w" };
    return { x: k.cx - k.half - d, y: k.cy + k.q, dir: "o" };
}
// Auto von oben, Mitte (x,y), Fahrtrichtung dir
function auto(s, p, farbe, o) {
    const L = (o && o.L) || 0.98, B = (o && o.B) || 0.52;
    const quer = p.dir === "o" || p.dir === "w";
    const w = quer ? L : B, h = quer ? B : L, x = p.x - w / 2, y = p.y - h / 2;
    s.addShape(R.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: farbe }, line: { color: C.weiss, width: 1.25 }, rectRadius: 0.13 });
    const sw = 0.2, inset = 0.08; // Frontscheibe
    if (p.dir === "n") rund(s, x + inset, y + 0.2, w - 2 * inset, sw, "1B1F24", 0.06);
    if (p.dir === "s") rund(s, x + inset, y + h - 0.2 - sw, w - 2 * inset, sw, "1B1F24", 0.06);
    if (p.dir === "w") rund(s, x + 0.2, y + inset, sw, h - 2 * inset, "1B1F24", 0.06);
    if (p.dir === "o") rund(s, x + w - 0.2 - sw, y + inset, sw, h - 2 * inset, "1B1F24", 0.06);
    if (o && o.blinker) { // Blinker als kleine gelbe Punkte an der Seite
        const seite = o.blinker; const bd = 0.13;
        const pos = {
            n: { r: [[x + w, y + 0.12], [x + w, y + h - 0.12]], l: [[x, y + 0.12], [x, y + h - 0.12]] },
            s: { r: [[x, y + h - 0.12], [x, y + 0.12]], l: [[x + w, y + h - 0.12], [x + w, y + 0.12]] },
            o: { r: [[x + w - 0.12, y + h], [x + 0.12, y + h]], l: [[x + w - 0.12, y], [x + 0.12, y]] },
            w: { r: [[x + 0.12, y], [x + w - 0.12, y]], l: [[x + 0.12, y + h], [x + w - 0.12, y + h]] },
        }[p.dir][seite];
        pos.forEach(([bx, by]) => kreis(s, bx, by, bd, C.ampelGelb, { line: { color: C.weiss, width: 0.75 } }));
    }
    if (o && o.du) {
        const dx = p.dir === "o" ? -0.17 : p.dir === "w" ? 0.17 : 0, dy = p.dir === "n" ? 0.15 : p.dir === "s" ? -0.15 : 0;
        text(s, "DU", { x: p.x - 0.3 + dx, y: p.y - 0.13 + dy, w: 0.6, h: 0.26, fontSize: 10, bold: true, color: C.text, align: "center", valign: "middle" });
    }
    return p;
}
function radfahrer(s, p, farbe) {
    const quer = p.dir === "o" || p.dir === "w";
    const L = 0.62, B = 0.16;
    rund(s, p.x - (quer ? L : B) / 2, p.y - (quer ? B : L) / 2, quer ? L : B, quer ? B : L, C.schwarz, 0.06, { line: { color: C.weiss, width: 1 } });
    kreis(s, p.x, p.y, 0.3, farbe, { line: { color: C.weiss, width: 1.25 } });
}
// Fahrweg von einer Ankunftsposition: "g" geradeaus, "l" links, "r" rechts
function weg(k, p, art, nach) {
    const v = { n: [0, -1], s: [0, 1], o: [1, 0], w: [-1, 0] }[p.dir];
    const ende = nach || 0.9;
    const front = [p.x + v[0] * 0.55, p.y + v[1] * 0.55];
    if (art === "g") {
        // bis über die Kreuzung hinaus
        const dist = p.dir === "n" ? (front[1] - (k.cy - k.half - ende)) : p.dir === "s" ? ((k.cy + k.half + ende) - front[1]) : p.dir === "w" ? (front[0] - (k.cx - k.half - ende)) : ((k.cx + k.half + ende) - front[0]);
        return [front, [front[0] + v[0] * dist, front[1] + v[1] * dist]];
    }
    // Zielspur nach dem Abbiegen
    const ziel = {
        n: { l: [k.cx - k.half - ende, k.cy - k.q], r: [k.cx + k.half + ende, k.cy + k.q] },
        s: { l: [k.cx + k.half + ende, k.cy + k.q], r: [k.cx - k.half - ende, k.cy - k.q] },
        o: { l: [k.cx + k.q, k.cy - k.half - ende], r: [k.cx - k.q, k.cy + k.half + ende] },
        w: { l: [k.cx - k.q, k.cy + k.half + ende], r: [k.cx + k.q, k.cy - k.half - ende] },
    }[p.dir][art];
    // Kontrollpunkt: Schnitt der Fahrlinie mit der Ziellinie
    const ctrl = (p.dir === "n" || p.dir === "s") ? [front[0], ziel[1]] : [ziel[0], front[1]];
    return [front, ctrl, ziel];
}

// ── Verkehrszeichen ──────────────────────────────────────────────────────────────────────
function z205(s, cx, cy, d) { // Vorfahrt gewähren: Dreieck mit Spitze nach unten
    const h = d * 0.88;
    s.addShape(R.ISOSCELES_TRIANGLE, { x: cx - d / 2, y: cy - h / 2, w: d, h, fill: { color: C.weiss }, line: { color: C.rot, width: d * 8 }, rotate: 180 });
}
function z206(s, cx, cy, d) {
    s.addShape(R.OCTAGON, { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: { color: C.rot }, line: { color: C.weiss, width: Math.max(1.5, d * 2.6) } });
    text(s, "STOP", { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fontSize: Math.round(d * 17), bold: true, color: C.weiss, align: "center", valign: "middle" });
}
function z301(s, cx, cy, d) { // Vorfahrt (nächste Kreuzung)
    const h = d * 0.88, y0 = cy - h / 2;
    s.addShape(R.ISOSCELES_TRIANGLE, { x: cx - d / 2, y: y0, w: d, h, fill: { color: C.weiss }, line: { color: C.rot, width: d * 8 } });
    const my = y0 + h * 0.64, b = d * 0.09, l = d * 0.36;
    rect(s, cx - b / 2, my - l / 2 + d * 0.06, b, l - d * 0.06, C.schwarz);
    s.addShape(R.ISOSCELES_TRIANGLE, { x: cx - b / 2, y: my - l / 2 - d * 0.02, w: b, h: d * 0.09, fill: { color: C.schwarz }, line: { color: C.schwarz, width: 0 } });
    rect(s, cx - d * 0.17, my + d * 0.02, d * 0.34, d * 0.04, C.schwarz);
}
function raute(s, cx, cy, d, gestreift) { // Vorfahrtstraße (306) bzw. Ende (307)
    s.addShape(R.DIAMOND, { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: { color: "4A4A4A" }, line: { color: "4A4A4A", width: 0 } });
    const d2 = d * 0.93; s.addShape(R.DIAMOND, { x: cx - d2 / 2, y: cy - d2 / 2, w: d2, h: d2, fill: { color: C.weiss }, line: { color: C.weiss, width: 0 } });
    const d3 = d * 0.64; s.addShape(R.DIAMOND, { x: cx - d3 / 2, y: cy - d3 / 2, w: d3, h: d3, fill: { color: C.gelb }, line: { color: C.gelb, width: 0 } });
    if (gestreift) {
        const r = d2 / 2;
        [-0.36, -0.18, 0, 0.18, 0.36].forEach(f => {
            const t = f * r * 2;
            const x1 = cx + (t - r) / 2, y1 = cy + (t - r) / 2; // links oben als Box-Ecke, Linie von links unten nach rechts oben
            s.addShape(R.LINE, { x: x1, y: y1, w: r, h: r, flipV: true, line: { color: "2B2B2B", width: Math.max(1, d * 1.6) } });
        });
    }
}
function z208(s, cx, cy, d) {
    s.addShape(R.OVAL, { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: { color: C.weiss }, line: { color: C.rot, width: d * 9 } });
    blockPfeil(s, cx - d * 0.13, cy, d * 0.5, d * 0.07, "s", C.schwarz);
    blockPfeil(s, cx + d * 0.13, cy, d * 0.5, d * 0.07, "n", C.rot);
}
function z308(s, cx, cy, d) {
    rund(s, cx - d / 2, cy - d / 2, d, d, "4A4A4A", 0.06);
    rund(s, cx - d * 0.47, cy - d * 0.47, d * 0.94, d * 0.94, C.weiss, 0.05);
    rund(s, cx - d * 0.42, cy - d * 0.42, d * 0.84, d * 0.84, C.schildBlau, 0.04);
    blockPfeil(s, cx - d * 0.14, cy, d * 0.52, d * 0.07, "s", C.rot);
    blockPfeil(s, cx + d * 0.14, cy, d * 0.52, d * 0.07, "n", C.weiss);
}
function z215(s, cx, cy, d) { // Kreisverkehr: blaue Scheibe, drei weiße Pfeile gegen den Uhrzeigersinn
    kreis(s, cx, cy, d, C.schildBlau, { line: { color: C.weiss, width: Math.max(1, d * 2) } });
    const rm = d * 0.26;
    // weißer Ring, darauf drei Pfeilspitzen gegen den Uhrzeigersinn
    s.addShape(R.OVAL, { x: cx - rm, y: cy - rm, w: 2 * rm, h: 2 * rm, fill: { color: C.schildBlau }, line: { color: C.weiss, width: Math.max(2, d * 7) } });
    [30, 150, 270].forEach(a1 => {
        const th = a1 * Math.PI / 180, px = cx + rm * Math.cos(th), py = cy + rm * Math.sin(th);
        const ux = Math.sin(th), uy = -Math.cos(th); // gegen den Uhrzeigersinn (Bildschirmkoordinaten)
        const sp = d * 0.2, ang = Math.atan2(ux, -uy) * 180 / Math.PI;
        s.addShape(R.ISOSCELES_TRIANGLE, { x: px + ux * sp * 0.3 - sp / 2, y: py + uy * sp * 0.3 - sp / 2, w: sp, h: sp, fill: { color: C.weiss }, line: { color: C.weiss, width: 0 }, rotate: (ang + 360) % 360 });
    });
}
function gruenpfeilSchild(s, cx, cy, d) {
    rund(s, cx - d / 2, cy - d / 2, d, d, C.schwarz, 0.06, { line: { color: "4A4A4A", width: 1 } });
    blockPfeil(s, cx, cy, d * 0.62, d * 0.13, "o", C.ampelGruen);
}
// Zusatzzeichen abknickende Vorfahrt: dicke Linie = Verlauf der Vorfahrtstraße, dünn = andere Straßen.
// arme: z. B. { dick: ["s","w"], duenn: ["n","o"] }
function zusatzAbknickend(s, cx, cy, d, arme) {
    rect(s, cx - d / 2, cy - d * 0.4, d, d * 0.8, C.weiss, { line: { color: C.schwarz, width: 1.5 } });
    const r = d * 0.3, dick = d * 0.13, duenn = d * 0.03;
    const strich = (arm, b) => {
        if (arm === "n") rect(s, cx - b / 2, cy - r, b, r + b / 2, C.schwarz);
        if (arm === "s") rect(s, cx - b / 2, cy - b / 2, b, r + b / 2, C.schwarz);
        if (arm === "w") rect(s, cx - r, cy - b / 2, r + b / 2, b, C.schwarz);
        if (arm === "o") rect(s, cx - b / 2, cy - b / 2, r + b / 2, b, C.schwarz);
    };
    arme.duenn.forEach(a => strich(a, duenn));
    arme.dick.forEach(a => strich(a, dick));
}

// ── Ampel ────────────────────────────────────────────────────────────────────────────────
// an: Liste aus "rot", "gelb", "gruen"; pfeil: grüner Pfeil statt Kreis im unteren Licht ("l" | "r")
function ampel(s, x, y, h, an, o) {
    const w = h * 0.38;
    rund(s, x, y, w, h, C.ampel, 0.12, { line: { color: "3A3F46", width: 1 } });
    const d = w * 0.68, cx = x + w / 2;
    const farben = { rot: C.ampelRot, gelb: C.ampelGelb, gruen: C.ampelGruen };
    ["rot", "gelb", "gruen"].forEach((f, i) => {
        const cy = y + h * (0.2 + i * 0.3);
        const ein = an.indexOf(f) >= 0;
        if (f === "gruen" && o && o.pfeil) {
            kreis(s, cx, cy, d, C.aus);
            if (ein) blockPfeil(s, cx, cy, d * 0.7, d * 0.13, o.pfeil === "l" ? "w" : "o", C.ampelGruen);
            return;
        }
        kreis(s, cx, cy, d, ein ? farben[f] : C.aus);
    });
    return { w };
}

// ── Polizei (Piktogramm von vorn) ───────────────────────────────────────────────────────
function polizist(s, cx, y, groesse, haltung, dunkel) {
    const g = groesse, uni = "2C5282";
    kreis(s, cx, y + g * 0.12, g * 0.2, "E9C9A8", { line: { color: dunkel ? C.nacht : C.weiss, width: 1 } });
    rund(s, cx - g * 0.12, y + g * 0.0, g * 0.24, g * 0.07, uni, 0.02); // Mütze
    rund(s, cx - g * 0.15, y + g * 0.24, g * 0.3, g * 0.42, uni, 0.06);
    rund(s, cx - g * 0.13, y + g * 0.64, g * 0.11, g * 0.36, "22324D", 0.03);
    rund(s, cx + g * 0.02, y + g * 0.64, g * 0.11, g * 0.36, "22324D", 0.03);
    const arm = g * 0.08;
    if (haltung === "seitlich") {
        rund(s, cx - g * 0.52, y + g * 0.27, g * 0.38, arm, uni, 0.03);
        rund(s, cx + g * 0.14, y + g * 0.27, g * 0.38, arm, uni, 0.03);
    } else {
        rund(s, cx + g * 0.15, y - g * 0.2, arm, g * 0.5, uni, 0.03); // rechter Arm hoch
        rund(s, cx - g * 0.21, y + g * 0.26, arm, g * 0.36, uni, 0.03);
    }
}

module.exports = { C, FONT, W, H, init, masters, text, kopf, folie, rect, rund, kreis, karte, nummer, pfad, blockPfeil, kreuzung, ankunft, auto, radfahrer, weg,
    z205, z206, z301, raute, z208, z308, z215, gruenpfeilSchild, zusatzAbknickend, ampel, polizist };
