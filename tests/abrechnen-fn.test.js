// Vollautonom „Jeden Monat selbst abrechnen“ (Fabian 21.10.2026): Zeitjob vollautonom-abrechnen und die Rechnungs-PDF
// offline. Nachgebaut: Supabase-REST (Tabellen im Speicher, school_rechnungen, create_invoice) und das Postfach.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const DIR = path.join(__dirname, "..", "netlify", "functions");
const PF_PFAD = path.join(DIR, "lib", "postfach.js");
const echtPF = require(PF_PFAD);
const netz = { gesendet: [], fehler: null };
require.cache[PF_PFAD].exports = {
    ...echtPF,
    antwortSenden: async (cfg, pw, a) => {
        if (netz.fehler) throw Object.assign(new Error(netz.fehler), { eigen: true });
        netz.gesendet.push({ cfg, pw, a });
        if (typeof a.gesendet === "function") await a.gesendet({ messageId: "<r@x>" });
        return { messageId: "<r@x>" };
    },
};
const F = require(path.join(DIR, "vollautonom-abrechnen.js"));
const SENDEN = () => require(path.join(DIR, "rechnung-senden.js"));
const M = require(path.join(DIR, "lib", "rechnung-mail.js"));
const { rechnungPdf } = require(path.join(DIR, "lib", "rechnung-pdf.js"));

// Montag, 2.11.2026, 10 Uhr in Berlin (erste Woche des Monats)
const MONTAG = new Date("2026-11-02T09:00:00Z");
let T, opt, nummer, rpcs;
function schueler(id, extra) {
    return { student_id: id, vorname: "Tim", name: "Becker", email: "tim@example.org", anschrift: "Lindenweg 4\n70173 Stuttgart", firma: null, archiviert: false,
        abrechnungs_modell: null, invoices: [], payments: [], reminders: [], packages: [], cost_items: [],
        lessons: [{ id: id + "-l1", date: "2026-10-05", minutes: 45 }, { id: id + "-l2", date: "2026-10-20", minutes: 90 }, { id: id + "-l3", date: "2026-11-01", minutes: 45 }],
        ...(extra || {}) };
}
function neu(o) {
    opt = o || {};
    netz.gesendet = []; netz.fehler = null; nummer = 169; rpcs = [];
    T = {
        schools: [{ id: "schule-1", name: "Fahrschule Test", price_hour: 65, zahlungsziel_tage: 14, ki_aus: false, bereiche_aus: [],
            invoice_settings: { firma: "Fahrschule Test GmbH", strasse: "Hauptstraße 1", plzOrt: "70173 Stuttgart", steuernummer: "99/123/45678", iban: "DE89 3704 0044 0532 0130 00" },
            autopilot_paket: "vollautonom", autopilot_paket_bis: null, ki_autonomie: { abrechnen: true }, ...(opt.schule || {}) }],
        postfaecher: [{ id: "pf-1", school_id: "schule-1", email: "info@fahrschule-test.de", aktiv: true, letzter_fehler: "" }],
        profiles: [{ id: "admin-1", school_id: "schule-1", school_admin: true, school_office: false }, { id: "lehrer-3", school_id: "schule-1", school_admin: false, school_office: false }],
        nachrichten_ausgang: [],
        konten: opt.konten || [schueler("00000000-0000-4000-8000-000000000001")],
    };
    let zaehler = 0;
    global.fetch = async (url, init) => {
        const u = new URL(String(url));
        const methode = (init && init.method) || "GET";
        const antworten = (status, daten, k) => ({ ok: status < 300, status, json: async () => daten, text: async () => JSON.stringify(daten), headers: { get: (n) => (k || {})[n.toLowerCase()] || null } });
        if (u.pathname === "/auth/v1/user") return opt.uid === null ? antworten(401, {}) : antworten(200, { id: opt.uid || "admin-1" });
        if (u.pathname.startsWith("/rest/v1/rpc/")) {
            const name = u.pathname.slice(13);
            const args = JSON.parse(init.body);
            rpcs.push({ name, args });
            if (name === "school_rechnungen") return antworten(200, JSON.parse(JSON.stringify(T.konten)));
            if (name === "postfach_passwort") return antworten(200, "geheim");
            if (name === "create_invoice") {
                if (opt.anlegenKaputt) return antworten(500, { message: "kaputt" });
                const k = T.konten.find((x) => x.student_id === args.p_student_id);
                if (k.lessons.some((l) => args.p_lesson_ids.includes(l.id) && l.invoiced)) return antworten(400, { message: "Mindestens ein Posten steht schon auf Rechnung" });
                const nr = "RE-2026-0" + (++nummer);
                const total = Math.round(args.p_items.reduce((x, it) => x + it.amount, 0) * 100) / 100;
                const inv = { id: "inv" + nr, number: nr, date: "2026-11-02", items: args.p_items, total, note: "", kleinunternehmer: false, faellig: args.p_faellig };
                k.invoices.push(inv);
                k.lessons.forEach((l) => { if (args.p_lesson_ids.includes(l.id)) Object.assign(l, { invoiced: nr }, args.p_lesson_extra[l.id] || {}); });
                k.cost_items.forEach((c) => { if (args.p_cost_ids.includes(c.id)) c.invoiced = nr; });
                return antworten(200, inv);
            }
            throw new Error("RPC unbekannt " + name);
        }
        const tabelle = u.pathname.slice(9);
        if (tabelle === "students") {
            const id = u.searchParams.get("id").slice(3);
            const k = T.konten.find((x) => x.student_id === id);
            return antworten(200, k ? [{ invoices: k.invoices, payments: k.payments, lessons: k.lessons }] : []);
        }
        const filter = [...u.searchParams].filter(([k]) => !["select", "order", "limit"].includes(k));
        const passt = (z) => filter.every(([k, v]) => {
            const w = z[k];
            if (v.startsWith("eq.")) return String(w) === v.slice(3);
            if (v.startsWith("gte.")) return w != null && new Date(w) >= new Date(v.slice(4));
            throw new Error("Filter " + k + "=" + v);
        });
        const zeilen = (T[tabelle] || []).filter(passt);
        if (methode === "HEAD") return antworten(200, null, { "content-range": "0-0/" + zeilen.length });
        if (methode === "GET") return antworten(200, JSON.parse(JSON.stringify(zeilen)));
        if (methode === "PATCH") {
            const d = JSON.parse(init.body);
            zeilen.forEach((z) => Object.assign(z, d));
            return /return=representation/.test((init.headers || {}).Prefer || "") ? antworten(200, JSON.parse(JSON.stringify(zeilen))) : antworten(204, null);
        }
        if (methode === "POST") {
            const d = JSON.parse(init.body);
            if (T[tabelle].some((z) => z.school_id === d.school_id && z.schluessel === d.schluessel)) return antworten(201, []);
            const zeile = { id: "aus-" + (++zaehler), created_at: MONTAG.toISOString(), ...d };
            T[tabelle].push(zeile);
            return antworten(201, [zeile]);
        }
        throw new Error("Methode " + methode);
    };
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
    process.env.CRON_SECRET = "cron-test";
    F.uhr.jetzt = () => opt.jetzt || MONTAG;
}
const cron = () => ({ httpMethod: "POST", headers: { "x-cron-secret": "cron-test" }, body: "{}" });
const zeit = () => ({ getRemainingTimeInMillis: () => 20000 });

