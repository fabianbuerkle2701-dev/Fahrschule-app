// Erzeugt tests/fixtures/bestand-beispiel.xlsx (fiktive Daten) für den Excel-Import-Test.
// Ohne Bibliothek: minimales ZIP mit deflate (zlib), gemeinsame Texte + Inline-Text + Datumszahl + Lücke.
"use strict";
const zlib = require("zlib"), fs = require("fs"), path = require("path");
const crcTab = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = crcTab[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const texte = ["Nachname", "Vorname", "Geb.-Datum", "Straße", "PLZ", "Ort", "Telefon", "Klasse", "Muster", "Mia", "Beispielweg 3", "Testhausen", "B", "Probe"];
const ss = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${texte.length}" uniqueCount="${texte.length}">` +
    texte.map(t => `<si><t>${t}</t></si>`).join("") + `</sst>`;
const s = i => `<c t="s"><v>${i}</v></c>`;
const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>5</v></c><c r="G1" t="s"><v>6</v></c><c r="H1" t="s"><v>7</v></c></row>
<row r="2"><c r="A2" t="s"><v>8</v></c><c r="B2" t="s"><v>9</v></c><c r="C2"><v>38718</v></c><c r="D2" t="s"><v>10</v></c><c r="E2"><v>12345</v></c><c r="F2" t="s"><v>11</v></c><c r="G2" t="inlineStr"><is><t>0151 0000000</t></is></c><c r="H2" t="s"><v>12</v></c></row>
<row r="3"><c r="A3" t="s"><v>13</v></c><c r="B3" t="inlineStr"><is><t>Paul</t></is></c><c r="H3" t="s"><v>12</v></c></row>
</sheetData></worksheet>`;
const dateien = [["[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`],
    ["xl/sharedStrings.xml", ss], ["xl/worksheets/sheet1.xml", sheet]];
const lokal = [], zentral = []; let off = 0;
for (const [name, inhalt] of dateien) {
    const roh = Buffer.from(inhalt, "utf8"), dat = zlib.deflateRawSync(roh), nb = Buffer.from(name, "utf8"), crc = crc32(roh);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(dat.length, 18); lh.writeUInt32LE(roh.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(dat.length, 20); ch.writeUInt32LE(roh.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    lokal.push(lh, nb, dat); zentral.push(ch, nb); off += 30 + nb.length + dat.length;
}
const cd = Buffer.concat(zentral), e = Buffer.alloc(22);
e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(dateien.length, 8); e.writeUInt16LE(dateien.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
fs.writeFileSync(path.join(__dirname, "fixtures", "bestand-beispiel.xlsx"), Buffer.concat([...lokal, cd, e]));
console.log("geschrieben");
