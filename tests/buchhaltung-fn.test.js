// Allindrive Autopilot · KI-Buchhaltung: die Functions buchhaltung-ki und beleg-lesen offline, dazu das
// Vormerken von Belegen im Posteingang (posteingang-ki) und die IMAP-Angaben beim Abholen (posteingang-abruf).
// Nachgebaut: Supabase (Tabellen im Speicher, Datei-Speicher), Postfach (lib/postfach.js), Anthropic, ki-guard.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("module");

const DIR = path.join(__dirname, "..", "netlify", "functions");
const sdk = { aufrufe: [], antwort: null };
class APIError extends Error { constructor(status) { super(String(status)); this.status = status; } }
class FakeAnthropic {
    constructor(o) { sdk.optionen = o; this.messages = { create: async (params, opts) => { sdk.aufrufe.push({ params, opts }); return sdk.antwort(params); } }; }
}
Object.assign(FakeAnthropic, { APIError });
const altLaden = Module._load;
Module._load = function (anfrage) { return anfrage === "@anthropic-ai/sdk" ? { default: FakeAnthropic } : altLaden.apply(this, arguments); };

const PF_PFAD = path.join(DIR, "lib", "postfach.js");
const echtPF = require(PF_PFAD);
const netz = {};
require.cache[PF_PFAD].exports = {
    ...echtPF,
    mailAnhaenge: async (cfg, pw, uid, validity) => { netz.anhangAbruf = { cfg, pw, uid, validity }; if (netz.anhangFehler) throw netz.anhangFehler; return netz.anhaenge; },
    neueMails: async () => netz.mails,
    antwortSenden: async (cfg, pw, a) => { netz.gesendet.push(a); if (a.gesendet) await a.gesendet({}); return {}; },
};
const GUARD = path.join(DIR, "lib", "ki-guard.js");
const gate = { ergebnis: { ok: true }, aufrufe: [] };
require.cache[GUARD] = { id: GUARD, filename: GUARD, loaded: true, exports: { subscriptionGate: async (uid, token, g) => { gate.aufrufe.push(g); return gate.ergebnis; } } };

let T, opt, speicher, fetchAufrufe;
const jetzt = () => new Date().toISOString();
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
const antwortObj = (status, daten, kopf) => ({ ok: status < 300, status, json: async () => daten, text: async () => JSON.stringify(daten),
    arrayBuffer: async () => daten, headers: { get: (n) => (kopf || {})[n.toLowerCase()] || null } });