test("Rechnung über den Vormonat: angelegt wie im Autopilot, als PDF per E-Mail, im Ausgang – kein zweites Mal", async () => {
    neu();
    const r = await F.handler(cron(), zeit());
    assert.equal(r.statusCode, 200);
    const anlegen = rpcs.find((x) => x.name === "create_invoice").args;
    assert.deepEqual(anlegen.p_lesson_ids.sort(), ["00000000-0000-4000-8000-000000000001-l1", "00000000-0000-4000-8000-000000000001-l2"], "die Stunde vom 1.11. bleibt für den nächsten Monat");
    // Gruppiert nach Betrag je Fahrstunde wie im Autopilot: 45 Minuten = 65 €, 90 Minuten = 130 €
    assert.deepEqual(anlegen.p_items, [
        { label: "1 Fahrstunde à 65,00 €", amount: 65, date: "", von: "2026-10-05", bis: "2026-10-05" },
        { label: "1 Fahrstunde à 130,00 €", amount: 130, date: "", von: "2026-10-20", bis: "2026-10-20" },
    ]);
    assert.equal(anlegen.p_schulweg, true);
    assert.equal(anlegen.p_faellig, "2026-11-16");
    assert.deepEqual(anlegen.p_lesson_extra["00000000-0000-4000-8000-000000000001-l1"], { invoicedCoveredUE: 0, invoicedPrice: 65 });
    assert.equal(netz.gesendet.length, 1);
    const a = netz.gesendet[0].a;
    assert.equal(a.an, "tim@example.org");
    assert.equal(a.betreff, "Rechnung RE-2026-0170 · Fahrschule Test GmbH");
    assert.equal(a.erzeugt, true);
    assert.match(a.text, /^Hallo Tim,\n\nanbei die Rechnung RE-2026-0170 über 195,00\s€ \(Leistungen vom 05\.10\.2026 bis 20\.10\.2026\)\. Bitte überweise den Betrag bis zum 16\.11\.2026/);
    assert.match(a.text, /automatisch verschickt/);
    assert.equal(a.anhaenge.length, 1);
    assert.equal(a.anhaenge[0].name, "Rechnung-RE-2026-0170.pdf");
    assert.equal(a.anhaenge[0].typ, "application/pdf");
    assert.equal(a.anhaenge[0].daten.subarray(0, 5).toString(), "%PDF-");
    assert.equal(T.nachrichten_ausgang.length, 1);
    assert.deepEqual({ art: T.nachrichten_ausgang[0].art, status: T.nachrichten_ausgang[0].status, bezug: T.nachrichten_ausgang[0].bezug, von: T.nachrichten_ausgang[0].gesendet_von },
        { art: "rechnung", status: "gesendet", bezug: "00000000-0000-4000-8000-000000000001:invRE-2026-0170", von: null });
    // Zweiter Lauf: nichts Neues (abgerechnet; und je Schüler höchstens eine Rechnung im Monat)
    T.konten[0].lessons.push({ id: "spaet", date: "2026-10-30", minutes: 45 }); // nachgetragene Oktober-Stunde
    await F.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 1);
    assert.equal(rpcs.filter((x) => x.name === "create_invoice").length, 1);
});

