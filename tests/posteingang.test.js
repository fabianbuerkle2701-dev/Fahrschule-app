// KI-Verwaltung · Posteingang (v2.126.0) offline: die festen Regeln (lib/posteingang.js) und die
// Postfach-Bausteine (lib/postfach.js) mit nachgebautem IMAP- und SMTP-Server.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("module");

// IMAP nachbauen, bevor lib/postfach.js geladen wird (ImapFlow wird dort beim Laden ausgepackt)
const imap = { ordner: [{ path: "INBOX" }, { path: "Gesendet", specialUse: "\\Sent" }], abgelegt: [], verbindungen: 0 };
class FakeImapFlow {
    constructor(o) { this.o = o; }
    async connect() { imap.verbindungen++; }
    async list() { return imap.ordner; }
    async append(pfad, roh, flags) { imap.abgelegt.push({ pfad, roh: String(roh), flags }); }
    async logout() { }
}
const altLaden = Module._load;
Module._load = function (anfrage) { return anfrage === "imapflow" ? { ImapFlow: FakeImapFlow } : altLaden.apply(this, arguments); };

const P = require("../netlify/functions/lib/posteingang");
const PF = require("../netlify/functions/lib/postfach");
const nodemailer = require("nodemailer");
const { berlinTagesbeginn } = require("../netlify/functions/posteingang-ki");

const kiAntwort = (extra) => ({ kategorie: "interessent", zusammenfassung: "Fragt nach Preisen Klasse B.", antwort_noetig: true, vollstaendig: true,
    betreff: "Ihre Anfrage", antwort: "Hallo Frau Muster,\n\ndie Grundgebühr beträgt 390 €.\n\nViele Grüße\nFahrschule Test", hinweis: "", interessent: {}, ...(extra || {}) });

test("entscheiden: nur vollständige Interessenten-Antworten gehen automatisch raus", () => {
    assert.deepEqual(P.entscheiden({ ki: kiAntwort() }), { status: "zu_senden", grund: "" });
    // Reihenfolge der Sperren
    assert.equal(P.entscheiden({ ki: kiAntwort(), gesundheit: true }).status, "braucht_dich");
    assert.equal(P.entscheiden({ ki: kiAntwort(), automatisch: "Automatische Antwort" }).status, "info");
    assert.equal(P.entscheiden({ ki: null }).status, "braucht_dich");
    assert.equal(P.entscheiden({ ki: kiAntwort({ kategorie: "werbung" }) }).status, "spam");
    assert.equal(P.entscheiden({ ki: kiAntwort({ antwort_noetig: false }) }).status, "info");
    for (const k of ["schueler", "eltern", "rechnung", "pruefung", "bewerbung", "geschaeft", "sonstiges"])
        assert.equal(P.entscheiden({ ki: kiAntwort({ kategorie: k }) }).status, "braucht_dich", k);
    assert.match(P.entscheiden({ ki: kiAntwort({ kategorie: "rechnung" }) }).grund, /Rechnung & Zahlung/);
    assert.equal(P.entscheiden({ ki: kiAntwort(), absenderIstSchueler: true }).status, "braucht_dich");
    assert.equal(P.entscheiden({ ki: kiAntwort({ vollstaendig: false }) }).status, "braucht_dich");
    // Die KI sagt "vollständig", lässt aber eine Lücke: zählt nicht
    assert.equal(P.entscheiden({ ki: kiAntwort({ antwort: "Der Kurs beginnt am [bitte ergänzen: Datum]." }) }).status, "braucht_dich");
    assert.equal(P.entscheiden({ ki: kiAntwort({ antwort: "" }) }).status, "braucht_dich");
    assert.equal(P.entscheiden({ ki: kiAntwort(), alt: true }).status, "braucht_dich");
    assert.equal(P.entscheiden({ ki: kiAntwort(), ohnePostfach: true }).grund, P.OHNE_POSTFACH);
    assert.equal(P.entscheiden({ ki: kiAntwort(), regeln: { autopilot: false } }).status, "braucht_dich");
    assert.equal(P.entscheiden({ ki: kiAntwort(), heuteAutomatisch: 19 }).status, "zu_senden");
    assert.equal(P.entscheiden({ ki: kiAntwort(), heuteAutomatisch: 20 }).status, "braucht_dich");
    assert.equal(P.entscheiden({ ki: kiAntwort(), regeln: { tageslimit: 0 } }).status, "braucht_dich");
});