const PDF = Buffer.from("%PDF-1.4 Rechnung 4711");
function neu(o) {
    opt = o || {};
    fetchAufrufe = [];
    speicher = {};
    netz.gesendet = []; netz.anhaenge = []; netz.anhangFehler = null; netz.anhangAbruf = null;
    netz.mails = { mails: [], letzteUid: 40, uidValidity: 7, neuGestartet: false };
    gate.ergebnis = { ok: true }; gate.aufrufe = [];
    sdk.aufrufe = [];
    sdk.antwort = () => ({ content: [{ type: "text", text: JSON.stringify(belegJson()) }], stop_reason: "end_turn" });
    T = {
        schools: [{ id: "schule-1", name: "Fahrschule Test", ki_aus: false, bereiche_aus: [], price_hour: 65, ki_steckbrief: "", autopilot_paket: "teilautonom", autopilot_paket_bis: null }],
        profiles: [{ id: "admin-1", school_id: "schule-1", school_admin: true }, { id: "lehrer-2", school_id: "schule-1", school_admin: false },
            { id: "fremd-9", school_id: "schule-2", school_admin: true }],
        students: [], interessenten: [],
        postfaecher: [{ id: "pf-1", school_id: "schule-1", email: "info@fahrschule-test.de", benutzer: "info@fahrschule-test.de", imap_host: "imap.ionos.de", imap_port: 993,
            imap_tls: true, smtp_host: "smtp.ionos.de", smtp_port: 465, smtp_tls: true, absender_name: "Fahrschule Test", aktiv: true,
            regeln: { autopilot: true, interessenten_anlegen: true, tageslimit: 20 }, letzte_uid: 40, uid_validity: 7, letzter_abruf: null, letzter_fehler: "", fehler_seit: null, verbunden_von: "admin-1" }],
        posteingang: [], beleg_vorschlaege: [], ausgaben: [],
    };
    kiBuchen.aufrufe = [];
    global.fetch = async (url, init) => {
        const u = new URL(String(url));
        const methode = (init && init.method) || "GET";
        const kopf = (init && init.headers) || {};
        fetchAufrufe.push({ url: String(url), methode, auth: kopf.Authorization });
        if (u.pathname === "/auth/v1/user") return opt.uid === null ? antwortObj(401, {}) : antwortObj(200, { id: opt.uid || "admin-1" });
        if (u.pathname.startsWith("/storage/v1/object/")) {
            const schluessel = decodeURIComponent(u.pathname.slice(19));
            if (methode === "POST") { if (opt.speicherKaputt) return antwortObj(500, {}); speicher[schluessel] = { daten: init.body, typ: kopf["Content-Type"] }; return antwortObj(200, {}); }
            return speicher[schluessel] ? antwortObj(200, speicher[schluessel].daten) : antwortObj(404, {});
        }
        if (u.pathname.startsWith("/rest/v1/rpc/")) {
            const name = u.pathname.slice(13);
            if (name === "beleg_vorschlag_naechster") {
                const v = T.beleg_vorschlaege.filter(r => ["holen", "lesen"].includes(r.status) && r.versuche < 3).sort((a, b) => a.created_at < b.created_at ? -1 : 1)[0];
                if (!v) return antwortObj(200, []);
                v.versuche++;
                return antwortObj(200, [JSON.parse(JSON.stringify(v))]);
            }
            if (name === "posteingang_naechster") {
                const z = T.posteingang.filter(r => ["neu", "zu_senden"].includes(r.status) && r.versuche < 3)[0];
                if (!z) return antwortObj(200, []);
                z.versuche++;
                return antwortObj(200, [JSON.parse(JSON.stringify(z))]);
            }
            if (name === "postfach_passwort") return antwortObj(200, opt.ohnePasswort ? null : "geheim");
            if (name === "beleg_vorschlag_ki_buchen") {
                // Wie die Datenbank: nur „bereit“, Dubletten (gleicher Betrag und gleiche Rechnungsnummer) nicht
                const args = JSON.parse(init.body);
                kiBuchen.aufrufe.push(args.p_id);
                const v = T.beleg_vorschlaege.find(r => r.id === args.p_id);
                if (!v || v.status !== "bereit") return antwortObj(200, null);
                if (T.ausgaben.some(a => a.betrag === v.betrag && v.rechnungsnummer && (a.beschreibung || "").includes(v.rechnungsnummer))) return antwortObj(200, null);
                const a = { id: "aus-" + (T.ausgaben.length + 1), school_id: v.school_id, datum: v.datum, betrag: v.betrag, kategorie: v.kategorie, beschreibung: v.beschreibung,
                    ust_satz: v.ust_satz, zahlart: v.zahlart, beleg_pfad: v.beleg_pfad, von_ki: true, erfasst_von: null };
                T.ausgaben.push(a);
                Object.assign(v, { status: "uebernommen", ausgabe_id: a.id, grund: "Von der KI gebucht" });
                return antwortObj(200, a.id);
            }
            throw new Error("RPC unbekannt " + name);
        }
        const tabelle = u.pathname.slice(9);
        if (!T[tabelle]) throw new Error("Tabelle unbekannt " + tabelle);
        const treffer = filtern(T[tabelle], u.searchParams);
        if (methode === "HEAD") return antwortObj(200, null, { "content-range": "0-0/" + treffer.length });
        if (methode === "GET") return antwortObj(200, JSON.parse(JSON.stringify(treffer)));
        if (methode === "PATCH") {
            const daten = JSON.parse(init.body);
            treffer.forEach(z => Object.assign(z, daten));
            return /return=representation/.test(kopf.Prefer || "") ? antwortObj(200, JSON.parse(JSON.stringify(treffer))) : antwortObj(204, null);
        }
        if (methode === "POST") {
            const daten = JSON.parse(init.body);
            if (tabelle === "beleg_vorschlaege" && daten.posteingang_id && T.beleg_vorschlaege.some(r => r.posteingang_id === daten.posteingang_id)) return antwortObj(409, {});
            const zeile = { id: "00000000-0000-4000-8000-" + String(T[tabelle].length + 1).padStart(12, "0"), versuche: 0, created_at: jetzt(), updated_at: jetzt(), ...daten };
            T[tabelle].push(zeile);
            return antwortObj(201, [zeile]);
        }
        throw new Error("Methode " + methode);
    };
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
    process.env.ANTHROPIC_API_KEY = "nur-fuer-den-test";
    process.env.CRON_SECRET = "cron-test";
}
const kiBuchen = { aufrufe: [] };
const vorTagen = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
function belegJson(extra) {
    return { ist_beleg: true, lieferant: "Druckerei Muster GmbH", rechnungsnummer: "RE-4711", datum: "2026-10-14", faellig_am: "2026-10-28", betrag_brutto: 238, betrag_erkannt: true,
        ust_satz: "19", zahlart: "Überweisung", kategorie: "Werbung", beschreibung: "Flyer Schulstart", hinweis: "", ...(extra || {}) };
}
function vorschlag(extra) {
    const v = { id: "00000000-0000-4000-8000-" + String(T.beleg_vorschlaege.length + 100).padStart(12, "0"), school_id: "schule-1", posteingang_id: null, quelle: "upload",
        status: "lesen", versuche: 0, grund: "", beleg_pfad: "schule-1/beleg.pdf", beleg_typ: "application/pdf", beleg_name: "beleg.pdf", lieferant: "", rechnungsnummer: "",
        datum: null, faellig_am: null, betrag: null, ust_satz: null, kategorie: "", beschreibung: "", zahlart: "", hinweis: "", created_at: jetzt(), updated_at: jetzt(), ...(extra || {}) };
    T.beleg_vorschlaege.push(v);
    return v;
}
const KI = () => require(path.join(DIR, "buchhaltung-ki.js"));
const LESEN = () => require(path.join(DIR, "beleg-lesen.js"));
const POST_KI = () => require(path.join(DIR, "posteingang-ki.js"));
const ABRUF = () => require(path.join(DIR, "posteingang-abruf.js"));
const cron = (secret) => ({ httpMethod: "POST", headers: { "x-cron-secret": secret === undefined ? "cron-test" : secret }, body: "{}" });
const zeit = (ms) => ({ getRemainingTimeInMillis: () => ms || 20000 });
const nutzer = (body) => ({ httpMethod: "POST", headers: { authorization: "Bearer nutzer-token" }, body: JSON.stringify(body) });

