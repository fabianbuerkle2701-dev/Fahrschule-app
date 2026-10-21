// Server-Kopie von allindrive-autopilot/src/lib/girocode.js (nur der Export ist CommonJS) – für den Girocode auf
// Rechnungs-PDFs der Zeitjobs. Nicht hier ändern, sondern mit allindrive-autopilot/werkzeuge/server-kopien.mjs neu erzeugen.
// Girocode (EPC069-12) und QR-Encoder – wörtlich übernommen aus der Fahrlehrer-App (index.html, Abschnitt
// „EPC-Girocode QR-Encoder“), damit Rechnungen aus dem Autopilot denselben scanbaren Code tragen. Nicht hier
// verändern, sondern in der App – und dann neu übernehmen. Typen: girocode.d.ts.
/* eslint-disable */
/* ════════ EPC-Girocode QR-Encoder (reines Vanilla-JS, ISO/IEC 18004) ════════ */
// =============================================================================
// EPC-Girocode QR-Encoder — reines Vanilla-JavaScript, ISO/IEC 18004
// =============================================================================
// Zweck: Erzeugt scanbare QR-Codes (v.a. EPC069-12 "Girocodes" für SEPA-
// Überweisungen) direkt im Browser (WKWebView/Safari-tauglich), ohne
// Build-Schritt und ohne externe Abhängigkeiten.
//
// Aufbau der Datei (von unten nach oben gelesen entsteht der QR-Code):
//   1. Galois-Feld-Arithmetik (GF(256)) für Reed-Solomon
//   2. Reed-Solomon-Polynom-Klasse (Fehlerkorrektur-Codewörter)
//   3. QR-Hilfstabellen (Alignment-Pattern-Positionen, BCH-Konstanten,
//      Reed-Solomon-Blocktabelle nach ISO/IEC 18004 Anhang)
//   4. Bit-Buffer, Byte-Modus-Daten (UTF-8)
//   5. QRCodeModel: baut die Modul-Matrix (Finder, Timing, Alignment,
//      Format-/Versionsinfo, Daten+EC interleaved, Maskierung mit
//      Penalty-Bewertung nach Standard-Regeln N1-N4)
//   6. Öffentliche API: qrEncode(), qrDrawToCanvas(), qrToDataUrl()
//   7. EPC069-12-spezifische Hilfsfunktionen (Girocode-Textblock, IBAN-
//      Prüfziffer MOD97, Sanitizing des erlaubten Zeichensatzes)
//
// Warum eine eigene Implementierung statt einer Library? Die App läuft ohne
// Build-Schritt als eine einzige HTML-Datei in einer WKWebView. Ein <script>-
// Tag mit reinem Vanilla-JS ist damit die einzig praktikable Variante ohne
// npm/bundler. Die Algorithmus-Struktur folgt bewusst eng dem bekannten,
// gemeinfreien/MIT-lizenzierten qrcode-generator von Kazuhiko Arase, weil
// dessen Aufbau seit Jahren in unzähligen Produktionssystemen als korrekt
// verifiziert ist — Korrektheit hat hier Priorität vor Originalität.
// =============================================================================


// -----------------------------------------------------------------------------
// 1) Galois-Feld GF(256) — Arithmetik für Reed-Solomon-Fehlerkorrektur
// -----------------------------------------------------------------------------
// QR-Codes rechnen für die Fehlerkorrektur nicht mit normalen Zahlen, sondern
// im Galois-Feld GF(256) (Generatorpolynom x^8+x^4+x^3+x^2+1, das steckt
// implizit in der XOR-Rekursion unten). EXP/LOG-Tabellen machen Multiplikation
// im Feld auf normale Addition/Subtraktion der Exponenten reduzierbar.
const QR_EXP_TABLE = new Array(256);
const QR_LOG_TABLE = new Array(256);
for (let i = 0; i < 8; i++) {
  QR_EXP_TABLE[i] = 1 << i;
}
for (let i = 8; i < 256; i++) {
  QR_EXP_TABLE[i] =
    QR_EXP_TABLE[i - 4] ^
    QR_EXP_TABLE[i - 5] ^
    QR_EXP_TABLE[i - 6] ^
    QR_EXP_TABLE[i - 8];
}
for (let i = 0; i < 255; i++) {
  QR_LOG_TABLE[QR_EXP_TABLE[i]] = i;
}

function qrGlog(n) {
  if (n < 1) throw new Error("qrGlog(" + n + ")");
  return QR_LOG_TABLE[n];
}
function qrGexp(n) {
  while (n < 0) n += 255;
  while (n >= 256) n -= 255;
  return QR_EXP_TABLE[n];
}

// -----------------------------------------------------------------------------
// 2) Polynom-Arithmetik über GF(256) — für die Reed-Solomon-Codewörter
// -----------------------------------------------------------------------------
class QRPolynomial {
  constructor(num, shift) {
    let offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    this.num = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
    for (let i = 0; i < shift; i++) this.num[num.length - offset + i] = 0;
  }
  get(index) { return this.num[index]; }
  getLength() { return this.num.length; }
  multiply(e) {
    const num = new Array(this.getLength() + e.getLength() - 1).fill(0);
    for (let i = 0; i < this.getLength(); i++) {
      for (let j = 0; j < e.getLength(); j++) {
        num[i + j] ^= qrGexp(qrGlog(this.get(i)) + qrGlog(e.get(j)));
      }
    }
    return new QRPolynomial(num, 0);
  }
  mod(e) {
    if (this.getLength() - e.getLength() < 0) return this;
    const ratio = qrGlog(this.get(0)) - qrGlog(e.get(0));
    const num = new Array(this.getLength());
    for (let i = 0; i < this.getLength(); i++) num[i] = this.get(i);
    for (let i = 0; i < e.getLength(); i++) {
      num[i] ^= qrGexp(qrGlog(e.get(i)) + ratio);
    }
    // rekursiv weiter reduzieren, bis der Grad kleiner als der Divisor ist
    return new QRPolynomial(num, 0).mod(e);
  }
}