test("Nur mit Paket, Schalter, KI, Bereich Rechnungen, vollständigen Rechnungsdaten – und nur Anfang des Monats werktags", async () => {
    for (const schule of [{ autopilot_paket: "teilautonom" }, { ki_autonomie: {} }, { ki_aus: true }, { bereiche_aus: ["rechnungen"] },
        { invoice_settings: { firma: "Fahrschule Łódź", strasse: "Hauptstraße 1", plzOrt: "70173 Stuttgart", steuernummer: "99/123/45678" } },
        { invoice_settings: { firma: "Fahrschule Test GmbH", strasse: "Hauptstraße 1", plzOrt: "70173 Stuttgart" } }]) {
        neu({ schule });
        await F.handler(cron(), zeit());
        assert.equal(rpcs.filter((x) => x.name === "create_invoice").length, 0, JSON.stringify(schule));
    }
    for (const jetzt of [new Date("2026-11-09T09:00:00Z"), new Date("2026-11-07T09:00:00Z"), new Date("2026-11-02T15:30:00Z")]) {
        neu({ jetzt });
        assert.equal(JSON.parse((await F.handler(cron(), zeit())).body).ruhe, true, jetzt.toISOString());
    }
    neu({ postfach: true });
    T.postfaecher[0].aktiv = false;
    await F.handler(cron(), zeit());
    assert.equal(rpcs.filter((x) => x.name === "create_invoice").length, 0);
});

test("Vorsichtiger als von Hand: keine Archivierten, keine Firmen, nur mit E-Mail, 1 bis 2.000 €, Guthaben-Modell nicht", async () => {
    const faelle = [
        [{ archiviert: true }, "archiviert"],
        [{ firma: { name: "Logistik Nord GmbH", email: "b@example.org" } }, "Firmenkunde"],
        [{ email: "" }, "ohne E-Mail"],
        [{ lessons: Array.from({ length: 40 }, (_, i) => ({ id: "x" + i, date: "2026-10-0" + (1 + (i % 9)), minutes: 45 })) }, "über 2.000 €"],
        [{ abrechnungs_modell: "guthaben" }, "Guthaben: nie zusätzlich berechnet"],
        [{ lessons: [{ id: "n", date: "2026-11-01", minutes: 90 }] }, "nur Stunden im neuen Monat"],
        [{ cost_items: [{ label: "Lehrmaterial", amount: 49.9 }] }, "Posten ohne Kennung"],
        [{ vorname: "Ольга" }, "Name nicht in der PDF-Schrift darstellbar"],
        [{ anschrift: "ul. Łąkowa 3\n00-001 Warszawa" }, "Anschrift nicht darstellbar"],
    ];
    for (const [extra, warum] of faelle) {
        neu({ konten: [schueler("00000000-0000-4000-8000-000000000002", extra)] });
        await F.handler(cron(), zeit());
        assert.equal(rpcs.filter((x) => x.name === "create_invoice").length, 0, warum);
    }
    // Offene Posten mit Kennung kommen mit auf die Rechnung; Paket-Einheiten werden angerechnet
    neu({ konten: [schueler("00000000-0000-4000-8000-000000000003", { cost_items: [{ id: "c1", label: "Grundbetrag Klasse B", amount: 390 }], packages: [{ includedUE: 2, date: "2026-09-01" }] })] });
    await F.handler(cron(), zeit());
    const items = rpcs.find((x) => x.name === "create_invoice").args.p_items;
    assert.deepEqual(items.map((x) => [x.label, x.amount]), [["1 Fahrstunde à 65,00 €", 65], ["Grundbetrag Klasse B", 390]], "zwei von drei Einheiten aus dem Paket");
});