// ── buchhaltung-ki ──
test("Zeitjob: nur mit Geheimnis", async () => {
    neu();
    assert.equal((await KI().handler(cron("falsch"), zeit())).statusCode, 401);
    assert.equal((await KI().handler({ httpMethod: "GET", headers: {} }, zeit())).statusCode, 405);
});

test("Zeitjob holen: Rechnungs-Anhang aus dem Postfach holen und als Beleg ablegen, dann lesen", async () => {
    neu();
    T.posteingang.push({ id: "mail-1", school_id: "schule-1", postfach_id: "pf-1", imap_uid: 41, imap_validity: 7 });
    const v = vorschlag({ quelle: "email", status: "holen", posteingang_id: "mail-1", beleg_pfad: null, beleg_typ: "", beleg_name: "" });
    netz.anhaenge = [{ name: "AGB.pdf", typ: "application/pdf", groesse: 50, inhalt: Buffer.from("AGB") }, { name: "Rechnung_4711.pdf", typ: "application/pdf", groesse: PDF.length, inhalt: PDF }];
    const r = await KI().handler(cron(), zeit());
    assert.deepEqual(JSON.parse(r.body).ergebnis, ["geholt", "gelesen"]);
    assert.deepEqual(netz.anhangAbruf.uid, 41);
    assert.equal(netz.anhangAbruf.validity, 7);
    assert.equal(netz.anhangAbruf.pw, "geheim");
    assert.match(v.beleg_pfad, /^schule-1\/mail-[0-9a-f-]{36}\.pdf$/);
    assert.equal(speicher["belege/" + v.beleg_pfad].typ, "application/pdf");
    assert.equal(v.beleg_name, "Rechnung_4711.pdf");
    // gleich weitergelesen
    assert.equal(v.status, "bereit");
    assert.equal(v.betrag, 238);
    assert.equal(v.ust_satz, 19);
    assert.equal(v.kategorie, "Werbung");
    assert.equal(v.beschreibung, "Druckerei Muster GmbH · Rechnung RE-4711 · Flyer Schulstart");
    const p = sdk.aufrufe[0].params;
    assert.equal(p.model, "claude-sonnet-5-5");
    assert.equal(p.output_config.format.type, "json_schema");
    assert.equal(p.messages[0].content[0].type, "document");
    assert.equal(Buffer.from(p.messages[0].content[0].source.data, "base64").toString(), PDF.toString());
    assert.ok(fetchAufrufe.filter(f => f.url.includes("/rest/v1/") || f.url.includes("/storage/")).every(f => f.auth === "Bearer service-test"));
});

