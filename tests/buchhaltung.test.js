// Allindrive Autopilot · KI-Buchhaltung offline: Regeln und Schema für Belege (lib/buchhaltung.js) und das
// Holen von Anhängen aus dem Postfach (lib/postfach.js mailAnhaenge) mit nachgebautem IMAP-Server.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const imap = { nachrichten: [], uidValidity: 7n };
class FakeImapFlow {
    async connect() { if (imap.anmeldungFalsch) { const e = new Error("fail"); e.authenticationFailed = true; throw e; } }
    async getMailboxLock() { this.mailbox = { uidValidity: imap.uidValidity, uidNext: 100 }; return { release() { } }; }
    async fetchOne(uid) { const n = imap.nachrichten.find(x => String(x.uid) === String(uid)); return n ? { uid: n.uid, source: n.source } : false; }
    async logout() { }
}
const altLaden = Module._load;
Module._load = function (anfrage) { return anfrage === "imapflow" ? { ImapFlow: FakeImapFlow } : altLaden.apply(this, arguments); };

const B = require("../netlify/functions/lib/buchhaltung");
const PF = require("../netlify/functions/lib/postfach");
const P = require("../netlify/functions/lib/posteingang");

test("Kategorien der Belege sind dieselben wie in der App (Ausgaben & Gewinn)", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    const m = html.match(/const AUSGABEN_KATEGORIEN = (\[[^\]]+\]);/);
    assert.ok(m, "AUSGABEN_KATEGORIEN in index.html gefunden");
    assert.deepEqual(JSON.parse(m[1]), B.AUSGABEN_KATEGORIEN);
    const z = html.match(/const AUSGABEN_ZAHLARTEN = (\[[^\]]+\]);/);
    assert.deepEqual(JSON.parse(z[1]), B.ZAHLARTEN);
});

test("Strukturierte Ausgabe: Schema erfüllt die Bedingungen der API, kein Datum im System-Prompt", () => {
    const pruefe = (s) => {
        if (s.type !== "object") return;
        assert.equal(s.additionalProperties, false);
        assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
        Object.values(s.properties).forEach(pruefe);
    };
    pruefe(B.SCHEMA);
    assert.deepEqual(B.SCHEMA.properties.kategorie.enum, B.AUSGABEN_KATEGORIEN);
    assert.doesNotMatch(B.SYSTEM, /\d{1,2}\.\d{1,2}\.20\d\d|20\d\d-\d\d-\d\d/);
    // Posteingang erkennt Rechnungen an die Fahrschule
    pruefe(P.SCHEMA);
    assert.ok(P.SCHEMA.properties.eingangsrechnung);
    assert.equal(P.kiErgebnisPruefen({ kategorie: "geschaeft", eingangsrechnung: true }).eingangsrechnung, true);
    assert.equal(P.kiErgebnisPruefen({ kategorie: "geschaeft", eingangsrechnung: "ja" }).eingangsrechnung, false);
});

test("KI-Ergebnis prüfen: Betrag, Datum, Steuersatz, Kategorie, Zahlart", () => {
    const voll = { ist_beleg: true, lieferant: " Druckerei   Muster GmbH ", rechnungsnummer: "RE-4711", datum: "2026-10-14", faellig_am: "2026-10-28",
        betrag_brutto: 238.004, betrag_erkannt: true, ust_satz: "19", zahlart: "Überweisung", kategorie: "Werbung", beschreibung: "Flyer Schulstart", hinweis: "" };
    const b = B.belegPruefen(voll);
    assert.deepEqual(b, { ist_beleg: true, lieferant: "Druckerei Muster GmbH", rechnungsnummer: "RE-4711", datum: "2026-10-14", faellig_am: "2026-10-28",
        betrag: 238, ust_satz: 19, zahlart: "Überweisung", kategorie: "Werbung", beschreibung: "Flyer Schulstart", hinweis: "" });
    assert.equal(B.belegPruefen({ ...voll, betrag_erkannt: false }).betrag, null);
    assert.equal(B.belegPruefen({ ...voll, betrag_brutto: -5 }).betrag, null);
    assert.equal(B.belegPruefen({ ...voll, betrag_brutto: 2000000 }).betrag, null);
    assert.equal(B.belegPruefen({ ...voll, datum: "2026-02-30" }).datum, null);
    assert.equal(B.belegPruefen({ ...voll, datum: "14.10.2026" }).datum, null);
    assert.equal(B.belegPruefen({ ...voll, ust_satz: "unklar" }).ust_satz, null);
    assert.equal(B.belegPruefen({ ...voll, ust_satz: "0" }).ust_satz, 0);
    assert.equal(B.belegPruefen({ ...voll, kategorie: "Tanken" }).kategorie, "Sonstiges");
    assert.equal(B.belegPruefen({ ...voll, zahlart: "unklar" }).zahlart, "");
    assert.equal(B.belegPruefen(null), null);
    assert.equal(B.belegBeschreibung(b), "Druckerei Muster GmbH · Rechnung RE-4711 · Flyer Schulstart");
});