function qrGetErrorCorrectPolynomial(errorCorrectLength) {
  let a = new QRPolynomial([1], 0);
  for (let i = 0; i < errorCorrectLength; i++) {
    a = a.multiply(new QRPolynomial([1, qrGexp(i)], 0));
  }
  return a;
}

// -----------------------------------------------------------------------------
// 3) QR-Hilfstabellen und -Konstanten
// -----------------------------------------------------------------------------

// Fehlerkorrektur-Level: die konkreten Zahlenwerte sind gleichzeitig die
// 2-Bit-Kennung, die später direkt in die Format-Info des QR-Codes einfließt
// (siehe setupTypeInfo) — deshalb genau diese Werte, nicht 0/1/2/3 der Reihe nach.
const QR_ERROR_CORRECT_LEVEL = { L: 1, M: 0, Q: 3, H: 2 };

// Byte-Modus-Kennung (0100) laut ISO/IEC 18004 Tabelle 2. Wir implementieren
// bewusst NUR den Byte-Modus: EPC-Inhalte enthalten Kleinbuchstaben und
// Sonderzeichen, die im Alphanumeric-Modus nicht erlaubt wären, und Byte-Modus
// mit UTF-8 deckt jeden denkbaren Eingabetext (auch Umlaute vor Sanitizing) ab.
const QR_MODE_8BIT_BYTE = 4;

// Alignment-Pattern-Mittelpunkte je Version (Index 0 = Version 1 ... Index 39 = Version 40).
// Fixwerte aus ISO/IEC 18004 Anhang E.
const QR_PATTERN_POSITION_TABLE = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170],
];