test("Zeitjob holen: Mail weg, kein Anhang, Postfach getrennt → verständlicher Fehler statt Hänger", async () => {
    neu();
    T.posteingang.push({ id: "mail-1", school_id: "schule-1", postfach_id: "pf-1", imap_uid: 41, imap_validity: 7 });
    const v1 = vorschlag({ quelle: "email", status: "holen", posteingang_id: "mail-1", beleg_pfad: null });
    netz.anhaenge = null;
    await KI().handler(cron(), zeit());
    assert.equal(v1.status, "fehler");
    assert.match(v1.grund, /nicht mehr im Posteingang/);
    neu();
    T.posteingang.push({ id: "mail-1", school_id: "schule-1", postfach_id: "pf-1", imap_uid: 41, imap_validity: 7 });
    const v2 = vorschlag({ quelle: "email", status: "holen", posteingang_id: "mail-1", beleg_pfad: null });
    netz.anhaenge = [{ name: "Vertrag.docx", typ: "application/msword", groesse: 100, inhalt: Buffer.from("x") }];
    await KI().handler(cron(), zeit());
    assert.equal(v2.status, "fehler");
    assert.match(v2.grund, /Kein lesbarer Anhang/);
    neu();
    T.posteingang.push({ id: "mail-1", school_id: "schule-1", postfach_id: "pf-1", imap_uid: 41, imap_validity: 7 });
    const v3 = vorschlag({ quelle: "email", status: "holen", posteingang_id: "mail-1", beleg_pfad: null });
    T.postfaecher = [];
    await KI().handler(cron(), zeit());
    assert.equal(v3.status, "fehler");
    assert.match(v3.grund, /nicht mehr verbunden/);
    // Verbindungsfehler: erst beim dritten Versuch aufgeben
    neu();
    T.posteingang.push({ id: "mail-1", school_id: "schule-1", postfach_id: "pf-1", imap_uid: 41, imap_validity: 7 });
    const v4 = vorschlag({ quelle: "email", status: "holen", posteingang_id: "mail-1", beleg_pfad: null });
    netz.anhangFehler = Object.assign(new Error("Der Server imap.ionos.de antwortet nicht."), { eigen: true });
    const r = await KI().handler(cron(), zeit());
    assert.deepEqual(JSON.parse(r.body).ergebnis, ["nochmal"]);
    assert.equal(v4.status, "holen");
    await KI().handler(cron(), zeit());
    await KI().handler(cron(), zeit());
    assert.equal(v4.status, "fehler");
    assert.match(v4.grund, /antwortet nicht/);
});

test("Zeitjob lesen: kein Beleg, Betrag unklar, KI aus, KI-Fehler mit Wiederholung", async () => {
    neu();
    speicher["belege/schule-1/beleg.pdf"] = { daten: PDF };
    sdk.antwort = () => ({ content: [{ type: "text", text: JSON.stringify(belegJson({ ist_beleg: false })) }], stop_reason: "end_turn" });
    const v1 = vorschlag();
    await KI().handler(cron(), zeit());
    assert.equal(v1.status, "bereit");
    assert.match(v1.grund, /nicht nach einer Rechnung/);
    neu();
    speicher["belege/schule-1/beleg.pdf"] = { daten: PDF };
    sdk.antwort = () => ({ content: [{ type: "text", text: JSON.stringify(belegJson({ betrag_erkannt: false })) }], stop_reason: "end_turn" });
    const v2 = vorschlag();
    await KI().handler(cron(), zeit());
    assert.equal(v2.betrag, null);
    assert.match(v2.grund, /Betrag/);
    neu();
    T.schools[0].ki_aus = true;
    const v3 = vorschlag();
    await KI().handler(cron(), zeit());
    assert.equal(sdk.aufrufe.length, 0);
    assert.equal(v3.status, "fehler");
    assert.match(v3.grund, /KI ist für deine Fahrschule ausgeschaltet/);
    neu();
    T.schools[0].autopilot_paket = null;
    speicher["belege/schule-1/beleg.pdf"] = { daten: PDF };
    const v5 = vorschlag();
    await KI().handler(cron(), zeit());
    assert.equal(sdk.aufrufe.length, 0, "ohne KI-Paket geht nichts an die KI");
    assert.equal(v5.status, "fehler");
    assert.match(v5.grund, /Ohne KI-Paket/);
    neu();
    speicher["belege/schule-1/beleg.pdf"] = { daten: PDF };
    sdk.antwort = () => { throw new APIError(529); };
    const v4 = vorschlag();
    vorschlag({ id: "00000000-0000-4000-8000-000000000999", beleg_pfad: "schule-1/zwei.pdf" });
    let r = await KI().handler(cron(), zeit());
    assert.deepEqual(JSON.parse(r.body).ergebnis, ["nochmal"], "nach einem KI-Fehler bricht der Lauf ab");
    assert.equal(v4.status, "lesen");
    await KI().handler(cron(), zeit());
    r = await KI().handler(cron(), zeit());
    assert.equal(v4.status, "fehler");
    assert.match(v4.grund, /nicht lesen/);
});