test("Schutz vor Missbrauch: unbestätigter Absender, fremde Links, zu viele Antworten an denselben Absender", () => {
    assert.equal(P.absenderUnsicher({ "authentication-results": "mx.ionos.de; spf=fail smtp.mailfrom=bank.example; dkim=none" }), true);
    assert.equal(P.absenderUnsicher({ "authentication-results": "mx.ionos.de; dmarc=fail (p=reject) header.from=example.org" }), true);
    assert.equal(P.absenderUnsicher({ "authentication-results": "mx.ionos.de; spf=pass; dkim=pass; dmarc=pass" }), false);
    assert.equal(P.absenderUnsicher({ "authentication-results": "spf=softfail" }), false);
    assert.equal(P.absenderUnsicher({}), false);
    const erlaubt = "Online-Anmeldung: https://allindrive.netlify.app/?buchen=ABC\nWebseite www.fahrschule-test.de";
    assert.deepEqual(P.fremdeLinks("Melden Sie sich an: https://allindrive.netlify.app/?buchen=ABC.", erlaubt), []);
    assert.deepEqual(P.fremdeLinks("Mehr auf www.fahrschule-test.de!", erlaubt), []);
    assert.deepEqual(P.fremdeLinks("Hier zahlen: https://bezahl-sicher.example/konto", erlaubt), ["https://bezahl-sicher.example/konto"]);
    assert.deepEqual(P.fremdeLinks("Siehe https://allindrive.netlify.app/anderes", erlaubt), ["https://allindrive.netlify.app/anderes"]);
    assert.deepEqual(P.fremdeLinks("Kein Link hier.", erlaubt), []);
    assert.match(P.entscheiden({ ki: kiAntwort(), unsicher: true }).grund, /nicht bestätigt/);
    assert.match(P.entscheiden({ ki: kiAntwort(), fremdeLinks: ["https://x.example"] }).grund, /Link/);
    assert.equal(P.entscheiden({ ki: kiAntwort(), fremdeLinks: [] }).status, "zu_senden");
    assert.equal(P.entscheiden({ ki: kiAntwort(), antwortenAnAbsender: 1 }).status, "zu_senden");
    assert.match(P.entscheiden({ ki: kiAntwort(), antwortenAnAbsender: 2 }).grund, /zwei automatische Antworten/);
});

test("Automatische Nachrichten erkennen (sonst antworten sich zwei Autopiloten gegenseitig)", () => {
    assert.equal(P.automatischeNachricht("", {}), "Kein Absender");
    assert.equal(P.automatischeNachricht("info@fahrschule.de", {}, "Info@Fahrschule.de"), "Von der eigenen Adresse");
    assert.match(P.automatischeNachricht("MAILER-DAEMON@mx.example.org", {}), /Rückläufer/);
    assert.equal(P.automatischeNachricht("a@b.de", { "auto-submitted": "auto-replied" }), "Automatische Antwort");
    assert.equal(P.automatischeNachricht("a@b.de", { "auto-submitted": "no" }), "");
    assert.equal(P.automatischeNachricht("a@b.de", { "x-autoreply": "yes" }), "Automatische Antwort");
    assert.equal(P.automatischeNachricht("a@b.de", { precedence: "bulk" }), "Newsletter oder Massenmail");
    assert.equal(P.automatischeNachricht("a@b.de", { "list-unsubscribe": "<mailto:x>" }), "Newsletter oder Massenmail");
    assert.equal(P.automatischeNachricht("lea@example.org", { subject: "Anfrage" }), "");
});

test("Gesundheitsangaben gehen nie an die KI – Fahrschulwörter sind keine", () => {
    assert.equal(P.enthaeltGesundheit("Ich bin krank und kann morgen nicht"), true);
    assert.equal(P.enthaeltGesundheit("Nach meiner OP würde ich gern anfangen"), true);
    assert.equal(P.enthaeltGesundheit("Ich habe ein Attest vom Arzt"), true);
    assert.equal(P.enthaeltGesundheit("Was kostet der Führerschein Klasse B?"), false);
    assert.equal(P.enthaeltGesundheit("Thema heute: Vorfahrtsverletzung und Panikbremsung"), false);
    assert.equal(P.enthaeltGesundheit("Die Kooperation mit der Schule"), false);
});