// BCH-Generatorpolynome für Format-Info (G15) und Versions-Info (G18), sowie
// die feste XOR-Maske G15_MASK für die Format-Info — Fixwerte aus ISO/IEC 18004.
const QR_G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
const QR_G18 =
  (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
const QR_G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

function qrGetBCHDigit(data) {
  let digit = 0;
  while (data !== 0) {
    digit++;
    data >>>= 1;
  }
  return digit;
}
function qrGetBCHTypeInfo(data) {
  let d = data << 10;
  while (qrGetBCHDigit(d) - qrGetBCHDigit(QR_G15) >= 0) {
    d ^= QR_G15 << (qrGetBCHDigit(d) - qrGetBCHDigit(QR_G15));
  }
  return ((data << 10) | d) ^ QR_G15_MASK;
}
function qrGetBCHTypeNumber(data) {
  let d = data << 12;
  while (qrGetBCHDigit(d) - qrGetBCHDigit(QR_G18) >= 0) {
    d ^= QR_G18 << (qrGetBCHDigit(d) - qrGetBCHDigit(QR_G18));
  }
  return (data << 12) | d;
}

function qrGetPatternPosition(typeNumber) {
  return QR_PATTERN_POSITION_TABLE[typeNumber - 1];
}

// Die 8 Standard-Maskierungsmuster aus ISO/IEC 18004 Tabelle 10. Welches davon
// verwendet wird, entscheidet erst getBestMaskPattern() anhand der Penalty-Regeln.
function qrGetMaskFunction(maskPattern) {
  switch (maskPattern) {
    case 0: return (i, j) => (i + j) % 2 === 0;
    case 1: return (i, j) => i % 2 === 0;
    case 2: return (i, j) => j % 3 === 0;
    case 3: return (i, j) => (i + j) % 3 === 0;
    case 4: return (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5: return (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6: return (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    case 7: return (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
    default: throw new Error("bad maskPattern:" + maskPattern);
  }
}

// Länge des "Character Count Indicator" in Bits, abhängig von der Version.
// Nur für Byte-Modus (siehe QR_MODE_8BIT_BYTE oben): Version 1-9 -> 8 Bit,
// Version 10-40 -> 16 Bit (ISO/IEC 18004 Tabelle 3).
function qrGetLengthInBits(typeNumber) {
  return typeNumber <= 9 ? 8 : 16;
}

// Penalty-Bewertung einer fertigen Modul-Matrix nach den 4 Standardregeln
// N1 (gleichfarbige Läufe), N2 (2x2-Blöcke), N3 (finderähnliches Muster),
// N4 (Verhältnis dunkel/hell) — je niedriger die Summe, desto besser lesbar
// ist der Code für Scanner. Wird für alle 8 Masken berechnet, die beste gewinnt.
function qrGetLostPoint(qrcode) {
  const moduleCount = qrcode.getModuleCount();
  let lostPoint = 0;

  // N1: 5 oder mehr gleichfarbige Module in Folge (horizontal + vertikal),
  // hier zusammengefasst über die 8 Nachbarn jeder Zelle (aus dem Referenz-
  // Algorithmus übernommen — liefert dieselbe Bewertung wie getrennte
  // Zeilen-/Spalten-Läufe, da jede Lauf-Überlänge dieselbe Nachbarschafts-
  // Häufung erzeugt).
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      let sameCount = 0;
      const dark = qrcode.isDark(row, col);
      for (let r = -1; r <= 1; r++) {
        if (row + r < 0 || moduleCount <= row + r) continue;
        for (let c = -1; c <= 1; c++) {
          if (col + c < 0 || moduleCount <= col + c) continue;
          if (r === 0 && c === 0) continue;
          if (dark === qrcode.isDark(row + r, col + c)) sameCount++;
        }
      }
      if (sameCount > 5) lostPoint += 3 + sameCount - 5;
    }
  }

  // N2: 2x2-Blöcke einheitlicher Farbe
  for (let row = 0; row < moduleCount - 1; row++) {
    for (let col = 0; col < moduleCount - 1; col++) {
      let count = 0;
      if (qrcode.isDark(row, col)) count++;
      if (qrcode.isDark(row + 1, col)) count++;
      if (qrcode.isDark(row, col + 1)) count++;
      if (qrcode.isDark(row + 1, col + 1)) count++;
      if (count === 0 || count === 4) lostPoint += 3;
    }
  }

  // N3: Muster 1:1:3:1:1 (wie ein Finder-Pattern), das Scanner verwirren kann
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount - 6; col++) {
      if (
        qrcode.isDark(row, col) &&
        !qrcode.isDark(row, col + 1) &&
        qrcode.isDark(row, col + 2) &&
        qrcode.isDark(row, col + 3) &&
        qrcode.isDark(row, col + 4) &&
        !qrcode.isDark(row, col + 5) &&
        qrcode.isDark(row, col + 6)
      ) {
        lostPoint += 40;
      }
    }
  }
  for (let col = 0; col < moduleCount; col++) {
    for (let row = 0; row < moduleCount - 6; row++) {
      if (
        qrcode.isDark(row, col) &&
        !qrcode.isDark(row + 1, col) &&
        qrcode.isDark(row + 2, col) &&
        qrcode.isDark(row + 3, col) &&
        qrcode.isDark(row + 4, col) &&
        !qrcode.isDark(row + 5, col) &&
        qrcode.isDark(row + 6, col)
      ) {
        lostPoint += 40;
      }
    }
  }

  // N4: Abweichung des Dunkel-Anteils von 50 %
  let darkCount = 0;
  for (let col = 0; col < moduleCount; col++) {
    for (let row = 0; row < moduleCount; row++) {
      if (qrcode.isDark(row, col)) darkCount++;
    }
  }
  const ratio = Math.abs((100 * darkCount) / moduleCount / moduleCount - 50) / 5;
  lostPoint += ratio * 10;

  return lostPoint;
}

// -----------------------------------------------------------------------------
// Reed-Solomon-Blocktabelle (ISO/IEC 18004 Anhang, Tabellen für Version 1-40).
// Format pro Version: 4 Zeilen in der Reihenfolge L, M, Q, H.
// Jede Zeile ist ein flaches Array aus Tripeln [Blockanzahl, Gesamtcodewörter,
// Datencodewörter], mehrere Tripel bei Versionen mit >1 Blockgruppe.
// Wir brauchen zwar für EPC-Girocodes primär Level M, implementieren aber die
// vollständige Tabelle für eine allgemein korrekte, wiederverwendbare API.
// -----------------------------------------------------------------------------
const QR_RS_BLOCK_TABLE = [
  // 1
  [1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9],
  // 2
  [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16],
  // 3
  [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13],
  // 4
  [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9],
  // 5
  [1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12],
  // 6
  [2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15],
  // 7
  [2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14],
  // 8
  [2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15],
  // 9
  [2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13],
  // 10
  [2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16],
  // 11
  [4, 101, 81], [1, 80, 50, 4, 81, 51], [4, 50, 22, 4, 51, 23], [3, 36, 12, 8, 37, 13],
  // 12
  [2, 116, 92, 2, 117, 93], [6, 58, 36, 2, 59, 37], [4, 46, 20, 6, 47, 21], [7, 42, 14, 4, 43, 15],
  // 13
  [4, 133, 107], [8, 59, 37, 1, 60, 38], [8, 44, 20, 4, 45, 21], [12, 33, 11, 4, 34, 12],
  // 14
  [3, 145, 115, 1, 146, 116], [4, 64, 40, 5, 65, 41], [11, 36, 16, 5, 37, 17], [11, 36, 12, 5, 37, 13],
  // 15
  [5, 109, 87, 1, 110, 88], [5, 65, 41, 5, 66, 42], [5, 54, 24, 7, 55, 25], [11, 36, 12, 7, 37, 13],
  // 16
  [5, 122, 98, 1, 123, 99], [7, 73, 45, 3, 74, 46], [15, 43, 19, 2, 44, 20], [3, 45, 15, 13, 46, 16],
  // 17
  [1, 135, 107, 5, 136, 108], [10, 74, 46, 1, 75, 47], [1, 50, 22, 15, 51, 23], [2, 42, 14, 17, 43, 15],
  // 18
  [5, 150, 120, 1, 151, 121], [9, 69, 43, 4, 70, 44], [17, 50, 22, 1, 51, 23], [2, 42, 14, 19, 43, 15],
  // 19
  [3, 141, 113, 4, 142, 114], [3, 70, 44, 11, 71, 45], [17, 47, 21, 4, 48, 22], [9, 39, 13, 16, 40, 14],
  // 20
  [3, 135, 107, 5, 136, 108], [3, 67, 41, 13, 68, 42], [15, 54, 24, 5, 55, 25], [15, 43, 15, 10, 44, 16],
  // 21
  [4, 144, 116, 4, 145, 117], [17, 68, 42], [17, 50, 22, 6, 51, 23], [19, 46, 16, 6, 47, 17],
  // 22
  [2, 139, 111, 7, 140, 112], [17, 74, 46], [7, 54, 24, 16, 55, 25], [34, 37, 13],
  // 23
  [4, 151, 121, 5, 152, 122], [4, 75, 47, 14, 76, 48], [11, 54, 24, 14, 55, 25], [16, 45, 15, 14, 46, 16],
  // 24
  [6, 147, 117, 4, 148, 118], [6, 73, 45, 14, 74, 46], [11, 54, 24, 16, 55, 25], [30, 46, 16, 2, 47, 17],
  // 25
  [8, 132, 106, 4, 133, 107], [8, 75, 47, 13, 76, 48], [7, 54, 24, 22, 55, 25], [22, 45, 15, 13, 46, 16],
  // 26
  [10, 142, 114, 2, 143, 115], [19, 74, 46, 4, 75, 47], [28, 50, 22, 6, 51, 23], [33, 46, 16, 4, 47, 17],
  // 27
  [8, 152, 122, 4, 153, 123], [22, 73, 45, 3, 74, 46], [8, 53, 23, 26, 54, 24], [12, 45, 15, 28, 46, 16],
  // 28
  [3, 147, 117, 10, 148, 118], [3, 73, 45, 23, 74, 46], [4, 54, 24, 31, 55, 25], [11, 45, 15, 31, 46, 16],
  // 29
  [7, 146, 116, 7, 147, 117], [21, 73, 45, 7, 74, 46], [1, 53, 23, 37, 54, 24], [19, 45, 15, 26, 46, 16],
  // 30
  [5, 145, 115, 10, 146, 116], [19, 75, 47, 10, 76, 48], [15, 54, 24, 25, 55, 25], [23, 45, 15, 25, 46, 16],
  // 31
  [13, 145, 115, 3, 146, 116], [2, 74, 46, 29, 75, 47], [42, 54, 24, 1, 55, 25], [23, 45, 15, 28, 46, 16],
  // 32
  [17, 145, 115], [10, 74, 46, 23, 75, 47], [10, 54, 24, 35, 55, 25], [19, 45, 15, 35, 46, 16],
  // 33
  [17, 145, 115, 1, 146, 116], [14, 74, 46, 21, 75, 47], [29, 54, 24, 19, 55, 25], [11, 45, 15, 46, 46, 16],
  // 34
  [13, 145, 115, 6, 146, 116], [14, 74, 46, 23, 75, 47], [44, 54, 24, 7, 55, 25], [59, 46, 16, 1, 47, 17],
  // 35
  [12, 151, 121, 7, 152, 122], [12, 75, 47, 26, 76, 48], [39, 54, 24, 14, 55, 25], [22, 45, 15, 41, 46, 16],
  // 36
  [6, 151, 121, 14, 152, 122], [6, 75, 47, 34, 76, 48], [46, 54, 24, 10, 55, 25], [2, 45, 15, 64, 46, 16],
  // 37
  [17, 152, 122, 4, 153, 123], [29, 74, 46, 14, 75, 47], [49, 54, 24, 10, 55, 25], [24, 45, 15, 46, 46, 16],
  // 38
  [4, 152, 122, 18, 153, 123], [13, 74, 46, 32, 75, 47], [48, 54, 24, 14, 55, 25], [42, 45, 15, 32, 46, 16],
  // 39
  [20, 147, 117, 4, 148, 118], [40, 75, 47, 7, 76, 48], [43, 54, 24, 22, 55, 25], [10, 45, 15, 67, 46, 16],
  // 40
  [19, 148, 118, 6, 149, 119], [18, 75, 47, 31, 76, 48], [34, 54, 24, 34, 55, 25], [20, 45, 15, 61, 46, 16],
];

class QRRSBlockCount {
  constructor(totalCount, dataCount) {
    this.totalCount = totalCount;
    this.dataCount = dataCount;
  }
}
function qrGetRsBlockRow(typeNumber, errorCorrectLevel) {
  const base = (typeNumber - 1) * 4;
  switch (errorCorrectLevel) {
    case QR_ERROR_CORRECT_LEVEL.L: return QR_RS_BLOCK_TABLE[base + 0];
    case QR_ERROR_CORRECT_LEVEL.M: return QR_RS_BLOCK_TABLE[base + 1];
    case QR_ERROR_CORRECT_LEVEL.Q: return QR_RS_BLOCK_TABLE[base + 2];
    case QR_ERROR_CORRECT_LEVEL.H: return QR_RS_BLOCK_TABLE[base + 3];
    default: return undefined;
  }
}
function qrGetRSBlocks(typeNumber, errorCorrectLevel) {
  const row = qrGetRsBlockRow(typeNumber, errorCorrectLevel);
  if (row === undefined) {
    throw new Error("bad rs block @ typeNumber:" + typeNumber + "/errorCorrectLevel:" + errorCorrectLevel);
  }
  const groups = row.length / 3;
  const list = [];
  for (let i = 0; i < groups; i++) {
    const count = row[i * 3 + 0];
    const totalCount = row[i * 3 + 1];
    const dataCount = row[i * 3 + 2];
    for (let j = 0; j < count; j++) list.push(new QRRSBlockCount(totalCount, dataCount));
  }
  return list;
}

// -----------------------------------------------------------------------------
// 4) Bit-Buffer und Byte-Modus-Daten (UTF-8)
// -----------------------------------------------------------------------------
class QRBitBuffer {
  constructor() {
    this.buffer = [];
    this.length = 0;
  }
  get(index) {
    const bufIndex = Math.floor(index / 8);
    return ((this.buffer[bufIndex] >>> (7 - (index % 8))) & 1) === 1;
  }
  put(num, length) {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }
  getLengthInBits() {
    return this.length;
  }
  putBit(bit) {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) this.buffer.push(0);
    if (bit) this.buffer[bufIndex] |= 0x80 >>> this.length % 8;
    this.length++;
  }
}