test("Vollautonom „Sicher gelesene Belege buchen“: die KI bucht eindeutige Belege selbst – sonst bleibt alles beim Admin", async () => {
    const voll = () => Object.assign(T.schools[0], { autopilot_paket: "vollautonom", ki_autonomie: { belege_buchen: true } });
    neu();
    voll();
    speicher["belege/schule-1/beleg.pdf"] = { daten: PDF };
    sdk.antwort = () => ({ content: [{ type: "text", text: JSON.stringify(belegJson({ datum: vorTagen(3) })) }], stop_reason: "end_turn" });
    const v1 = vorschlag();
    await KI().handler(cron(), zeit());
    assert.equal(v1.status, "uebernommen");
    assert.equal(v1.grund, "Von der KI gebucht");
    assert.equal(T.ausgaben.length, 1);
    assert.deepEqual({ betrag: T.ausgaben[0].betrag, kategorie: T.ausgaben[0].kategorie, von_ki: T.ausgaben[0].von_ki, ust: T.ausgaben[0].ust_satz },
        { betrag: 238, kategorie: "Werbung", von_ki: true, ust: 19 });
    // Dieselbe Rechnung kommt noch einmal: nicht doppelt buchen, sondern vorlegen
    const v2 = vorschlag({ beleg_pfad: "schule-1/beleg.pdf" });
    await KI().handler(cron(), zeit());
    assert.equal(v2.status, "bereit");
    assert.match(v2.grund, /schon gebuchter Beleg/);
    assert.equal(T.ausgaben.length, 1);
    // Unsicher (Gutschrift, über 1.000 €, Steuersatz unklar): bleibt beim Admin, ohne Buchungsversuch
    for (const extra of [{ hinweis: "Gutschrift" }, { betrag_brutto: 1500 }, { ust_satz: "unklar" }]) {
        neu();
        voll();
        speicher["belege/schule-1/beleg.pdf"] = { daten: PDF };
        sdk.antwort = () => ({ content: [{ type: "text", text: JSON.stringify(belegJson({ datum: vorTagen(3), ...extra })) }], stop_reason: "end_turn" });
        const v = vorschlag();
        await KI().handler(cron(), zeit());
        assert.equal(v.status, "bereit", JSON.stringify(extra));
        assert.equal(kiBuchen.aufrufe.length, 0, JSON.stringify(extra));
    }
    // Ohne Schalter oder nur Teilautonom: nie selbst gebucht
    for (const stand of [{ autopilot_paket: "vollautonom", ki_autonomie: {} }, { autopilot_paket: "teilautonom", ki_autonomie: { belege_buchen: true } }]) {
        neu();
        Object.assign(T.schools[0], stand);
        speicher["belege/schule-1/beleg.pdf"] = { daten: PDF };
        sdk.antwort = () => ({ content: [{ type: "text", text: JSON.stringify(belegJson({ datum: vorTagen(3) })) }], stop_reason: "end_turn" });
        const v = vorschlag();
        await KI().handler(cron(), zeit());
        assert.equal(v.status, "bereit", JSON.stringify(stand));
        assert.equal(kiBuchen.aufrufe.length, 0, JSON.stringify(stand));
    }
    // Sofort lesen nach dem Hochladen: das Ergebnis kommt als „von der KI gebucht“ zurück
    neu({ uid: "admin-1" });
    voll();
    speicher["belege/schule-1/beleg.pdf"] = { daten: PDF };
    sdk.antwort = () => ({ content: [{ type: "text", text: JSON.stringify(belegJson({ datum: vorTagen(1) })) }], stop_reason: "end_turn" });
    const v3 = vorschlag();
    const r = await LESEN().handler(nutzer({ id: v3.id }));
    assert.equal(r.statusCode, 200);
    assert.equal(JSON.parse(r.body).vorschlag.status, "uebernommen");
    assert.equal(T.ausgaben.length, 1);
});