test("Text säubern: Zitat, Verlauf und Signatur fallen weg, Länge ist begrenzt", () => {
    const t = "Hallo,\nwas kostet Klasse B?\n\nAm 19.10.2026 um 10:00 schrieb Fahrschule <info@x.de>:\n> alte Mail\n> noch mehr";
    assert.equal(P.textSaeubern(t), "Hallo,\nwas kostet Klasse B?");
    assert.equal(P.textSaeubern("Frage\n-- \nMax Muster\nTel 0123"), "Frage");
    assert.equal(P.textSaeubern("Frage\n> zitiert\nnoch eine Zeile"), "Frage\nnoch eine Zeile");
    assert.equal(P.textSaeubern("x".repeat(9000)).length, 6000);
    assert.equal(P.textSaeubern("a\r\nb\n\n\n\nc"), "a\nb\n\nc");
});

test("Schüler am Absendernamen erkennen (Vor- und Nachname, Umlaute egal)", () => {
    const schueler = [{ vorname: "Jörg", name: "Groß" }, { vorname: "Li", name: "Wu" }, { vorname: "", name: "Ohne" }];
    assert.equal(P.istSchueler("Joerg Gross", schueler), true);
    assert.equal(P.istSchueler("jörg GROSS", schueler), true);
    assert.equal(P.istSchueler("Groß, Jörg", schueler), true);
    assert.equal(P.istSchueler("Li Wu", schueler), true);
    assert.equal(P.istSchueler("Lisa Wunder", schueler), false);
    assert.equal(P.istSchueler("Ohne", schueler), false);
    assert.equal(P.istSchueler("", schueler), false);
});

test("KI-Ergebnis: Struktur prüfen, Längen begrenzen, unbekannte Kategorie wird sonstiges", () => {
    assert.equal(P.kiErgebnisPruefen(null), null);
    const e = P.kiErgebnisPruefen({ kategorie: "hack", antwort_noetig: "ja", vollstaendig: 1, antwort: "a".repeat(7000), betreff: " Re: x ", interessent: { telefon: "0".repeat(99) } });
    assert.equal(e.kategorie, "sonstiges");
    assert.equal(e.antwort_noetig, false);
    assert.equal(e.vollstaendig, false);
    assert.equal(e.antwort.length, 6000);
    assert.equal(e.betreff, "Re: x");
    assert.equal(e.interessent.telefon.length, 40);
    assert.equal(e.interessent.vorname, "");
});

test("Strukturierte Ausgabe: SCHEMA erfüllt die Bedingungen der API (alles Pflicht, keine Zusatzfelder)", () => {
    const pruefe = (s) => {
        if (s.type !== "object") return;
        assert.equal(s.additionalProperties, false);
        assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
        Object.values(s.properties).forEach(pruefe);
    };
    pruefe(P.SCHEMA);
    assert.deepEqual(P.SCHEMA.properties.kategorie.enum, P.KATEGORIEN);
    assert.doesNotMatch(P.SYSTEM, /\d{1,2}\.\d{1,2}\.20\d\d/); // kein Datum im System-Prompt
});