test("Nach dem Lesen: bereit mit Grund, wenn etwas fehlt; Fehler, wenn nichts lesbar war", () => {
    const b = B.belegPruefen({ ist_beleg: true, lieferant: "X", rechnungsnummer: "", datum: "2026-10-14", faellig_am: "", betrag_brutto: 10, betrag_erkannt: true,
        ust_satz: "19", zahlart: "Karte", kategorie: "Büro & Porto", beschreibung: "", hinweis: "" });
    assert.deepEqual(B.lesenErgebnis(b), { status: "bereit", grund: "" });
    assert.match(B.lesenErgebnis({ ...b, ist_beleg: false }).grund, /nicht nach einer Rechnung/);
    assert.match(B.lesenErgebnis({ ...b, betrag: null }).grund, /Betrag/);
    assert.match(B.lesenErgebnis({ ...b, datum: null }).grund, /Datum/);
    assert.equal(B.lesenErgebnis(null).status, "fehler");
});

test("Den richtigen Anhang wählen: PDF vor Foto, „Rechnung“ zuerst, keine AGB, nichts zu Großes", () => {
    const a = (name, typ, groesse) => ({ name, typ, groesse: groesse || 1000 });
    assert.equal(B.belegAnhangWaehlen([a("AGB.pdf", "application/pdf"), a("Rechnung_4711.pdf", "application/pdf"), a("foto.jpg", "image/jpeg")]).name, "Rechnung_4711.pdf");
    assert.equal(B.belegAnhangWaehlen([a("scan.jpg", "image/jpeg"), a("dokument.pdf", "application/pdf")]).name, "dokument.pdf");
    assert.equal(B.belegAnhangWaehlen([a("logo.png", "image/png"), a("quittung.jpg", "image/jpeg")]).name, "quittung.jpg");
    assert.equal(B.belegAnhangWaehlen([a("Rechnung.pdf", "application/pdf", 9 * 1024 * 1024)]), null);
    assert.equal(B.belegAnhangWaehlen([a("Rechnung.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")]), null);
    assert.equal(B.belegAnhangWaehlen([]), null);
    assert.deepEqual(B.belegInhalt("QUJD", "application/pdf")[0], { type: "document", source: { type: "base64", media_type: "application/pdf", data: "QUJD" } });
    assert.equal(B.belegInhalt("QUJD", "image/png")[0].type, "image");
    assert.equal(B.endungFuer("image/jpeg"), "jpg");
});

test("Anhänge einer Mail holen: echte Anhänge ohne eingebettete Bilder; Postfach neu oder Mail weg → nichts", async () => {
    const cfg = PF.konfiguration({ anbieter: "ionos", email: "info@fahrschule.de" }).cfg;
    const grenze = "XYZgrenze";
    const roh = [
        "From: Druckerei <rechnung@druck.example>", "Subject: Rechnung 4711", "Content-Type: multipart/mixed; boundary=" + grenze, "",
        "--" + grenze, "Content-Type: text/plain; charset=utf-8", "", "Anbei Ihre Rechnung.",
        "--" + grenze, "Content-Type: application/pdf; name=Rechnung_4711.pdf", "Content-Disposition: attachment; filename=Rechnung_4711.pdf",
        "Content-Transfer-Encoding: base64", "", Buffer.from("%PDF-1.4 Probe").toString("base64"),
        "--" + grenze, "Content-Type: image/png; name=logo.png", "Content-Disposition: inline; filename=logo.png", "Content-ID: <logo@druck>",
        "Content-Transfer-Encoding: base64", "", Buffer.from("PNG").toString("base64"),
        "--" + grenze + "--", "",
    ].join("\r\n");
    imap.nachrichten = [{ uid: 41, source: Buffer.from(roh) }];
    imap.uidValidity = 7n;
    const a = await PF.mailAnhaenge(cfg, "geheim", 41, 7);
    assert.equal(a.length, 1);
    assert.equal(a[0].name, "Rechnung_4711.pdf");
    assert.equal(a[0].typ, "application/pdf");
    assert.equal(a[0].inhalt.toString(), "%PDF-1.4 Probe");
    assert.equal(await PF.mailAnhaenge(cfg, "geheim", 99, 7), null);
    imap.uidValidity = 8n;
    assert.equal(await PF.mailAnhaenge(cfg, "geheim", 41, 7), null);
    imap.anmeldungFalsch = true;
    await assert.rejects(PF.mailAnhaenge(cfg, "falsch", 41, 8), (e) => e.eigen && /Anmeldung abgelehnt/.test(e.message));
    imap.anmeldungFalsch = false;
});