// UTF-8-Kodierung des Eingabetextes in Bytes. TextEncoder ist in jedem
// modernen Browser/WKWebView und in Node vorhanden; der manuelle Fallback
// dient nur als Absicherung für sehr alte/exotische JS-Umgebungen.
function qrUtf8Bytes(str) {
  if (typeof TextEncoder !== "undefined") {
    return Array.from(new TextEncoder().encode(str));
  }
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.codePointAt(i);
    if (code > 0xffff) i++; // Low-Surrogate wurde bereits mitkonsumiert
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return bytes;
}

class QR8bitByte {
  constructor(data) {
    this.mode = QR_MODE_8BIT_BYTE;
    this.data = data;
    this.bytes = qrUtf8Bytes(data);
  }
  getLength() {
    return this.bytes.length;
  }
  write(buffer) {
    for (let i = 0; i < this.bytes.length; i++) buffer.put(this.bytes[i], 8);
  }
}

// Baut aus den Eingabedaten den vollständigen Codewort-Strom: Modus- und
// Längenindikator, Nutzdaten, Terminator, Auffüllen auf Byte-Grenze und
// Padding mit den beiden Standard-Füllbytes 0xEC/0x11 (ISO/IEC 18004 7.4.9).
function qrCreateData(typeNumber, errorCorrectLevel, dataList) {
  const rsBlocks = qrGetRSBlocks(typeNumber, errorCorrectLevel);
  const buffer = new QRBitBuffer();
  for (const data of dataList) {
    buffer.put(data.mode, 4);
    buffer.put(data.getLength(), qrGetLengthInBits(typeNumber));
    data.write(buffer);
  }
  let totalDataCount = 0;
  for (const block of rsBlocks) totalDataCount += block.dataCount;

  if (buffer.getLengthInBits() > totalDataCount * 8) {
    throw new Error(
      "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")"
    );
  }
  if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
  while (buffer.getLengthInBits() % 8 !== 0) buffer.putBit(false);
  while (true) {
    if (buffer.getLengthInBits() >= totalDataCount * 8) break;
    buffer.put(0xec, 8);
    if (buffer.getLengthInBits() >= totalDataCount * 8) break;
    buffer.put(0x11, 8);
  }
  return qrCreateBytes(buffer, rsBlocks);
}