test("Fakten, Betreff und KI-Hinweis", () => {
    const f = P.faktenText({ name: "Fahrschule Test", locations: [{ name: "Mitte", street: "Hauptstr. 1", zip: "10115", city: "Berlin", phone: "030 123" }],
        klassen: ["B", { code: "A" }], price_hour: 65, price_grundgebuehr: 390, price_sonderfahrt: 0, packages: [{ name: "Start", amount: 1990, includedUE: 20 }] }, "https://allindrive.netlify.app/?buchen=ABC");
    assert.match(f, /Standort: Mitte · Hauptstr\. 1, 10115 Berlin · Telefon 030 123/);
    assert.match(f, /Führerscheinklassen: B, A/);
    assert.match(f, /Preis Fahrstunde \(45 Minuten\): 65,00 €/);
    assert.match(f, /Preis Grundgebühr: 390,00 €/);
    assert.doesNotMatch(f, /Sonderfahrt/); // 0 € = nicht angegeben
    assert.match(f, /Paket „Start“: 1\.990,00 € \(20 Fahrstunden/);
    assert.match(f, /Online-Anmeldung: https:\/\/allindrive\.netlify\.app\/\?buchen=ABC/);
    assert.equal(P.antwortBetreff("Frage zu Klasse B", ""), "Re: Frage zu Klasse B");
    assert.equal(P.antwortBetreff("x", "AW: Ihre Anfrage"), "AW: Ihre Anfrage");
    assert.equal(P.antwortBetreff("", ""), "Re: Ihre Anfrage");
    assert.match(P.kiHinweis("Fahrschule Test"), /KI-Assistenz der Fahrschule Test automatisch erstellt/);
    const n = P.nachricht(f, "", { von_name: "Lea", von_email: "lea@example.org", betreff: "Preis?", text: "Was kostet B?" });
    assert.match(n, /STECKBRIEF \(von der Fahrschule\)\nkeiner hinterlegt/);
    assert.match(n, /Von: Lea <lea@example\.org>\nBetreff: Preis\?\n\nWas kostet B\?/);
});

test("Postfach-Einstellungen: Vorlagen, Prüfung der Eingaben, keine lokalen Server", () => {
    const { cfg } = PF.konfiguration({ anbieter: "webde", email: " Info@Web.de ", absender_name: "Fahrschule <Test>" });
    assert.deepEqual(cfg, { email: "info@web.de", benutzer: "Info@Web.de", imap_host: "imap.web.de", imap_port: 993, imap_tls: true,
        smtp_host: "smtp.web.de", smtp_port: 587, smtp_tls: false, absender_name: "Fahrschule Test" });
    assert.match(PF.konfiguration({ email: "kein-at" }).fehler, /gültige E-Mail/);
    assert.match(PF.konfiguration({ email: "a@b.de", imap_host: "imap", smtp_host: "smtp.b.de" }).fehler, /Server/);
    assert.match(PF.konfiguration({ email: "a@b.de", imap_host: "mail.intern.local", smtp_host: "smtp.b.de" }).fehler, /nicht erlaubt/);
    assert.match(PF.konfiguration({ email: "a@b.de", imap_host: "imap.b.de", smtp_host: "smtp.b.de", smtp_port: 70000 }).fehler, /Port/);
    const eigen = PF.konfiguration({ email: "a@b.de", imap_host: "IMAP.B.DE", smtp_host: "smtp.b.de", imap_tls: false, smtp_port: "587", smtp_tls: false }).cfg;
    assert.equal(eigen.imap_host, "imap.b.de");
    assert.equal(eigen.imap_tls, false);
    assert.equal(eigen.smtp_port, 587);
    assert.match(PF.fehlerText({ authenticationFailed: true }), /Anmeldung abgelehnt/);
    assert.match(PF.fehlerText({ code: "ENOTFOUND" }, "imap.x.de"), /gibt es nicht/);
    assert.doesNotMatch(PF.fehlerText({ message: "Invalid login: geheim123" }), /geheim123/);
});

test("Mail zerlegen: Absender, Betreff, Text, Kennungen, Kopfzeilen in Kleinbuchstaben", async () => {
    const roh = [
        "From: Lea Muster <Lea.Muster@Example.org>", "To: info@fahrschule.de", "Subject: Anmeldung Klasse B", "Message-ID: <abc123@example.org>",
        "In-Reply-To: <vorher@fahrschule.de>", "References: <start@fahrschule.de> <vorher@fahrschule.de>", "Date: Mon, 19 Oct 2026 10:00:00 +0200",
        "Auto-Submitted: no", "Content-Type: text/plain; charset=utf-8", "", "Hallo, was kostet Klasse B?", "",
    ].join("\r\n");
    const z = await PF.mailZerlegen({ uid: 5, source: Buffer.from(roh) });
    assert.equal(z.von_name, "Lea Muster");
    assert.equal(z.von_email, "lea.muster@example.org");
    assert.equal(z.betreff, "Anmeldung Klasse B");
    assert.match(z.text, /was kostet Klasse B\?/);
    assert.equal(z.message_id, "<abc123@example.org>");
    assert.equal(z.antwort_auf, "<vorher@fahrschule.de>");
    assert.equal(z.referenzen, "<start@fahrschule.de> <vorher@fahrschule.de>");
    assert.equal(z.datum, "2026-10-19T08:00:00.000Z");
    assert.equal(z.headers["auto-submitted"], "no");
    assert.equal(z.anhaenge, 0);
    // Zu große Mail: nur Umschlag
    const g = await PF.mailZerlegen({ uid: 6, source: null, envelope: { from: [{ name: "X", address: "X@Y.DE" }], subject: "Groß", messageId: "<g@y.de>", date: "2026-10-19T08:00:00Z" } });
    assert.equal(g.von_email, "x@y.de");
    assert.match(g.text, /zu groß/);
});

test("Antwort senden: nur an den Absender, im selben Verlauf, Versand wird vor der Kopie in „Gesendet“ vermerkt", async () => {
    const gesendet = [];
    const reihenfolge = [];
    const alt = nodemailer.createTransport;
    nodemailer.createTransport = (o) => ({ verify: async () => true, sendMail: async (m) => { gesendet.push({ o, m }); reihenfolge.push("smtp"); return { messageId: "<neu@fahrschule.de>" }; } });
    imap.abgelegt = [];
    try {
        const cfg = PF.konfiguration({ anbieter: "ionos", email: "info@fahrschule.de", absender_name: "Fahrschule Test" }).cfg;
        await PF.antwortSenden(cfg, "geheim", { an: "lea@example.org", betreff: "Re: Anfrage\r\nBcc: x@y.de", text: "Hallo", antwortAuf: "<abc@example.org>",
            referenzen: "<start@x.de>", automatisch: true, gesendet: async () => { reihenfolge.push("vermerkt"); throw new Error("DB weg"); } });
        assert.equal(gesendet.length, 1);
        const m = gesendet[0].m;
        assert.equal(m.to, "lea@example.org");
        assert.equal(m.cc, undefined);
        assert.equal(m.bcc, undefined);
        assert.equal(m.subject, "Re: Anfrage Bcc: x@y.de"); // Zeilenumbruch im Betreff kann keine Kopfzeile einschleusen
        assert.deepEqual(m.from, { name: "Fahrschule Test", address: "info@fahrschule.de" });
        assert.equal(m.inReplyTo, "<abc@example.org>");
        assert.equal(m.references, "<start@x.de> <abc@example.org>");
        assert.equal(m.headers["Auto-Submitted"], "auto-replied");
        assert.equal(gesendet[0].o.auth.pass, "geheim");
        assert.equal(gesendet[0].o.secure, true);
        // Vermerk vor der Kopie; ein Fehler beim Vermerk ist kein Sendefehler (sonst ginge die Mail doppelt raus)
        assert.deepEqual(reihenfolge, ["smtp", "vermerkt"]);
        assert.equal(imap.abgelegt.length, 1);
        assert.equal(imap.abgelegt[0].pfad, "Gesendet");
        assert.match(imap.abgelegt[0].roh, /In-Reply-To: <abc@example\.org>/);
        await assert.rejects(PF.antwortSenden(cfg, "geheim", { an: "kaputt", text: "x" }), /Empfänger/);
        nodemailer.createTransport = () => ({ sendMail: async () => { const e = new Error("535 Authentication failed"); e.responseCode = 535; throw e; } });
        await assert.rejects(PF.antwortSenden(cfg, "geheim", { an: "lea@example.org", text: "x" }), (e) => e.eigen === true && /Anmeldung abgelehnt/.test(e.message));
    } finally {
        nodemailer.createTransport = alt;
    }
});

test("Tagesbeginn in Berlin (Sommer- und Winterzeit)", () => {
    assert.equal(berlinTagesbeginn(new Date("2026-10-20T10:00:00Z")), "2026-10-19T22:00:00.000Z");
    assert.equal(berlinTagesbeginn(new Date("2026-12-01T23:30:00Z")), "2026-12-01T23:00:00.000Z");
    assert.equal(berlinTagesbeginn(new Date("2026-12-01T22:59:00Z")), "2026-11-30T23:00:00.000Z");
});