// ── beleg-lesen ──
test("Sofort lesen: nur der Admin der eigenen Fahrschule, mit Kontingent; Ergebnis kommt direkt zurück", async () => {
    neu({ uid: null });
    assert.equal((await LESEN().handler(nutzer({ id: "00000000-0000-4000-8000-000000000100" }))).statusCode, 401);
    neu({ uid: "114d1f0a-9947-459d-8009-06282799ca44" });
    assert.equal((await LESEN().handler(nutzer({ id: "00000000-0000-4000-8000-000000000100" }))).statusCode, 403);
    neu({ uid: "lehrer-2" });
    let v = vorschlag();
    let r = await LESEN().handler(nutzer({ id: v.id }));
    assert.equal(r.statusCode, 403);
    neu({ uid: "fremd-9" });
    v = vorschlag();
    assert.equal((await LESEN().handler(nutzer({ id: v.id }))).statusCode, 403);
    neu({ uid: "admin-1" });
    assert.equal((await LESEN().handler(nutzer({ id: "kaputt" }))).statusCode, 400);
    assert.equal((await LESEN().handler(nutzer({ id: "00000000-0000-4000-8000-000000000777" }))).statusCode, 404);
    speicher["belege/schule-1/beleg.pdf"] = { daten: PDF };
    v = vorschlag();
    r = await LESEN().handler(nutzer({ id: v.id }));
    assert.equal(r.statusCode, 200);
    const d = JSON.parse(r.body).vorschlag;
    assert.equal(d.status, "bereit");
    assert.equal(d.lieferant, "Druckerei Muster GmbH");
    assert.equal(d.betrag, 238);
    assert.deepEqual(gate.aufrufe[0], { feature: "beleg", limit: 200 });
    // Schon gelesen: kein zweiter KI-Aufruf
    r = await LESEN().handler(nutzer({ id: v.id }));
    assert.equal(sdk.aufrufe.length, 1);
    assert.equal(JSON.parse(r.body).vorschlag.status, "bereit");
});

test("Sofort lesen: KI der Fahrschule aus, Zeitjob liest schon, KI überlastet", async () => {
    neu({ uid: "admin-1" });
    gate.ergebnis = { ok: false, statusCode: 403, error: "aus" };
    let v = vorschlag();
    let r = await LESEN().handler(nutzer({ id: v.id }));
    assert.equal(r.statusCode, 403);
    assert.match(JSON.parse(r.body).error, /selbst ein/);
    // Der Zeitjob hat den Beleg gerade reserviert (versuche geändert): kein doppeltes Lesen
    neu({ uid: "admin-1" });
    v = vorschlag();
    const echt = global.fetch;
    global.fetch = async (url, init) => { if ((init && init.method) === "PATCH" && String(url).includes("versuche=eq.0")) v.versuche = 1; return echt(url, init); };
    r = await LESEN().handler(nutzer({ id: v.id }));
    global.fetch = echt;
    assert.equal(r.statusCode, 200);
    assert.equal(sdk.aufrufe.length, 0);
    neu({ uid: "admin-1" });
    speicher["belege/schule-1/beleg.pdf"] = { daten: PDF };
    sdk.antwort = () => { throw new APIError(529); };
    v = vorschlag();
    r = await LESEN().handler(nutzer({ id: v.id }));
    assert.equal(r.statusCode, 202);
    assert.match(JSON.parse(r.body).hinweis, /in einer Minute/);
    assert.equal(v.status, "lesen");
    // Ohne KI-Paket: kein Kontingent, keine KI – der Beleg ist gleich zum Selbst-Eintragen bereit
    neu({ uid: "admin-1" });
    T.schools[0].autopilot_paket = null;
    speicher["belege/schule-1/beleg.pdf"] = { daten: PDF };
    v = vorschlag();
    r = await LESEN().handler(nutzer({ id: v.id }));
    assert.equal(r.statusCode, 200);
    assert.equal(JSON.parse(r.body).vorschlag.status, "fehler");
    assert.match(JSON.parse(r.body).vorschlag.grund, /Ohne KI-Paket/);
    assert.equal(gate.aufrufe.length, 0);
    assert.equal(sdk.aufrufe.length, 0);
});