// Interleaving von Datencodewörtern und Reed-Solomon-Fehlerkorrektur-
// Codewörtern über alle Blöcke hinweg, wie es der Standard für die
// Platzierung in der Matrix vorschreibt (ISO/IEC 18004 7.5/7.6).
function qrCreateBytes(buffer, rsBlocks) {
  let offset = 0;
  let maxDcCount = 0;
  let maxEcCount = 0;
  const dcdata = new Array(rsBlocks.length);
  const ecdata = new Array(rsBlocks.length);

  for (let r = 0; r < rsBlocks.length; r++) {
    const dcCount = rsBlocks[r].dataCount;
    const ecCount = rsBlocks[r].totalCount - dcCount;
    maxDcCount = Math.max(maxDcCount, dcCount);
    maxEcCount = Math.max(maxEcCount, ecCount);
    dcdata[r] = new Array(dcCount);
    for (let i = 0; i < dcdata[r].length; i++) {
      dcdata[r][i] = 0xff & buffer.buffer[i + offset];
    }
    offset += dcCount;
    const rsPoly = qrGetErrorCorrectPolynomial(ecCount);
    const rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);
    const modPoly = rawPoly.mod(rsPoly);
    ecdata[r] = new Array(rsPoly.getLength() - 1);
    for (let i = 0; i < ecdata[r].length; i++) {
      const modIndex = i + modPoly.getLength() - ecdata[r].length;
      ecdata[r][i] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
    }
  }

  let totalCodeCount = 0;
  for (const block of rsBlocks) totalCodeCount += block.totalCount;
  const data = new Array(totalCodeCount);
  let index = 0;
  for (let i = 0; i < maxDcCount; i++) {
    for (let r = 0; r < rsBlocks.length; r++) {
      if (i < dcdata[r].length) data[index++] = dcdata[r][i];
    }
  }
  for (let i = 0; i < maxEcCount; i++) {
    for (let r = 0; r < rsBlocks.length; r++) {
      if (i < ecdata[r].length) data[index++] = ecdata[r][i];
    }
  }
  return data;
}

// -----------------------------------------------------------------------------
// 5) QRCodeModel — baut die vollständige Modul-Matrix einer Version/Level-
//    Kombination inklusive bester Maskierung.
// -----------------------------------------------------------------------------
class QRCodeModel {
  constructor(typeNumber, errorCorrectLevel) {
    this.typeNumber = typeNumber;
    this.errorCorrectLevel = errorCorrectLevel;
    this.modules = null;
    this.moduleCount = 0;
    this.dataList = [];
  }

  addData(text) {
    this.dataList.push(new QR8bitByte(text));
  }