test("Fehler: Anlegen scheitert → nächster Lauf versucht es noch einmal; Senden scheitert → Rechnung bleibt, nicht noch einmal", async () => {
    neu({ anlegenKaputt: true });
    await F.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 0);
    assert.equal(T.nachrichten_ausgang[0].status, "fehler");
    opt.anlegenKaputt = false;
    await F.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 1, "zweiter Versuch");
    neu();
    netz.fehler = "Anmeldung am Postausgang fehlgeschlagen";
    const r = await F.handler(cron(), zeit());
    assert.equal(JSON.parse(r.body).ergebnis["schule-1"], "senden_fehler");
    assert.equal(T.nachrichten_ausgang[0].status, "fehler");
    assert.match(T.nachrichten_ausgang[0].fehler, /^Rechnung RE-2026-0170 erstellt, aber nicht verschickt/);
    netz.fehler = null;
    await F.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 0, "lieber gar nicht als doppelt");
    assert.equal(rpcs.filter((x) => x.name === "create_invoice").length, 1);
});

test("PDF: Pflichtangaben, Kleinunternehmer ohne USt-Ausweis, Zeichen außerhalb von WinAnsi brechen nichts", async () => {
    const schule = { name: "Fahrschule Test", invoice_settings: { firma: "Fahrschule Test GmbH", strasse: "Hauptstraße 1", plzOrt: "70173 Stuttgart", steuernummer: "99/123/45678", kleinunternehmer: true } };
    const konto = { vorname: "Ольга", name: "Łukasiewicz 😊", anschrift: "Ulica 1\n00-001 Warszawa", lessons: [], cost_items: [], packages: [], invoices: [], payments: [] };
    const rechnung = { id: "i1", number: "RE-2026-0200", date: "2026-11-02", faellig: "2026-11-16", total: 130, items: [{ label: "2 Fahrstunden à 65,00 € – sehr lange Beschreibung ".repeat(4), amount: 130 }], kleinunternehmer: true };
    const pdf = await rechnungPdf({ schule, konto, rechnung, offen: 130 });
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 1000);
    // Viele Posten: mehrere Seiten statt abgeschnitten
    const lang = { ...rechnung, items: Array.from({ length: 60 }, (_, i) => ({ label: "Posten " + (i + 1), amount: 1 })) };
    const pdf2 = await rechnungPdf({ schule, konto, rechnung: lang, offen: 60 });
    const { PDFDocument } = require("pdf-lib");
    assert.ok((await PDFDocument.load(pdf2)).getPageCount() >= 2);
    assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);
});

// ── Rechnung per E-Mail senden (Admin und Büro, ohne KI-Paket) ──
const nutzer = (body) => ({ httpMethod: "POST", headers: { authorization: "Bearer nutzer-token" }, body: JSON.stringify(body) });
const SCHUELER_ID = "00000000-0000-4000-8000-000000000001";
function mitRechnung(extra) {
    const k = schueler(SCHUELER_ID, extra);
    k.invoices.push({ id: "inv9", number: "RE-2026-0150", date: "2026-10-20", faellig: "2026-11-03", total: 520, items: [{ label: "8 Fahrstunden à 65,00 €", amount: 520, von: "2026-09-01", bis: "2026-09-30" }] });
    k.payments.push({ amount: 100, date: "2026-10-25", invoiceId: "inv9" });
    return k;
}