// ── Posteingang: Rechnungen vormerken ──
test("Posteingang: Rechnung an die Fahrschule mit Anhang wird als Beleg vorgemerkt – sonst nicht", async () => {
    const kiAntwort = (extra) => () => ({ content: [{ type: "text", text: JSON.stringify({ kategorie: "geschaeft", zusammenfassung: "Rechnung für Flyer.", antwort_noetig: false,
        vollstaendig: true, betreff: "", antwort: "", hinweis: "Rechnung bezahlen.", eingangsrechnung: true, interessent: { vorname: "", name: "", telefon: "", klasse: "", wunsch: "" }, ...(extra || {}) }) }], stop_reason: "end_turn" });
    const mail = (extra) => {
        const z = { id: "mail-" + (T.posteingang.length + 1), school_id: "schule-1", postfach_id: "pf-1", message_id: "<r@x>", referenzen: "", von_name: "Druckerei", von_email: "rechnung@druck.example",
            betreff: "Rechnung 4711", text: "Anbei die Rechnung.", empfangen_am: jetzt(), status: "neu", grund: "", aktionen: [], versuche: 0, imap_uid: 41, imap_validity: 7, anhaenge: 1,
            entwurf_text: "", entwurf_betreff: "", updated_at: jetzt(), ...(extra || {}) };
        T.posteingang.push(z);
        return z;
    };
    neu();
    sdk.antwort = kiAntwort();
    const m = mail();
    await POST_KI().handler(cron(), zeit());
    assert.equal(m.status, "info");
    assert.match(m.grund, /Rechnung erkannt/);
    assert.equal(T.beleg_vorschlaege.length, 1);
    assert.deepEqual({ ...T.beleg_vorschlaege[0], id: 0, created_at: 0, updated_at: 0 },
        { id: 0, created_at: 0, updated_at: 0, versuche: 0, school_id: "schule-1", posteingang_id: m.id, quelle: "email", status: "holen" });
    // ohne Anhang, ohne Rechnung, Ausgaben ausgeschaltet: nichts vormerken
    for (const [f, k] of [[{ anhaenge: 0 }, {}], [{}, { eingangsrechnung: false }], [{ imap_uid: null }, {}]]) {
        neu();
        sdk.antwort = kiAntwort(k);
        mail(f);
        await POST_KI().handler(cron(), zeit());
        assert.equal(T.beleg_vorschlaege.length, 0, JSON.stringify(f) + JSON.stringify(k));
    }
    neu();
    T.schools[0].bereiche_aus = ["ausgaben"];
    sdk.antwort = kiAntwort();
    mail();
    await POST_KI().handler(cron(), zeit());
    assert.equal(T.beleg_vorschlaege.length, 0);
});

test("Abruf: merkt sich IMAP-UID, UIDVALIDITY und die Zahl der Anhänge", async () => {
    neu();
    const grenze = "g1";
    const roh = ["From: Druckerei <rechnung@druck.example>", "Subject: Rechnung", "Message-ID: <r1@x>", "Content-Type: multipart/mixed; boundary=" + grenze, "",
        "--" + grenze, "Content-Type: text/plain", "", "Anbei.", "--" + grenze, "Content-Type: application/pdf; name=r.pdf", "Content-Disposition: attachment; filename=r.pdf",
        "Content-Transfer-Encoding: base64", "", PDF.toString("base64"), "--" + grenze + "--", ""].join("\r\n");
    netz.mails = { letzteUid: 41, uidValidity: 7, neuGestartet: false, mails: [{ uid: 41, source: Buffer.from(roh) }] };
    await ABRUF().handler(cron());
    const z = T.posteingang[0];
    assert.equal(z.imap_uid, 41);
    assert.equal(z.imap_validity, 7);
    assert.equal(z.anhaenge, 1);
});
