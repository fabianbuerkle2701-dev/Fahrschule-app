// Allindrive Autopilot · nachricht-senden (21.10.2026) offline: Zahlungserinnerung und Nachfassen von Hand über
// das Postfach der Fahrschule. Nachgebaut sind die Supabase-REST-Schnittstelle (kleine Tabellen im Speicher mit
// eq/in/gte-Filtern, Spaltenauswahl samt data->>feld, eindeutigem Schlüssel und Zählen), die RPCs mit dem Token
// des Nutzers sowie SMTP (nodemailer) und der IMAP-Ordner „Gesendet“. lib/postfach.js läuft dabei echt.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("module");

// IMAP nachbauen, bevor lib/postfach.js geladen wird (ImapFlow wird dort beim Laden ausgepackt).
// append merkt sich, wie die Ausgangs-Zeilen in dem Moment standen (Versand vor der Kopie festgehalten?).
const imap = { abgelegt: [] };
class FakeImapFlow {
    async connect() { }
    async list() { return [{ path: "INBOX" }, { path: "Gesendet", specialUse: "\\Sent" }]; }
    async append(pfad, roh, flags) { imap.abgelegt.push({ pfad, roh: String(roh), flags, stand: T.nachrichten_ausgang.map(z => z.status) }); }
    async logout() { }
}
const altLaden = Module._load;
Module._load = function (anfrage) { return anfrage === "imapflow" ? { ImapFlow: FakeImapFlow } : altLaden.apply(this, arguments); };

// SMTP nachbauen: der Transport schreibt nur mit (oder scheitert auf Wunsch)
const nodemailer = require("nodemailer");
const smtp = { gesendet: [], fehler: null };
nodemailer.createTransport = (o) => ({
    verify: async () => true,
    sendMail: async (m) => {
        if (smtp.fehler) throw smtp.fehler;
        smtp.gesendet.push({ o, m });
        return { messageId: "<n" + smtp.gesendet.length + "@fahrschule-test.de>" };
    },
});

const DIR = path.join(__dirname, "..", "netlify", "functions");
const FN = () => require(path.join(DIR, "nachricht-senden.js"));
const PF = require(path.join(DIR, "lib", "postfach.js"));
const ZENTRAL = "96530a9f-28ae-4ac6-9cfa-26de392ecf05";
const DEMO = "114d1f0a-9947-459d-8009-06282799ca44";
const uuid = (vorne, n) => vorne + "-0000-4000-8000-" + String(n).padStart(12, "0");
const S_JONAS = uuid("00000000", 1), S_FIRMA = uuid("00000000", 2), S_FIRMA_OHNE = uuid("00000000", 3), S_OHNE = uuid("00000000", 4),
    S_ZWEI = uuid("00000000", 5), S_FREMD = uuid("00000000", 6);
const I_LEA = uuid("10000000", 1), I_KONTAKT = uuid("10000000", 2), I_OHNE = uuid("10000000", 3), I_FREMD = uuid("10000000", 4);
const K = (n) => uuid("20000000", n);
const STATUS = ["reserviert", "gesendet", "fehler"];
const KEIN_POSTFACH = "Kein Postfach verbunden – verbinde es im Autopilot unter Einstellungen.";

// ── Supabase im Speicher ──
let T, opt, rpcAufrufe, fetchAufrufe, laufendeNr;
const jetzt = () => new Date().toISOString();
const vor = (ms) => new Date(Date.now() - ms).toISOString();
const klon = (x) => JSON.parse(JSON.stringify(x));
// Heutiges Datum in Berlin, um plus Tage verschoben (unabhängig von der Function gerechnet)
function berlinHeute(plus) {
    const [j, m, t] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date()).split("-").map(Number);
    return new Date(Date.UTC(j, m - 1, t + (plus || 0))).toISOString().slice(0, 10);
}
function filtern(zeilen, params) {
    return zeilen.filter(z => {
        for (const [k, v] of params) {
            if (["select", "order", "limit"].includes(k)) continue;
            const w = z[k];
            if (v.startsWith("eq.")) { if (String(w) !== v.slice(3)) return false; }
            else if (v.startsWith("neq.")) { if (String(w) === v.slice(4)) return false; }
            else if (v.startsWith("in.(")) { if (!v.slice(4, -1).split(",").includes(String(w))) return false; }
            else if (v.startsWith("gte.")) { if (w == null || new Date(w) < new Date(v.slice(4))) return false; }
            else throw new Error("Filter unbekannt " + k + "=" + v);
        }
        return true;
    });
}
// Spaltenauswahl wie PostgREST: spalte, alias:spalte, alias:data->>feld (Text), alias:data->feld (JSON)
function auswaehlen(z, select) {
    if (!select || select === "*") return z;
    const o = {};
    for (const teil of select.split(",")) {
        const i = teil.indexOf(":");
        const alias = i >= 0 ? teil.slice(0, i) : null, ausdruck = i >= 0 ? teil.slice(i + 1) : teil;
        const m = ausdruck.match(/^(\w+)(->>|->)(\w+)$/);
        if (m) {
            const v = z[m[1]] && typeof z[m[1]] === "object" ? z[m[1]][m[3]] : undefined;
            o[alias || m[3]] = v == null ? null : m[2] === "->>" ? (typeof v === "object" ? JSON.stringify(v) : String(v)) : v;
        }
        else o[alias || ausdruck] = z[ausdruck] === undefined ? null : z[ausdruck];
    }
    return o;
}
function antwortObj(status, daten, kopf) {
    return { ok: status < 300, status, json: async () => daten, text: async () => JSON.stringify(daten), headers: { get: (n) => (kopf || {})[n.toLowerCase()] || null } };
}
const tokenUid = (kopf) => { const t = String((kopf && kopf.Authorization) || "").replace(/^Bearer /, ""); return t.startsWith("tok-") ? t.slice(4) : null; };
const schuleVon = (owner) => (T.profiles.find(p => p.id === owner) || {}).school_id;
const darfSchulweit = (uid, schule) => uid === ZENTRAL || T.profiles.some(p => p.id === uid && p.school_id === schule && (p.school_admin || p.school_office));