  isDark(row, col) {
    if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
      throw new Error(row + "," + col);
    }
    return this.modules[row][col];
  }

  getModuleCount() {
    return this.moduleCount;
  }

  make() {
    this.makeImpl(false, this.getBestMaskPattern());
  }

  makeImpl(test, maskPattern) {
    this.moduleCount = this.typeNumber * 4 + 17;
    this.modules = new Array(this.moduleCount);
    for (let row = 0; row < this.moduleCount; row++) {
      this.modules[row] = new Array(this.moduleCount).fill(null);
    }
    this.setupPositionProbePattern(0, 0);
    this.setupPositionProbePattern(this.moduleCount - 7, 0);
    this.setupPositionProbePattern(0, this.moduleCount - 7);
    this.setupPositionAdjustPattern();
    this.setupTimingPattern();
    this.setupTypeInfo(test, maskPattern);
    if (this.typeNumber >= 7) this.setupTypeNumber(test);

    const data = qrCreateData(this.typeNumber, this.errorCorrectLevel, this.dataList);
    this.mapData(data, maskPattern);
  }

  setupPositionProbePattern(row, col) {
    for (let r = -1; r <= 7; r++) {
      if (row + r <= -1 || this.moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c++) {
        if (col + c <= -1 || this.moduleCount <= col + c) continue;
        if (
          (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
          (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
          (2 <= r && r <= 4 && 2 <= c && c <= 4)
        ) {
          this.modules[row + r][col + c] = true;
        } else {
          this.modules[row + r][col + c] = false;
        }
      }
    }
  }

  setupTimingPattern() {
    for (let r = 8; r < this.moduleCount - 8; r++) {
      if (this.modules[r][6] !== null) continue;
      this.modules[r][6] = r % 2 === 0;
    }
    for (let c = 8; c < this.moduleCount - 8; c++) {
      if (this.modules[6][c] !== null) continue;
      this.modules[6][c] = c % 2 === 0;
    }
  }

  setupPositionAdjustPattern() {
    const pos = qrGetPatternPosition(this.typeNumber);
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        const row = pos[i];
        const col = pos[j];
        if (this.modules[row][col] !== null) continue; // überschneidet Finder-Pattern -> überspringen
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            if (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0)) {
              this.modules[row + r][col + c] = true;
            } else {
              this.modules[row + r][col + c] = false;
            }
          }
        }
      }
    }
  }

  setupTypeNumber(test) {
    const bits = qrGetBCHTypeNumber(this.typeNumber);
    for (let i = 0; i < 18; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      this.modules[Math.floor(i / 3)][(i % 3) + this.moduleCount - 8 - 3] = mod;
    }
    for (let i = 0; i < 18; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      this.modules[(i % 3) + this.moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  }

  setupTypeInfo(test, maskPattern) {
    const data = (this.errorCorrectLevel << 3) | maskPattern;
    const bits = qrGetBCHTypeInfo(data);

    for (let i = 0; i < 15; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      if (i < 6) {
        this.modules[i][8] = mod;
      } else if (i < 8) {
        this.modules[i + 1][8] = mod;
      } else {
        this.modules[this.moduleCount - 15 + i][8] = mod;
      }
    }
    for (let i = 0; i < 15; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      if (i < 8) {
        this.modules[8][this.moduleCount - i - 1] = mod;
      } else if (i < 9) {
        this.modules[8][15 - i - 1 + 1] = mod;
      } else {
        this.modules[8][15 - i - 1] = mod;
      }
    }
    // fest dunkles Modul, immer schwarz (dient Scannern als Ausrichtungshilfe)
    this.modules[this.moduleCount - 8][8] = !test;
  }

  mapData(data, maskPattern) {
    let inc = -1;
    let row = this.moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;
    const maskFunc = qrGetMaskFunction(maskPattern);

    for (let col = this.moduleCount - 1; col > 0; col -= 2) {
      if (col === 6) col--; // Timing-Spalte überspringen
      while (true) {
        for (let c = 0; c < 2; c++) {
          if (this.modules[row][col - c] === null) {
            let dark = false;
            if (byteIndex < data.length) {
              dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
            }
            const mask = maskFunc(row, col - c);
            if (mask) dark = !dark;
            this.modules[row][col - c] = dark;
            bitIndex--;
            if (bitIndex === -1) {
              byteIndex++;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || this.moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  }

  getBestMaskPattern() {
    let minLostPoint = 0;
    let pattern = 0;
    for (let i = 0; i < 8; i++) {
      this.makeImpl(true, i);
      const lostPoint = qrGetLostPoint(this);
      if (i === 0 || minLostPoint > lostPoint) {
        minLostPoint = lostPoint;
        pattern = i;
      }
    }
    return pattern;
  }
}

// -----------------------------------------------------------------------------
// 6) Öffentliche API
// -----------------------------------------------------------------------------

/**
 * Erzeugt einen QR-Code aus einem beliebigen Text.
 * @param {string} text - der zu kodierende Inhalt (wird als UTF-8 im Byte-Modus kodiert)
 * @param {object} [opts]
 * @param {"L"|"M"|"Q"|"H"} [opts.errorCorrectionLevel="M"] - Fehlerkorrektur-Level
 * @param {number} [opts.minVersion=1] - kleinste zu versuchende QR-Version (1-40)
 * @returns {{moduleCount:number, version:number, errorCorrectionLevel:string, isDark:(row:number,col:number)=>boolean}}
 */
function qrEncode(text, opts) {
  opts = opts || {};
  if (typeof text !== "string") text = String(text);
  const ecLevelName = opts.errorCorrectionLevel || "M";
  const ecLevel = QR_ERROR_CORRECT_LEVEL[ecLevelName];
  if (ecLevel === undefined) {
    throw new Error('Ungültiges Error-Correction-Level: "' + ecLevelName + '" (erlaubt: L, M, Q, H)');
  }
  const minVersion = opts.minVersion || 1;

  // Automatische Versionswahl: kleinste Version durchprobieren, die den Text
  // noch fasst. qrCreateData wirft "code length overflow", wenn die Version
  // zu klein ist — das nutzen wir als Abbruchkriterium pro Versuch.
  let qr = null;
  let lastErr = null;
  for (let typeNumber = minVersion; typeNumber <= 40; typeNumber++) {
    try {
      const candidate = new QRCodeModel(typeNumber, ecLevel);
      candidate.addData(text);
      candidate.make();
      qr = candidate;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!qr) {
    throw new Error(
      "Text zu lang für QR-Code (selbst Version 40, Level " +
        ecLevelName +
        " reicht nicht): " +
        (lastErr ? lastErr.message : "unbekannter Fehler")
    );
  }

  return {
    moduleCount: qr.getModuleCount(),
    version: qr.typeNumber,
    errorCorrectionLevel: ecLevelName,
    isDark(row, col) {
      return qr.isDark(row, col);
    },
  };
}

/**
 * Zeichnet einen QR-Code auf ein <canvas>-Element (Browser-API, benötigt `document`).
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.size=256] - Kantenlänge des Canvas in Pixeln
 * @param {number} [opts.margin=4] - Breite der weißen Quiet-Zone in Modulen (ISO-Empfehlung: mind. 4)
 * @param {string} [opts.dark="#000000"] - Farbe der dunklen Module
 * @param {string} [opts.light="#ffffff"] - Farbe des Hintergrunds/der Quiet-Zone
 * @param {"L"|"M"|"Q"|"H"} [opts.errorCorrectionLevel="M"]
 * @param {HTMLCanvasElement} [opts.canvas] - vorhandenes Canvas wiederverwenden statt ein neues zu erzeugen
 * @returns {HTMLCanvasElement}
 */
function qrDrawToCanvas(text, opts) {
  opts = opts || {};
  const size = opts.size || 256;
  const margin = opts.margin !== undefined ? opts.margin : 4;
  const darkColor = opts.dark || "#000000";
  const lightColor = opts.light || "#ffffff";

  const qr = qrEncode(text, { errorCorrectionLevel: opts.errorCorrectionLevel, minVersion: opts.minVersion });
  const moduleCount = qr.moduleCount;
  const totalModules = moduleCount + margin * 2;
  const moduleSize = size / totalModules;

  const canvas = opts.canvas || document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = lightColor;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = darkColor;
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col)) {
        const x = (col + margin) * moduleSize;
        const y = (row + margin) * moduleSize;
        // +/-0.5px-Überlappung vermeidet Sub-Pixel-Lücken zwischen Modulen
        // (in manchen Browsern sichtbar als feine helle Gitterlinien).
        ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(moduleSize) + 1, Math.ceil(moduleSize) + 1);
      }
    }
  }
  return canvas;
}

/**
 * Bequemlichkeitsfunktion: rendert direkt zu einer PNG-Data-URL.
 * @param {string} text
 * @param {object} [opts] - siehe qrDrawToCanvas
 * @returns {string} "data:image/png;base64,..."
 */
function qrToDataUrl(text, opts) {
  const canvas = qrDrawToCanvas(text, opts);
  return canvas.toDataURL("image/png");
}

// =============================================================================
// 7) EPC069-12 "Girocode" — SEPA-Überweisungs-QR-Code-Textblock
// =============================================================================

// Erlaubter Zeichensatz laut EPC069-12: lateinische Buchstaben, Ziffern,
// Leerzeichen und die Sonderzeichen / - ? : ( ) . , ' +
const QR_EPC_ALLOWED_CHARS_REGEX = /[^A-Za-z0-9 /\-?:().,'+]/g;

/**
 * Ersetzt deutsche Umlaute/ß durch ihre Transliteration und entfernt/ersetzt
 * danach alle laut EPC069-12 nicht erlaubten Zeichen durch ein Leerzeichen.
 * Muss auf JEDES Freitextfeld (Name, Verwendungszweck) angewendet werden,
 * BEVOR es in den QR-Inhalt eingesetzt wird — sonst lehnen manche Banking-
 * Apps den Code als "nicht lesbar" ab, auch wenn der QR-Code technisch
 * korrekt dekodierbar wäre.
 * @param {string} input
 * @param {number} [maxLength] - optionale harte Längenbegrenzung NACH dem Sanitizing
 * @returns {string}
 */
function sanitizeEpcText(input, maxLength) {
  if (input === undefined || input === null) return "";
  let s = String(input);
  const umlautMap = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" };
  s = s.replace(/[äöüÄÖÜß]/g, (ch) => umlautMap[ch]);
  s = s.replace(QR_EPC_ALLOWED_CHARS_REGEX, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (typeof maxLength === "number" && maxLength > 0 && s.length > maxLength) {
    s = s.slice(0, maxLength).trim();
  }
  return s;
}

// IBAN-Prüfziffernprüfung nach ISO 7064 (MOD 97-10), wie im EPC-Umfeld
// üblich. Streaming-Modulo (Ziffer für Ziffer), damit auch bei bis zu ~34
// Zeichen langen IBANs keine BigInt-Arithmetik nötig ist.
function qrIbanMod97(rearrangedNumeric) {
  let remainder = 0;
  for (let i = 0; i < rearrangedNumeric.length; i++) {
    remainder = (remainder * 10 + Number(rearrangedNumeric[i])) % 97;
  }
  return remainder;
}

/**
 * Validiert eine IBAN per MOD-97-Prüfziffer (ISO 7064). Erkennt sowohl
 * Formatfehler (falsche Länge/Struktur) als auch Tippfehler in der IBAN.
 * @param {string} ibanRaw
 * @returns {{valid:boolean, iban:string, reason?:string}}
 */
function validateIban(ibanRaw) {
  if (!ibanRaw) return { valid: false, iban: "", reason: "IBAN fehlt" };
  const iban = String(ibanRaw).toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) {
    return { valid: false, iban, reason: "IBAN-Format ungültig (Länge/Struktur)" };
  }
  // Prüfziffer-Verfahren: die ersten 4 Zeichen ans Ende verschieben, dann
  // jeden Buchstaben in seine Zahl umwandeln (A=10 ... Z=35) und modulo 97
  // bilden. Eine gültige IBAN ergibt dabei immer genau Rest 1.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let numeric = "";
  for (let i = 0; i < rearranged.length; i++) {
    const ch = rearranged[i];
    if (ch >= "0" && ch <= "9") {
      numeric += ch;
    } else {
      numeric += (ch.charCodeAt(0) - 55).toString(); // 'A'.charCodeAt(0) === 65 -> 65-55=10
    }
  }
  const remainder = qrIbanMod97(numeric);
  if (remainder !== 1) {
    return { valid: false, iban, reason: "IBAN-Prüfziffer (MOD97) ungültig" };
  }
  return { valid: true, iban };
}

/**
 * Formatiert einen Euro-Betrag in das von EPC069-12 geforderte Format
 * "EUR<Betrag>" mit Punkt als Dezimaltrenner und genau 2 Nachkommastellen,
 * z.B. 132 -> "EUR132.00", 65.5 -> "EUR65.50". Kein Betrag -> leerer String
 * (Girocode ohne festen Betrag, der Zahler trägt ihn in der Banking-App ein).
 * @param {number|string|undefined|null} amountEUR
 * @returns {string}
 */
function formatEpcAmount(amountEUR) {
  if (amountEUR === undefined || amountEUR === null || amountEUR === "") return "";
  const n = Number(amountEUR);
  if (!isFinite(n) || n < 0) {
    throw new Error("Ungültiger Betrag: " + amountEUR);
  }
  if (n > 999999999.99) {
    throw new Error("Betrag überschreitet das laut EPC069-12 maximal zulässige Limit von 999999999.99 EUR");
  }
  return "EUR" + n.toFixed(2);
}

/**
 * Baut den 12-zeiligen EPC069-12-Textblock ("Girocode") für eine SEPA-
 * Überweisung, wie ihn jede deutsche Banking-App scannen und direkt als
 * vorausgefüllte Überweisung öffnen kann.
 *
 * Wichtig zu trailing empty lines: Der EPC069-12-Standard (Kapitel "Data
 * fields" / Formulierung des European Payments Council) erlaubt es, optionale
 * Datenelemente am ENDE des Textblocks komplett wegzulassen, sofern alle
 * davor liegenden (Pflicht-)Elemente in korrekter Reihenfolge vorhanden sind
 * — auch wenn manche davon leer sind. Deshalb wird hier nur vom Ende her
 * getrimmt (z.B. Zeile 12 "Beleg-Text", die wir nie befüllen), niemals aber
 * eine leere Zeile MITTEN im Block entfernt, da sonst alle nachfolgenden
 * Felder um eine Position verrutschen und der Scanner falsche Werte liest.
 *
 * @param {object} params
 * @param {string} params.iban
 * @param {string} params.empfaengerName
 * @param {number|string} [params.betragEUR] - optional, ohne festen Betrag weglassen
 * @param {string} [params.verwendungszweck] - unstrukturierter Verwendungszweck, z.B. Rechnungsnummer
 * @param {string} [params.bic] - optional; für SEPA-Länder (inkl. Deutschland) bei Version "002" nicht nötig
 * @returns {{
 *   text: string,
 *   valid: boolean,
 *   errors: string[],
 *   warnings: string[],
 *   truncatedPurpose: boolean,
 *   iban: string,
 *   empfaengerName: string,
 *   betrag: string,
 *   verwendungszweck: string
 * }}
 */
function buildEpcQrText(params) {
  params = params || {};
  const errors = [];
  const warnings = [];

  const ibanCheck = validateIban(params.iban);
  if (!ibanCheck.valid) {
    errors.push(ibanCheck.reason + (ibanCheck.iban ? " (" + ibanCheck.iban + ")" : ""));
  }

  const name = sanitizeEpcText(params.empfaengerName, 70);
  if (!name) errors.push("Empfängername fehlt oder enthielt nach dem Sanitizing keine gültigen Zeichen");

  let amountLine = "";
  try {
    amountLine = formatEpcAmount(params.betragEUR);
  } catch (e) {
    errors.push(e.message);
  }

  const bic = params.bic ? sanitizeEpcText(params.bic, 11) : "";
  // Erst ohne Längenlimit sanitizen, damit wir erkennen können, ob die 140-
  // Zeichen-Grenze aus der Spec überhaupt greift (für truncatedPurpose-Flag).
  const purposeSanitizedFull = sanitizeEpcText(params.verwendungszweck);
  let purpose = purposeSanitizedFull;
  let truncatedPurpose = false;
  if (purpose.length > 140) {
    purpose = purpose.slice(0, 140).trim();
    truncatedPurpose = true;
  }

  function buildLines(purposeText) {
    return [
      "BCD", // Zeile 1: Service Tag
      "002", // Zeile 2: Versionsnummer
      "1", // Zeile 3: Zeichensatz-Kennung (1 = UTF-8)
      "SCT", // Zeile 4: Identifikation Zahlungsart (SEPA Credit Transfer)
      bic, // Zeile 5: BIC (bei Version 002 + SEPA-IBAN leer zulässig)
      name, // Zeile 6: Name Zahlungsempfänger
      ibanCheck.iban || "", // Zeile 7: IBAN
      amountLine, // Zeile 8: Betrag, Format "EURxx.xx"
      "", // Zeile 9: Verwendungszweck-Kennung (strukturiert) - nicht genutzt
      "", // Zeile 10: Referenz (strukturiert) - nicht genutzt
      purposeText, // Zeile 11: unstrukturierter Verwendungszweck
      "", // Zeile 12: Beleg-Text (optional) - nicht genutzt
    ];
  }
  function assemble(lines) {
    const trimmed = lines.slice();
    while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") trimmed.pop();
    return trimmed.join("\n");
  }
  function byteLength(str) {
    return qrUtf8Bytes(str).length;
  }

  const MAX_BYTES = 331;
  let text = assemble(buildLines(purpose));

  if (byteLength(text) > MAX_BYTES && purpose.length > 0) {
    truncatedPurpose = true;
    // Verwendungszweck zeichenweise kürzen, bis die 331-Byte-Grenze eingehalten wird
    // (kann zusätzlich zur 140-Zeichen-Kürzung oben greifen, z.B. bei sehr langem Namen).
    while (purpose.length > 0 && byteLength(assemble(buildLines(purpose))) > MAX_BYTES) {
      purpose = purpose.slice(0, -1).trim();
    }
    text = assemble(buildLines(purpose));
    warnings.push(
      "Verwendungszweck wurde automatisch gekürzt, um die 331-Byte-Obergrenze der EPC069-12-Spezifikation einzuhalten."
    );
  }
  if (byteLength(text) > MAX_BYTES) {
    errors.push("EPC-Textblock überschreitet auch nach vollständigem Kürzen des Verwendungszwecks 331 Byte.");
  }

  return {
    text,
    valid: errors.length === 0,
    errors,
    warnings,
    truncatedPurpose,
    iban: ibanCheck.iban,
    empfaengerName: name,
    betrag: amountLine,
    verwendungszweck: purpose,
  };
}


module.exports = { buildEpcQrText, qrEncode, validateIban };