test("Rechnung per E-Mail: an den Schüler bzw. die Firma, als PDF, im Ausgang – ein Klick sendet nur einmal", async () => {
    neu({ uid: null, konten: [mitRechnung()] });
    assert.equal((await SENDEN().handler(nutzer({ student_id: SCHUELER_ID, invoice_id: "inv9", schluessel: "11111111-1111-4111-8111-111111111111" }))).statusCode, 401);
    neu({ uid: "lehrer-3", konten: [mitRechnung()] });
    assert.equal((await SENDEN().handler(nutzer({ student_id: SCHUELER_ID, invoice_id: "inv9", schluessel: "11111111-1111-4111-8111-111111111111" }))).statusCode, 403);
    neu({ konten: [mitRechnung()] });
    let r = await SENDEN().handler(nutzer({ student_id: SCHUELER_ID, invoice_id: "inv9", schluessel: "11111111-1111-4111-8111-111111111111", an: "boese@example.org" }));
    assert.equal(r.statusCode, 200);
    assert.equal(netz.gesendet.length, 1);
    const a = netz.gesendet[0].a;
    assert.equal(a.an, "tim@example.org", "Empfänger vom Server, nie aus der Anfrage");
    assert.equal(a.betreff, "Rechnung RE-2026-0150 · Fahrschule Test GmbH");
    assert.match(a.text, /^Hallo Tim,\n\nanbei die Rechnung RE-2026-0150 über 520,00\s€ \(Leistungen vom 01\.09\.2026 bis 30\.09\.2026\)\. Bitte überweise den Betrag bis zum 03\.11\.2026/);
    assert.doesNotMatch(a.text, /automatisch/);
    assert.equal(a.anhaenge[0].name, "Rechnung-RE-2026-0150.pdf");
    assert.equal(a.anhaenge[0].daten.subarray(0, 5).toString(), "%PDF-");
    assert.deepEqual({ art: T.nachrichten_ausgang[0].art, bezug: T.nachrichten_ausgang[0].bezug, status: T.nachrichten_ausgang[0].status, von: T.nachrichten_ausgang[0].gesendet_von },
        { art: "rechnung", bezug: SCHUELER_ID + ":inv9", status: "gesendet", von: "admin-1" });
    r = await SENDEN().handler(nutzer({ student_id: SCHUELER_ID, invoice_id: "inv9", schluessel: "11111111-1111-4111-8111-111111111111" }));
    assert.equal(JSON.parse(r.body).schon, true);
    assert.equal(netz.gesendet.length, 1, "derselbe Klick sendet nicht noch einmal");
    // Firmenkunde: an die Rechnungs-E-Mail, Sie-Form
    neu({ konten: [mitRechnung({ firma: { name: "Logistik Nord GmbH", email: "buchhaltung@logistik-nord.example", strasse: "Hafenstraße 12", plz_ort: "20457 Hamburg" } })] });
    await SENDEN().handler(nutzer({ student_id: SCHUELER_ID, invoice_id: "inv9", schluessel: "22222222-2222-4222-8222-222222222222" }));
    assert.equal(netz.gesendet[0].a.an, "buchhaltung@logistik-nord.example");
    assert.match(netz.gesendet[0].a.text, /^Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie die Rechnung RE-2026-0150/);
    // Ohne E-Mail, ohne Postfach, fremde Rechnung
    neu({ konten: [mitRechnung({ email: "" })] });
    assert.equal((await SENDEN().handler(nutzer({ student_id: SCHUELER_ID, invoice_id: "inv9", schluessel: "33333333-3333-4333-8333-333333333333" }))).statusCode, 400);
    neu({ konten: [mitRechnung()] });
    T.postfaecher[0].aktiv = false;
    assert.equal((await SENDEN().handler(nutzer({ student_id: SCHUELER_ID, invoice_id: "inv9", schluessel: "33333333-3333-4333-8333-333333333333" }))).statusCode, 409);
    neu({ konten: [mitRechnung()] });
    assert.equal((await SENDEN().handler(nutzer({ student_id: SCHUELER_ID, invoice_id: "gibtsnicht", schluessel: "33333333-3333-4333-8333-333333333333" }))).statusCode, 404);
});

test("Nicht verschickte Rechnung aus dem Zeitjob: bis sie jemand von Hand sendet", () => {
    const zeilen = [
        { art: "rechnung", bezug: "s1:inv1", status: "fehler", fehler: "Rechnung RE-2026-0170 erstellt, aber nicht verschickt: Anmeldung fehlgeschlagen", created_at: "2026-11-02T09:00:00Z" },
        { art: "rechnung", bezug: "s2:inv2", status: "fehler", fehler: "Rechnung ließ sich nicht anlegen.", created_at: "2026-11-02T09:00:00Z" },
        { art: "rechnung", bezug: "s3:inv3", status: "fehler", fehler: "Rechnung RE-2026-0172 erstellt, aber nicht verschickt: x", created_at: "2026-11-02T09:00:00Z" },
        { art: "rechnung", bezug: "s3:inv3", status: "gesendet", created_at: "2026-11-03T09:00:00Z" },
    ];
    assert.deepEqual([...M.nichtVerschickt(zeilen)], ["s1:inv1"]);
});