// Die RPCs, die die Function aufruft - mit den Regeln der echten Funktionen (Rechte, Felder, Tagesgrenze)
function rpc(name, args, kopf) {
    const uid = tokenUid(kopf);
    if (name === "postfach_passwort")
        return kopf.Authorization === "Bearer service-test" ? antwortObj(200, opt.ohnePasswort ? null : "geheim") : antwortObj(403, { message: "permission denied" });
    if (name === "school_erinnerung_vermerken") {
        const s = T.students.find(x => x.id === args.p_student_id);
        if (!uid || !s || !darfSchulweit(uid, schuleVon(s.owner))) return antwortObj(400, { message: "Kein Zugriff: nur Fahrschul-Admin oder Büro" });
        if (opt.vermerkFehler) return antwortObj(500, { message: "Testfehler" });
        if (!(args.p_stufe >= 1 && args.p_stufe <= 3) || !["whatsapp", "email", "telefon", "brief", "kopiert"].includes(args.p_kanal) || !(args.p_betrag > 0 && args.p_betrag <= 100000))
            return antwortObj(400, { message: "Ungültige Angaben" });
        const inv = (s.data.invoices || []).find(i => i.id === args.p_invoice_id);
        if (!inv || "cancelledBy" in inv || "stornoOf" in inv) return antwortObj(400, { message: "Rechnung nicht gefunden oder storniert" });
        s.data.reminders = Array.isArray(s.data.reminders) ? s.data.reminders : [];
        if (s.data.reminders.some(r => r.invoiceId === args.p_invoice_id && r.date === berlinHeute()))
            return antwortObj(400, { message: "Zu dieser Rechnung ist heute schon eine Erinnerung vermerkt" });
        const e = { date: berlinHeute(), stage: args.p_stufe, amount: args.p_betrag, invoiceId: args.p_invoice_id, kanal: args.p_kanal, erfasstVon: "buero" };
        s.data.reminders.push(e);
        return antwortObj(200, e);
    }
    if (name === "school_interessent_speichern") {
        if (!uid || !darfSchulweit(uid, args.p_school_id)) return antwortObj(400, { message: "Kein Zugriff: nur Fahrschul-Admin oder Büro" });
        if (opt.speichernFehler) return antwortObj(500, { message: "Testfehler" });
        const i = T.interessenten.find(x => x.id === args.p_id && schuleVon(x.owner) === args.p_school_id);
        if (!i) return antwortObj(400, { message: "Interessent nicht gefunden" });
        for (const [k, v] of Object.entries(args.p_felder || {})) {
            if (!["vorname", "name", "tel", "klasse", "notiz", "status", "follow_up_am", "quelle", "absagegrund", "email"].includes(k)) return antwortObj(400, { message: "Feld nicht änderbar" });
            if (k === "status" && !["offen", "kontaktiert", "angemeldet", "abgesagt"].includes(v)) return antwortObj(400, { message: "Unbekannter Status" });
            if (k === "follow_up_am" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return antwortObj(400, { message: "Nächster Kontakt bitte als Datum angeben" });
        }
        Object.assign(i, args.p_felder);
        if (args.p_owner) i.owner = args.p_owner;
        return antwortObj(200, i.id);
    }
    throw new Error("RPC unbekannt " + name);
}

function neu(o) {
    opt = o || {};
    rpcAufrufe = []; fetchAufrufe = []; laufendeNr = 0;
    smtp.gesendet = []; smtp.fehler = null; imap.abgelegt = [];
    T = {
        schools: [{ id: "schule-1", name: "Fahrschule Test" }, { id: "schule-2", name: "Fahrschule Fremd" }],
        profiles: [
            { id: "admin-1", school_id: "schule-1", school_admin: true, school_office: false },
            { id: "lehrer-2", school_id: "schule-1", school_admin: false, school_office: false },
            { id: "buero-3", school_id: "schule-1", school_admin: false, school_office: true },
            { id: "fremd-9", school_id: "schule-2", school_admin: true, school_office: false },
            { id: ZENTRAL, school_id: "schule-2", school_admin: true, school_office: false },
        ],
        students: [
            // Kein Firmenkunde: eine alte Firmen-Adresse zählt nicht
            { id: S_JONAS, owner: "lehrer-2", data: { vorname: "Jonas", name: "Weber", email: " jonas@example.org ", firmaEmail: "alt@firma.example", lessons: [{ notiz: "privat" }],
                invoices: [{ id: "inv1", number: "RE-2026-0001", total: 520 }, { id: "inv2", number: "RE-2026-0002", total: 100, cancelledBy: "RE-2026-0003" }], reminders: [] } },
            { id: S_FIRMA, owner: "lehrer-2", data: { vorname: "Mia", email: "mia@example.org", istFirmenkunde: true, firmaName: "Muster GmbH", firmaEmail: "rechnung@muster-gmbh.de",
                invoices: [{ id: "inv7", number: "RE-2026-0007", total: 900 }] } },
            { id: S_FIRMA_OHNE, owner: "lehrer-2", data: { vorname: "Ole", email: "ole@example.org", istFirmenkunde: true, firmaEmail: "  ", invoices: [{ id: "inv8", total: 50 }] } },
            { id: S_OHNE, owner: "lehrer-2", data: { vorname: "Ben", email: "", invoices: [{ id: "inv9", total: 60 }] } },
            { id: S_ZWEI, owner: "lehrer-2", data: { vorname: "Kai", email: "kai@example.org,chef", invoices: [{ id: "inv10", total: 70 }] } },
            { id: S_FREMD, owner: "fremd-9", data: { vorname: "Fremd", email: "fremd@example.org", invoices: [{ id: "inv11", total: 80 }] } },
        ],
        interessenten: [
            { id: I_LEA, owner: "lehrer-2", vorname: "Lea", name: "Muster", email: "lea@example.org", status: "offen", follow_up_am: null },
            { id: I_KONTAKT, owner: "admin-1", vorname: "Tom", name: "Klein", email: "tom@example.org", status: "kontaktiert", follow_up_am: "2026-10-01" },
            { id: I_OHNE, owner: "lehrer-2", vorname: "Ina", name: "Ohne", email: null, status: "offen", follow_up_am: null },
            { id: I_FREMD, owner: "fremd-9", vorname: "Fra", name: "Fremd", email: "fra@example.org", status: "offen", follow_up_am: null },
        ],
        postfaecher: [{ id: "pf-1", school_id: "schule-1", email: "info@fahrschule-test.de", benutzer: "info@fahrschule-test.de", imap_host: "imap.ionos.de", imap_port: 993, imap_tls: true,
            smtp_host: "smtp.ionos.de", smtp_port: 465, smtp_tls: true, absender_name: "Fahrschule Test", aktiv: true, geheimnis_id: "g-1" }],
        nachrichten_ausgang: [],
    };
    global.fetch = async (url, init) => {
        const u = new URL(String(url));
        const methode = (init && init.method) || "GET";
        const kopf = (init && init.headers) || {};
        fetchAufrufe.push({ pfad: u.pathname, suche: decodeURIComponent(u.search), methode, auth: kopf.Authorization });
        if (u.pathname === "/auth/v1/user") {
            const uid = tokenUid(kopf);
            return uid ? antwortObj(200, { id: uid }) : antwortObj(401, { msg: "invalid JWT" });
        }
        if (u.pathname.startsWith("/rest/v1/rpc/")) {
            const name = u.pathname.slice(13), args = JSON.parse((init && init.body) || "{}");
            rpcAufrufe.push({ name, args, auth: kopf.Authorization });
            return rpc(name, args, kopf);
        }
        const tabelle = u.pathname.slice(9);
        if (!T[tabelle]) throw new Error("Tabelle unbekannt " + tabelle);
        if (opt.dbWeg && opt.dbWeg(tabelle, methode)) return antwortObj(503, { message: "nicht erreichbar" });
        const treffer = filtern(T[tabelle], u.searchParams);
        if (methode === "HEAD") return antwortObj(200, null, { "content-range": "*/" + treffer.length });
        if (methode === "GET") return antwortObj(200, klon(treffer.map(z => auswaehlen(z, u.searchParams.get("select")))));
        if (methode === "PATCH") {
            const daten = JSON.parse(init.body);
            if (tabelle === "nachrichten_ausgang" && "status" in daten && !STATUS.includes(daten.status)) return antwortObj(400, { code: "23514" });
            // Fehlertext wie bei PostgREST: enthält die ganze Zeile (auch die Adresse) - darf nie ins Log
            if (opt.patchFehler && opt.patchFehler(daten)) return antwortObj(500, { message: "Failing row contains " + JSON.stringify(treffer) });
            treffer.forEach(z => Object.assign(z, daten));
            return /return=representation/.test(kopf.Prefer || "") ? antwortObj(200, klon(treffer)) : antwortObj(204, null);
        }
        if (methode === "POST") {
            const daten = JSON.parse(init.body);
            if (tabelle === "nachrichten_ausgang") {
                if (!daten.school_id || !daten.schluessel) return antwortObj(400, { code: "23502" });
                if (!["erinnerung", "nachfassen"].includes(daten.art) || !STATUS.includes(daten.status || "reserviert")) return antwortObj(400, { code: "23514" });
                if (T.nachrichten_ausgang.some(z => z.school_id === daten.school_id && z.schluessel === daten.schluessel)) return antwortObj(409, { code: "23505" });
            }
            const zeile = { id: tabelle + "-" + (++laufendeNr), bezug: null, an: null, betreff: null, gesendet_von: null, status: "reserviert", fehler: null, created_at: jetzt(), ...daten };
            T[tabelle].push(zeile);
            return antwortObj(201, [klon(zeile)]);
        }
        throw new Error("Methode " + methode);
    };
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
}

const anfrage = (uid, body) => ({ httpMethod: "POST", headers: uid === undefined ? {} : { authorization: "Bearer " + (uid === null ? "kaputt" : "tok-" + uid) }, body: JSON.stringify(body) });
async function senden(uid, body) {
    const r = await FN().handler(anfrage(uid, body));
    return { status: r.statusCode, daten: r.body ? JSON.parse(r.body) : null };
}
const BETREFF = "2. Zahlungserinnerung · Rechnung RE-2026-0001";
const TEXT = "Hallo Jonas,\n\ndie Rechnung RE-2026-0001 ist noch offen.\n\nViele Grüße\nFahrschule Test";
const erinnerung = (extra) => ({ art: "erinnerung", schluessel: K(1), student_id: S_JONAS, invoice_id: "inv1", stufe: 2, betrag: 120.5, betreff: BETREFF, text: TEXT, ...(extra || {}) });
const nachfassen = (extra) => ({ art: "nachfassen", schluessel: K(2), interessent_id: I_LEA, betreff: "Deine Anfrage bei der Fahrschule Test",
    text: "Hallo Lea,\n\nhast du noch Fragen zu Klasse B?\n\nViele Grüße\nFahrschule Test", ...(extra || {}) });
const ausgang = (extra) => T.nachrichten_ausgang.push({ id: "alt-" + T.nachrichten_ausgang.length, school_id: "schule-1", art: "nachfassen", schluessel: K(900 + T.nachrichten_ausgang.length),
    bezug: "x", an: "x@example.org", betreff: "x", gesendet_von: "buero-3", status: "gesendet", fehler: null, created_at: jetzt(), ...(extra || {}) });
const tabellenAufrufe = () => fetchAufrufe.filter(f => f.pfad.startsWith("/rest/v1/") && !f.pfad.startsWith("/rest/v1/rpc/"));
const satz = (t) => assert.match(t, /^[A-ZÄÖÜ].*[.!?]$/s, "kein ganzer Satz: " + t);

test("Nur POST; ohne oder mit ungültigem Token 401; Demo-Konto sendet nie; ohne Service-Schlüssel 500", async () => {
    neu();
    assert.equal((await FN().handler({ httpMethod: "OPTIONS", headers: {} })).statusCode, 200);
    const g = await FN().handler({ httpMethod: "GET", headers: {} });
    assert.equal(g.statusCode, 405);
    satz(JSON.parse(g.body).error);
    let r = await senden(undefined, erinnerung());
    assert.equal(r.status, 401);
    satz(r.daten.error);
    r = await senden(null, erinnerung());
    assert.equal(r.status, 401);
    r = await senden(DEMO, erinnerung());
    assert.equal(r.status, 403);
    assert.equal(r.daten.error, "Im Demo-Modus wird nichts gesendet.");
    assert.equal(tabellenAufrufe().length, 0);
    assert.equal(smtp.gesendet.length, 0);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    r = await senden("admin-1", erinnerung());
    assert.equal(r.status, 500);
    assert.equal(smtp.gesendet.length, 0);
});

test("Rechte: Fahrlehrer ohne Admin/Büro 403 (ohne Schülerdaten zu lesen), fremde Fahrschule 403, Büro darf, zentraler Admin darf jede Fahrschule", async () => {
    neu();
    let r = await senden("lehrer-2", erinnerung()); // sein eigener Schüler - aber er ist weder Admin noch Büro
    assert.equal(r.status, 403);
    assert.match(r.daten.error, /nur Fahrschul-Admin und Büro/);
    r = await senden("lehrer-2", nachfassen());
    assert.equal(r.status, 403);
    assert.equal(fetchAufrufe.filter(f => f.pfad === "/rest/v1/students" || f.pfad === "/rest/v1/interessenten").length, 0);
    for (const b of [erinnerung(), nachfassen()]) {
        r = await senden("fremd-9", b); // Admin einer anderen Fahrschule
        assert.equal(r.status, 403);
    }
    r = await senden("admin-1", erinnerung({ student_id: S_FREMD, invoice_id: "inv11" }));
    assert.equal(r.status, 403);
    r = await senden("admin-1", nachfassen({ interessent_id: I_FREMD }));
    assert.equal(r.status, 403);
    assert.equal(smtp.gesendet.length, 0);
    assert.equal(T.nachrichten_ausgang.length, 0);
    // Büro der Fahrschule darf
    r = await senden("buero-3", erinnerung());
    assert.equal(r.status, 200);
    assert.equal(r.daten.vermerk, true);
    assert.equal(rpcAufrufe.find(x => x.name === "school_erinnerung_vermerken").auth, "Bearer tok-buero-3");
    assert.equal(T.nachrichten_ausgang[0].gesendet_von, "buero-3");
    // Zentraler Allindrive-Admin: jede Fahrschule, gesendet über das Postfach der Fahrschule des Interessenten
    r = await senden(ZENTRAL, nachfassen());
    assert.equal(r.status, 200);
    assert.equal(T.nachrichten_ausgang[1].school_id, "schule-1");
    assert.equal(smtp.gesendet[1].o.auth.user, "info@fahrschule-test.de");
    assert.equal(smtp.gesendet.length, 2);
    // Unbekannter Schüler bzw. Interessent → 404
    r = await senden("admin-1", erinnerung({ student_id: uuid("00000000", 99), schluessel: K(30) }));
    assert.equal(r.status, 404);
    r = await senden("admin-1", nachfassen({ interessent_id: uuid("10000000", 99), schluessel: K(31) }));
    assert.equal(r.status, 404);
});

test("Kein Postfach oder kein Passwort → 409 mit Hinweis auf die Einstellungen, nichts reserviert", async () => {
    neu();
    T.postfaecher = [];
    let r = await senden("admin-1", erinnerung());
    assert.equal(r.status, 409);
    assert.equal(r.daten.error, KEIN_POSTFACH);
    neu({ ohnePasswort: true });
    r = await senden("buero-3", nachfassen());
    assert.equal(r.status, 409);
    assert.equal(r.daten.error, KEIN_POSTFACH);
    assert.equal(rpcAufrufe.find(x => x.name === "postfach_passwort").auth, "Bearer service-test");
    assert.equal(smtp.gesendet.length, 0);
    assert.equal(T.nachrichten_ausgang.length, 0);
});

test("Empfänger bestimmt der Server: Firmenkunde → Rechnungs-E-Mail der Firma, sonst der Schüler; ohne Adresse 400", async () => {
    neu();
    const fremd = { an: "angreifer@example.com", to: "angreifer@example.com", email: "angreifer@example.com" }; // zählt nie
    let r = await senden("admin-1", erinnerung({ ...fremd, student_id: S_FIRMA, invoice_id: "inv7", schluessel: K(11) }));
    assert.equal(r.status, 200);
    assert.equal(r.daten.an, "rechnung@muster-gmbh.de");
    assert.equal(smtp.gesendet[0].m.to, "rechnung@muster-gmbh.de");
    // Firmenkunde ohne Rechnungs-E-Mail → Schüler
    r = await senden("admin-1", erinnerung({ ...fremd, student_id: S_FIRMA_OHNE, invoice_id: "inv8", schluessel: K(12) }));
    assert.equal(r.daten.an, "ole@example.org");
    // Kein Firmenkunde, aber eine (alte) Firmen-Adresse gespeichert → Schüler; Leerzeichen fallen weg
    r = await senden("admin-1", erinnerung({ ...fremd, schluessel: K(13) }));
    assert.equal(r.daten.an, "jonas@example.org");
    assert.equal(smtp.gesendet[2].m.to, "jonas@example.org");
    // Ohne Adresse
    r = await senden("admin-1", erinnerung({ student_id: S_OHNE, invoice_id: "inv9", schluessel: K(14) }));
    assert.equal(r.status, 400);
    assert.equal(r.daten.error, "Für diesen Schüler ist keine E-Mail-Adresse hinterlegt.");
    r = await senden("admin-1", nachfassen({ interessent_id: I_OHNE, schluessel: K(15) }));
    assert.equal(r.status, 400);
    assert.equal(r.daten.error, "Für diesen Interessenten ist keine E-Mail-Adresse hinterlegt.");
    // Mehr als eine Adresse im Feld → ungültig, geht an niemanden
    r = await senden("admin-1", erinnerung({ student_id: S_ZWEI, invoice_id: "inv10", schluessel: K(16) }));
    assert.equal(r.status, 400);
    assert.match(r.daten.error, /ungültig/);
    assert.equal(smtp.gesendet.length, 3);
    assert.ok(smtp.gesendet.every(g => !/angreifer/.test(JSON.stringify(g.m))));
    assert.equal(T.nachrichten_ausgang.length, 3); // die abgelehnten haben nichts reserviert
});

test("Zahlungserinnerung: einmal als reiner Text gesendet, Zeile „gesendet“ ohne Text, Vermerk mit Nutzer-Token und Weg email", async () => {
    neu();
    const r = await senden("admin-1", erinnerung());
    assert.equal(r.status, 200);
    assert.deepEqual(r.daten, { ok: true, an: "jonas@example.org", vermerk: true });
    // Die Mail: vom Postfach der Fahrschule mit Absendername, reiner Text, keine Antwort auf eine frühere Mail
    assert.equal(smtp.gesendet.length, 1);
    const { o, m } = smtp.gesendet[0];
    assert.equal(m.to, "jonas@example.org");
    assert.deepEqual(m.from, { name: "Fahrschule Test", address: "info@fahrschule-test.de" });
    assert.equal(m.subject, BETREFF);
    assert.equal(m.text, TEXT);
    for (const k of ["html", "attachments", "inReplyTo", "references", "cc", "bcc", "replyTo"]) assert.equal(m[k], undefined, k);
    assert.equal(m.headers["Auto-Submitted"], "no");
    assert.equal(o.host, "smtp.ionos.de");
    assert.equal(o.auth.pass, "geheim");
    // Kopie in „Gesendet“ - erst nachdem der Versand festgehalten ist
    assert.equal(imap.abgelegt.length, 1);
    assert.equal(imap.abgelegt[0].pfad, "Gesendet");
    assert.deepEqual(imap.abgelegt[0].stand, ["gesendet"]);
    assert.doesNotMatch(imap.abgelegt[0].roh, /In-Reply-To|References:|text\/html/i);
    // Protokoll: Empfänger und Betreff, nie der Text
    assert.equal(T.nachrichten_ausgang.length, 1);
    const z = T.nachrichten_ausgang[0];
    assert.deepEqual({ ...z, id: undefined, created_at: undefined }, { id: undefined, created_at: undefined, school_id: "schule-1", art: "erinnerung", schluessel: K(1),
        bezug: S_JONAS + ":inv1", an: "jonas@example.org", betreff: BETREFF, gesendet_von: "admin-1", status: "gesendet", fehler: null });
    assert.doesNotMatch(JSON.stringify(T.nachrichten_ausgang), /noch offen/);
    // Vermerk im Erinnerungs-Protokoll: mit dem Token des Nutzers (auth.uid()), Weg email
    const v = rpcAufrufe.filter(x => x.name === "school_erinnerung_vermerken");
    assert.equal(v.length, 1);
    assert.equal(v[0].auth, "Bearer tok-admin-1");
    assert.deepEqual(v[0].args, { p_student_id: S_JONAS, p_invoice_id: "inv1", p_stufe: 2, p_kanal: "email", p_betrag: 120.5 });
    assert.deepEqual(T.students[0].data.reminders.map(x => [x.invoiceId, x.kanal, x.stage]), [["inv1", "email", 2]]);
    // Tabellen nur mit dem Service-Schlüssel, das Passwort nur über den Server; nie die ganze Schülerakte gelesen
    assert.ok(tabellenAufrufe().length > 0);
    assert.ok(tabellenAufrufe().every(f => f.auth === "Bearer service-test"));
    assert.equal(rpcAufrufe.find(x => x.name === "postfach_passwort").auth, "Bearer service-test");
    const schueler = fetchAufrufe.filter(f => f.pfad === "/rest/v1/students");
    assert.equal(schueler.length, 1);
    assert.doesNotMatch(schueler[0].suche, /select=\*|[,=]data(,|&|$)/);
});

test("Nachfassen: an die gespeicherte Adresse, danach „kontaktiert“ und nächster Kontakt in drei Tagen (Berliner Datum)", async () => {
    neu();
    let r = await senden("admin-1", nachfassen());
    assert.equal(r.status, 200);
    assert.deepEqual(r.daten, { ok: true, an: "lea@example.org", vermerk: true });
    assert.equal(smtp.gesendet[0].m.to, "lea@example.org");
    assert.equal(smtp.gesendet[0].m.inReplyTo, undefined);
    const s = rpcAufrufe.filter(x => x.name === "school_interessent_speichern");
    assert.equal(s.length, 1);
    assert.equal(s[0].auth, "Bearer tok-admin-1");
    assert.deepEqual(s[0].args, { p_school_id: "schule-1", p_id: I_LEA, p_owner: null, p_felder: { follow_up_am: berlinHeute(3), status: "kontaktiert" } });
    const lea = T.interessenten.find(i => i.id === I_LEA);
    assert.equal(lea.status, "kontaktiert");
    assert.equal(lea.follow_up_am, berlinHeute(3));
    assert.equal(lea.owner, "lehrer-2"); // zuständiger Fahrlehrer bleibt
    assert.deepEqual([T.nachrichten_ausgang[0].art, T.nachrichten_ausgang[0].bezug, T.nachrichten_ausgang[0].status], ["nachfassen", I_LEA, "gesendet"]);
    // Schon kontaktiert: nur der nächste Kontakt, der Status bleibt
    r = await senden("buero-3", nachfassen({ interessent_id: I_KONTAKT, schluessel: K(21) }));
    assert.equal(r.status, 200);
    assert.deepEqual(rpcAufrufe.filter(x => x.name === "school_interessent_speichern")[1].args.p_felder, { follow_up_am: berlinHeute(3) });
    const tom = T.interessenten.find(i => i.id === I_KONTAKT);
    assert.deepEqual([tom.status, tom.follow_up_am], ["kontaktiert", berlinHeute(3)]);
    assert.equal(rpcAufrufe.filter(x => x.name === "school_erinnerung_vermerken").length, 0);
});

test("Gleicher Schlüssel: kein zweiter Versand; reserviert → 409; dieselbe Kennung für eine andere Nachricht → 409", async () => {
    neu();
    let r = await senden("admin-1", erinnerung());
    assert.equal(r.status, 200);
    r = await senden("admin-1", erinnerung());
    assert.equal(r.status, 200);
    assert.deepEqual(r.daten, { ok: true, schon: true, an: "jonas@example.org" });
    r = await senden("buero-3", erinnerung()); // auch für die Kollegin aus dem Büro
    assert.equal(r.daten.schon, true);
    assert.equal(smtp.gesendet.length, 1);
    assert.equal(rpcAufrufe.filter(x => x.name === "school_erinnerung_vermerken").length, 1);
    assert.equal(T.nachrichten_ausgang.length, 1);
    // Dieselbe Kennung für eine andere Rechnung oder einen Interessenten
    r = await senden("admin-1", erinnerung({ student_id: S_FIRMA, invoice_id: "inv7" }));
    assert.equal(r.status, 409);
    assert.match(r.daten.error, /anderen Nachricht/);
    r = await senden("admin-1", nachfassen({ schluessel: K(1) }));
    assert.equal(r.status, 409);
    // Läuft gerade (reserviert) → 409
    ausgang({ schluessel: K(2), bezug: I_LEA, status: "reserviert" });
    r = await senden("admin-1", nachfassen());
    assert.equal(r.status, 409);
    assert.equal(r.daten.error, "Diese Nachricht wird gerade gesendet.");
    // Hängt seit Minuten (Function abgebrochen): lieber nachsehen lassen als doppelt senden
    T.nachrichten_ausgang[1].created_at = vor(5 * 60000);
    r = await senden("admin-1", nachfassen());
    assert.equal(r.status, 409);
    assert.match(r.daten.error, /unklar.*„Gesendet“/);
    assert.equal(smtp.gesendet.length, 1);
});

test("Doppelklick: zwei gleichzeitige Anfragen mit demselben Schlüssel senden genau eine Mail", async () => {
    neu();
    const [a, b] = await Promise.all([senden("admin-1", erinnerung()), senden("admin-1", erinnerung())]);
    assert.equal(smtp.gesendet.length, 1);
    assert.equal(T.nachrichten_ausgang.length, 1);
    assert.equal(T.nachrichten_ausgang[0].status, "gesendet");
    const st = [a, b].map(x => x.status + (x.daten.schon ? " schon" : "")).sort();
    assert.ok(st.includes("200"), st.join());
    assert.ok(st.includes("409") || st.includes("200 schon"), st.join());
    assert.equal(rpcAufrufe.filter(x => x.name === "school_erinnerung_vermerken").length, 1);
});

test("Grenzen: 100 gesendete Mails je Fahrschule und Berliner Tag, 10 je Person und Minute → 429", async () => {
    neu();
    for (let i = 0; i < 99; i++) ausgang();
    for (let i = 0; i < 5; i++) ausgang({ created_at: vor(36 * 3600000) }); // gestern
    for (let i = 0; i < 5; i++) ausgang({ status: "fehler" }); // nicht gesendet
    for (let i = 0; i < 5; i++) ausgang({ school_id: "schule-2" }); // andere Fahrschule
    let r = await senden("admin-1", erinnerung()); // die 100. heute
    assert.equal(r.status, 200);
    r = await senden("admin-1", nachfassen());
    assert.equal(r.status, 429);
    assert.match(r.daten.error, /100 Nachrichten.*morgen/);
    satz(r.daten.error);
    assert.equal(smtp.gesendet.length, 1);
    // Je Person und Minute (jeder Versuch zählt, auch ein gescheiterter)
    neu();
    for (let i = 0; i < 10; i++) ausgang({ gesendet_von: "admin-1", status: i % 2 ? "gesendet" : "fehler", created_at: vor(20000) });
    r = await senden("admin-1", erinnerung());
    assert.equal(r.status, 429);
    assert.match(r.daten.error, /letzten Minute/);
    r = await senden("buero-3", erinnerung()); // andere Person
    assert.equal(r.status, 200);
    neu();
    for (let i = 0; i < 10; i++) ausgang({ gesendet_von: "admin-1", created_at: vor(2 * 60000) }); // länger her
    r = await senden("admin-1", erinnerung());
    assert.equal(r.status, 200);
});

test("SMTP-Fehler: Zeile „fehler“, 502 mit verständlichem Satz, kein Vermerk; derselbe Schlüssel darf es danach noch einmal versuchen", async () => {
    neu();
    smtp.fehler = Object.assign(new Error("connect ETIMEDOUT 10.1.2.3:465"), { code: "ETIMEDOUT" });
    let r = await senden("admin-1", erinnerung());
    assert.equal(r.status, 502);
    assert.equal(r.daten.error, "Die Nachricht ging nicht raus. Der Server smtp.ionos.de antwortet nicht. Bitte Server und Port prüfen.");
    assert.doesNotMatch(r.daten.error, /10\.1\.2\.3|ETIMEDOUT/);
    assert.equal(T.nachrichten_ausgang.length, 1);
    assert.equal(T.nachrichten_ausgang[0].status, "fehler");
    assert.match(T.nachrichten_ausgang[0].fehler, /antwortet nicht/);
    assert.equal(rpcAufrufe.filter(x => x.name === "school_erinnerung_vermerken").length, 0);
    assert.equal(imap.abgelegt.length, 0);
    // Anmeldung abgelehnt: ebenfalls ein Satz ohne Technik
    neu();
    smtp.fehler = Object.assign(new Error("Invalid login: 535 Authentication failed for geheim"), { responseCode: 535 });
    r = await senden("admin-1", nachfassen());
    assert.equal(r.status, 502);
    assert.match(r.daten.error, /^Die Nachricht ging nicht raus\. Anmeldung abgelehnt/);
    assert.doesNotMatch(r.daten.error, /geheim/);
    assert.equal(T.interessenten.find(i => i.id === I_LEA).status, "offen");
    // Noch ein Versuch mit demselben Schlüssel, jetzt klappt es: genau eine Mail, Zeile „gesendet“
    smtp.fehler = null;
    const vorher = T.nachrichten_ausgang[0].created_at;
    r = await senden("admin-1", nachfassen());
    assert.equal(r.status, 200);
    assert.equal(r.daten.vermerk, true);
    assert.equal(smtp.gesendet.length, 1);
    assert.equal(T.nachrichten_ausgang.length, 1);
    assert.deepEqual([T.nachrichten_ausgang[0].status, T.nachrichten_ausgang[0].fehler], ["gesendet", null]);
    assert.ok(T.nachrichten_ausgang[0].created_at >= vorher);
    assert.equal(T.interessenten.find(i => i.id === I_LEA).status, "kontaktiert");
});

test("Vermerk scheitert nach dem Versand: trotzdem ok mit vermerk false und Hinweis – nie ein zweiter Versand", async () => {
    neu({ vermerkFehler: true });
    let r = await senden("admin-1", erinnerung());
    assert.equal(r.status, 200);
    assert.equal(r.daten.ok, true);
    assert.equal(r.daten.an, "jonas@example.org");
    assert.equal(r.daten.vermerk, false);
    assert.match(r.daten.hinweis, /raus.*von Hand/);
    satz(r.daten.hinweis);
    assert.equal(T.nachrichten_ausgang[0].status, "gesendet");
    r = await senden("admin-1", erinnerung());
    assert.equal(r.daten.schon, true);
    assert.equal(smtp.gesendet.length, 1);
    // Heute steht schon eine Erinnerung im Protokoll (z. B. per WhatsApp): die Mail geht raus, der Hinweis sagt, warum kein Vermerk
    neu();
    T.students[0].data.reminders = [{ date: berlinHeute(), stage: 1, amount: 120.5, invoiceId: "inv1", kanal: "whatsapp" }];
    r = await senden("admin-1", erinnerung());
    assert.equal(r.status, 200);
    assert.equal(r.daten.vermerk, false);
    assert.match(r.daten.hinweis, /heute schon eine Erinnerung/);
    assert.equal(smtp.gesendet.length, 1);
    // Nachfassen: Speichern scheitert
    neu({ speichernFehler: true });
    r = await senden("admin-1", nachfassen());
    assert.equal(r.status, 200);
    assert.equal(r.daten.vermerk, false);
    assert.match(r.daten.hinweis, /beim Interessenten von Hand/);
    assert.equal(smtp.gesendet.length, 1);
});

test("Eingaben: Art, Kennung, Betreff 1–200, Text 1–8000, Stufe, Betrag; stornierte oder unbekannte Rechnung → nichts gesendet", async () => {
    neu();
    const faelle = [
        [{ art: "werbung" }, 400, /Art von Nachricht/],
        [{ art: undefined }, 400, /Art von Nachricht/],
        [{ schluessel: "abc" }, 400, /Kennung/],
        [{ betreff: "   " }, 400, /Betreff/],
        [{ betreff: 42 }, 400, /Betreff/],
        [{ betreff: "x".repeat(201) }, 400, /höchstens 200/],
        [{ text: " \n " }, 400, /leer/],
        [{ text: "x".repeat(8001) }, 400, /höchstens 8000/],
        [{ text: "Bitte bis [bitte ergänzen: Datum] zahlen." }, 400, /bitte ergänzen/],
        [{ student_id: "kein-uuid" }, 400, /Schüler/],
        [{ invoice_id: "" }, 400, /Rechnung/],
        [{ invoice_id: 7 }, 400, /Rechnung/],
        [{ stufe: 4 }, 400, /Stufe/],
        [{ stufe: "2" }, 400, /Stufe/],
        [{ betrag: 0 }, 400, /Betrag/],
        [{ betrag: "120" }, 400, /Betrag/],
        [{ betrag: 100001 }, 400, /Betrag/],
        [{ invoice_id: "inv2" }, 409, /storniert/],
        [{ invoice_id: "gibt-es-nicht" }, 404, /Rechnung gibt es nicht/],
        [{ student_id: uuid("00000000", 99) }, 404, /Schüler gibt es nicht/],
    ];
    for (const [extra, status, fehler] of faelle) {
        const r = await senden("admin-1", erinnerung(extra));
        assert.equal(r.status, status, JSON.stringify(extra).slice(0, 60));
        assert.match(r.daten.error, fehler);
        satz(r.daten.error);
    }
    let r = await senden("admin-1", nachfassen({ interessent_id: "x" }));
    assert.equal(r.status, 400);
    satz(r.daten.error);
    const k = await FN().handler({ httpMethod: "POST", headers: { authorization: "Bearer tok-admin-1" }, body: "{kaputt" });
    assert.equal(k.statusCode, 400);
    satz(JSON.parse(k.body).error);
    assert.equal(smtp.gesendet.length, 0);
    assert.equal(T.nachrichten_ausgang.length, 0);
    // Genau an den Grenzen geht es; ein Zeilenumbruch im Betreff schleust keine Kopfzeile ein
    r = await senden("admin-1", erinnerung({ betreff: "B".repeat(200), text: "T".repeat(8000) }));
    assert.equal(r.status, 200);
    r = await senden("admin-1", erinnerung({ schluessel: K(40), betreff: " Zahlung\r\nBcc: x@y.de ", text: "Zeile 1\r\nZeile 2" }));
    assert.equal(r.status, 200);
    const m = smtp.gesendet[1].m;
    assert.equal(m.subject, "Zahlung Bcc: x@y.de");
    assert.equal(m.bcc, undefined);
    assert.equal(m.text, "Zeile 1\nZeile 2");
    // Datenbank nicht erreichbar → 503, nichts gesendet
    neu({ dbWeg: (tabelle) => tabelle === "nachrichten_ausgang" });
    r = await senden("admin-1", erinnerung());
    assert.equal(r.status, 503);
    satz(r.daten.error);
    assert.equal(smtp.gesendet.length, 0);
});

test("Datenschutz: Adresse, Betreff und Text kommen nie ins Log, auch wenn danach etwas scheitert", async () => {
    const log = [];
    const alt = {};
    for (const k of ["log", "info", "warn", "error", "debug"]) { alt[k] = console[k]; console[k] = (...x) => log.push(x.map(String).join(" ")); }
    try {
        neu();
        await senden("admin-1", erinnerung());
        neu();
        smtp.fehler = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        await senden("admin-1", erinnerung());
        neu({ vermerkFehler: true });
        await senden("admin-1", erinnerung());
        // Protokoll lässt sich nach dem Versand nicht auf „gesendet“ setzen: die Mail ist raus, der Schlüssel bleibt gesperrt
        neu({ patchFehler: (d) => d.status === "gesendet" });
        let r = await senden("admin-1", erinnerung());
        assert.equal(r.status, 200);
        assert.equal(r.daten.ok, true);
        assert.equal(T.nachrichten_ausgang[0].status, "reserviert");
        r = await senden("admin-1", erinnerung());
        assert.equal(r.status, 409);
        assert.equal(smtp.gesendet.length, 1);
        neu({ patchFehler: (d) => d.status === "fehler" });
        smtp.fehler = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        r = await senden("admin-1", nachfassen());
        assert.equal(r.status, 502);
    }
    finally {
        Object.assign(console, alt);
    }
    assert.ok(log.length >= 2, "die beiden Protokollfehler werden gemeldet");
    for (const zeile of log) {
        assert.doesNotMatch(zeile, /jonas@example\.org|lea@example\.org|Zahlungserinnerung|Deine Anfrage|Hallo|Rechnung RE-/, zeile);
    }
});

test("Datum „in drei Tagen“ über den Kalender (auch bei der Zeitumstellung) und Tagesbeginn in Berlin", () => {
    const { berlinDatum, berlinTagesbeginn } = FN();
    assert.equal(berlinDatum(3, new Date("2026-10-24T22:30:00Z")), "2026-10-28"); // 00:30 Sommerzeit, in der Nacht wird umgestellt
    assert.equal(berlinDatum(3, new Date("2026-03-28T23:30:00Z")), "2026-04-01"); // 00:30 Winterzeit vor der Sommerzeit
    assert.equal(berlinDatum(0, new Date("2026-12-31T23:30:00Z")), "2027-01-01");
    assert.equal(berlinDatum(3, new Date("2026-12-30T12:00:00Z")), "2027-01-02");
    assert.equal(berlinTagesbeginn(new Date("2026-10-20T10:00:00Z")), "2026-10-19T22:00:00.000Z");
    assert.equal(berlinTagesbeginn(new Date("2026-12-01T22:59:00Z")), "2026-11-30T23:00:00.000Z");
});

test("lib/postfach: emailGueltig nimmt genau eine Adresse an (wie antwortSenden, ohne Trenner)", () => {
    assert.equal(PF.emailGueltig("lea@example.org"), true);
    assert.equal(PF.emailGueltig("rechnung@muster-gmbh.de"), true);
    for (const x of ["", null, undefined, "kein-at", "a@b.de,c", "a@b.de;c", "a@b.de c@d.de", "Lea <lea@example.org>", "a@b"])
        assert.equal(PF.emailGueltig(x), false, String(x));
    assert.equal(typeof PF.nachrichtSenden, "function");
    assert.equal(typeof PF.antwortSenden, "function");
});
