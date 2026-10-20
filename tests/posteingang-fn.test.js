// KI-Verwaltung · Posteingang (v2.126.0): die vier Netlify-Functions offline. Nachgebaut sind die
// Supabase-REST-Schnittstelle (kleine Tabellen im Speicher mit eq/neq/in/gte-Filtern), das Postfach
// (IMAP/SMTP aus lib/postfach.js), das Anthropic-SDK und der KI-Schalter (ki-guard).
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

// Postfach: echte Hilfen (konfiguration, mailZerlegen), Netz nachgebaut
const PF_PFAD = path.join(DIR, "lib", "postfach.js");
const echtPF = require(PF_PFAD);
const netz = {};
require.cache[PF_PFAD].exports = {
    ...echtPF,
    postfachPruefen: async (cfg, pw) => { netz.geprueft = { cfg, pw }; if (netz.pruefenFehler) throw netz.pruefenFehler; return netz.stand; },
    neueMails: async (cfg, pw, letzteUid, validity, max) => { netz.abruf = { cfg, pw, letzteUid, validity, max }; if (netz.abrufFehler) throw netz.abrufFehler; return netz.mails; },
    antwortSenden: async (cfg, pw, a) => {
        if (netz.sendenFehler) throw netz.sendenFehler;
        netz.gesendet.push({ cfg, pw, a });
        if (typeof a.gesendet === "function") { try { await a.gesendet({}); } catch (e) { } }
        return { messageId: "<neu@x>" };
    },
};
const GUARD = path.join(DIR, "lib", "ki-guard.js");
const gate = { ergebnis: { ok: true }, aufrufe: [] };
require.cache[GUARD] = { id: GUARD, filename: GUARD, loaded: true, exports: { subscriptionGate: async (uid, token, g) => { gate.aufrufe.push(g); return gate.ergebnis; } } };

// ── Supabase im Speicher ──
let T, opt, rpcAufrufe, fetchAufrufe;
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
function antwortObj(status, daten, kopf) {
    return { ok: status < 300, status, json: async () => daten, text: async () => JSON.stringify(daten), headers: { get: (n) => (kopf || {})[n.toLowerCase()] || null } };
}
function neu(o) {
    opt = o || {};
    rpcAufrufe = []; fetchAufrufe = [];
    netz.gesendet = []; netz.abruf = null; netz.mails = { mails: [], letzteUid: 40, uidValidity: 7, neuGestartet: false };
    netz.stand = { uidNext: 43, uidValidity: 7 };
    netz.pruefenFehler = null; netz.abrufFehler = null; netz.sendenFehler = null;
    gate.ergebnis = { ok: true }; gate.aufrufe = [];
    sdk.aufrufe = [];
    sdk.antwort = () => ({ content: [{ type: "text", text: JSON.stringify(kiJson()) }], stop_reason: "end_turn" });
    T = {
        schools: [{ id: "schule-1", name: "Fahrschule Test", subtitle: "", price_hour: 65, price_grundgebuehr: 390, packages: [], klassen: ["B"], ki_aus: false, bereiche_aus: [],
            locations: [{ name: "Mitte", street: "Hauptstr. 1", zip: "10115", city: "Berlin", phone: "030 123" }], ki_steckbrief: "Theorie dienstags und donnerstags um 18 Uhr." }],
        profiles: [{ id: "admin-1", school_id: "schule-1", school_admin: true, booking_code: "ABC123" }, { id: "lehrer-2", school_id: "schule-1", school_admin: false },
            { id: "fremd-9", school_id: "schule-2", school_admin: true }],
        students: [{ owner: "lehrer-2", vorname: "Jörg", name: "Groß" }],
        interessenten: [],
        postfaecher: [{ id: "pf-1", school_id: "schule-1", email: "info@fahrschule-test.de", benutzer: "info@fahrschule-test.de", imap_host: "imap.ionos.de", imap_port: 993, imap_tls: true,
            smtp_host: "smtp.ionos.de", smtp_port: 465, smtp_tls: true, absender_name: "Fahrschule Test", aktiv: true, regeln: { autopilot: true, interessenten_anlegen: true, tageslimit: 20 },
            letzte_uid: 40, uid_validity: 7, letzter_abruf: null, letzter_fehler: "", fehler_seit: null, verbunden_von: "admin-1" }],
        posteingang: [],
    };
    global.fetch = async (url, init) => {
        const u = new URL(String(url));
        const methode = (init && init.method) || "GET";
        const kopf = (init && init.headers) || {};
        fetchAufrufe.push({ url: String(url), methode, auth: kopf.Authorization });
        if (u.pathname === "/auth/v1/user") return opt.uid === null ? antwortObj(401, {}) : antwortObj(200, { id: opt.uid || "admin-1" });
        if (u.pathname.startsWith("/rest/v1/rpc/")) {
            const name = u.pathname.slice(13), args = JSON.parse((init && init.body) || "{}");
            rpcAufrufe.push({ name, args, auth: kopf.Authorization });
            if (name === "posteingang_naechster") {
                const z = T.posteingang.filter(r => ["neu", "zu_senden"].includes(r.status) && r.versuche < 3).sort((a, b) => a.empfangen_am < b.empfangen_am ? -1 : 1)[0];
                if (!z) return antwortObj(200, []);
                z.versuche++; z.updated_at = jetzt();
                return antwortObj(200, [JSON.parse(JSON.stringify(z))]);
            }
            if (name === "postfach_passwort") return antwortObj(200, opt.ohnePasswort ? null : "geheim");
            if (name === "_darf_posteingang") return antwortObj(200, opt.darf === undefined ? true : opt.darf);
            if (name === "postfach_speichern") return antwortObj(200, "pf-1");
            throw new Error("RPC unbekannt " + name);
        }
        const tabelle = u.pathname.slice(9);
        if (!T[tabelle]) throw new Error("Tabelle unbekannt " + tabelle);
        const treffer = filtern(T[tabelle], u.searchParams);
        if (methode === "HEAD") return antwortObj(200, null, { "content-range": "0-0/" + treffer.length });
        if (methode === "GET") {
            let z = treffer.slice();
            if (u.searchParams.get("order") === "letzter_abruf.asc.nullsfirst") z.sort((a, b) => (a.letzter_abruf || "") < (b.letzter_abruf || "") ? -1 : 1);
            if (u.searchParams.get("limit")) z = z.slice(0, Number(u.searchParams.get("limit")));
            return antwortObj(200, JSON.parse(JSON.stringify(z)));
        }
        if (methode === "PATCH") {
            const daten = JSON.parse(init.body);
            treffer.forEach(z => Object.assign(z, daten));
            return /return=representation/.test(kopf.Prefer || "") ? antwortObj(200, JSON.parse(JSON.stringify(treffer))) : antwortObj(204, null);
        }
        if (methode === "POST") {
            const daten = JSON.parse(init.body);
            if (tabelle === "posteingang" && daten.message_id && T.posteingang.some(r => r.postfach_id === daten.postfach_id && r.message_id === daten.message_id))
                return antwortObj(409, { code: "23505" });
            const zeile = { id: tabelle + "-" + (T[tabelle].length + 1), versuche: 0, aktionen: [], created_at: jetzt(), updated_at: jetzt(), ...daten };
            T[tabelle].push(zeile);
            return antwortObj(201, [zeile]);
        }
        throw new Error("Methode " + methode);
    };
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
    process.env.ANTHROPIC_API_KEY = "nur-fuer-den-test";
    process.env.CRON_SECRET = "cron-test";
}
function kiJson(extra) {
    return { kategorie: "interessent", zusammenfassung: "Fragt nach dem Preis für Klasse B.", antwort_noetig: true, vollstaendig: true, betreff: "",
        antwort: "Hallo Frau Muster,\n\ndie Grundgebühr beträgt 390 €, eine Fahrstunde 65 €.\n\nViele Grüße\nFahrschule Test", hinweis: "",
        interessent: { vorname: "Lea", name: "Muster", telefon: "0170 1234567", klasse: "B", wunsch: "Klasse B ab November" }, ...(extra || {}) };
}
function mail(extra) {
    const z = { id: "00000000-0000-4000-8000-" + String(T.posteingang.length + 1).padStart(12, "0"), school_id: "schule-1", postfach_id: "pf-1", quelle: "email", message_id: "<m" + (T.posteingang.length + 1) + "@example.org>",
        antwort_auf: "", referenzen: "", von_name: "Lea Muster", von_email: "lea@example.org", betreff: "Anfrage Klasse B",
        text: "Hallo, was kostet bei Ihnen der Führerschein Klasse B? Meine Nummer: 0170 1234567", empfangen_am: new Date(Date.now() - 3600000).toISOString(),
        status: "neu", kategorie: "", zusammenfassung: "", grund: "", entwurf_betreff: "", entwurf_text: "", antwort_text: "", gesendet_am: null, gesendet_von: "",
        aktionen: [], versuche: 0, updated_at: new Date(Date.now() - 60000).toISOString(), ...(extra || {}) };
    T.posteingang.push(z);
    return z;
}
const KI = () => require(path.join(DIR, "posteingang-ki.js"));
const ABRUF = () => require(path.join(DIR, "posteingang-abruf.js"));
const VERBINDEN = () => require(path.join(DIR, "postfach-verbinden.js"));
const SENDEN = () => require(path.join(DIR, "posteingang-senden.js"));
const cron = (secret) => ({ httpMethod: "POST", headers: { "x-cron-secret": secret === undefined ? "cron-test" : secret }, body: "{}" });
const zeit = (ms) => ({ getRemainingTimeInMillis: () => ms || 20000 });
const nutzer = (body) => ({ httpMethod: "POST", headers: { authorization: "Bearer nutzer-token" }, body: JSON.stringify(body) });

// ── posteingang-ki ──
test("KI: vollständige Interessenten-Antwort geht automatisch raus – mit KI-Hinweis, im Verlauf, Interessent angelegt", async () => {
    neu();
    const m = mail();
    const r = await KI().handler(cron(), zeit());
    assert.equal(r.statusCode, 200);
    assert.deepEqual(JSON.parse(r.body).ergebnis, ["gesendet"]);
    // Anfrage an Anthropic
    const p = sdk.aufrufe[0].params;
    assert.equal(p.model, "claude-sonnet-5-5");
    assert.equal(p.output_config.effort, "low");
    assert.equal(p.output_config.format.type, "json_schema");
    assert.equal(p.tools, undefined);
    assert.equal(p.thinking, undefined);
    assert.equal(sdk.optionen.maxRetries, 0);
    const inhalt = p.messages[0].content;
    assert.match(inhalt, /Online-Anmeldung: https:\/\/allindrive\.netlify\.app\/\?buchen=ABC123/);
    assert.match(inhalt, /Theorie dienstags/);
    assert.match(inhalt, /Preis Grundgebühr: 390,00 €/);
    assert.doesNotMatch(inhalt, /Jörg|Groß/); // Schülernamen gehen nie an die KI
    // Gesendet: nur an den Absender, mit KI-Hinweis, als Antwort auf die Mail
    assert.equal(netz.gesendet.length, 1);
    const a = netz.gesendet[0].a;
    assert.equal(a.an, "lea@example.org");
    assert.equal(a.betreff, "Re: Anfrage Klasse B");
    assert.equal(a.antwortAuf, "<m1@example.org>");
    assert.equal(a.automatisch, true);
    assert.match(a.text, /^Hallo Frau Muster/);
    assert.match(a.text, /KI-Assistenz der Fahrschule Test automatisch erstellt/);
    assert.equal(netz.gesendet[0].pw, "geheim");
    // Eintrag
    assert.equal(m.status, "beantwortet_ki");
    assert.equal(m.gesendet_von, "ki");
    assert.equal(m.kategorie, "interessent");
    assert.equal(m.antwort_text, a.text);
    assert.deepEqual(m.aktionen.map(x => x.art), ["ki", "senden", "gesendet"]);
    // Interessent
    assert.equal(T.interessenten.length, 1);
    assert.deepEqual({ ...T.interessenten[0], id: undefined, created_at: undefined, updated_at: undefined, versuche: undefined, aktionen: undefined },
        { id: undefined, created_at: undefined, updated_at: undefined, versuche: undefined, aktionen: undefined, owner: "admin-1", vorname: "Lea", name: "Muster", tel: "0170 1234567",
            klasse: "B", email: "lea@example.org", quelle: "email", status: "offen", notiz: "Per E-Mail: Klasse B ab November" });
    // Alles mit dem Service-Schlüssel
    assert.ok(fetchAufrufe.filter(f => f.url.includes("/rest/v1/")).every(f => f.auth === "Bearer service-test"));
});

test("KI: Absender heißt wie ein Schüler → nur Entwurf, nichts gesendet", async () => {
    neu();
    const m = mail({ von_name: "Joerg Gross", von_email: "jg@example.org" });
    await KI().handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 0);
    assert.equal(m.status, "braucht_dich");
    assert.match(m.grund, /heißt wie ein Schüler/);
    assert.match(m.entwurf_text, /Grundgebühr/);
    assert.equal(m.entwurf_betreff, "Re: Anfrage Klasse B");
});

test("KI: Gesundheitsangaben und ausgeschaltete KI – kein Aufruf bei Anthropic", async () => {
    neu();
    const m = mail({ text: "Ich bin krank, kann ich die Stunde morgen absagen?" });
    await KI().handler(cron(), zeit());
    assert.equal(sdk.aufrufe.length, 0);
    assert.equal(m.status, "braucht_dich");
    assert.match(m.grund, /Gesundheitsangaben/);
    neu();
    T.schools[0].ki_aus = true;
    const m2 = mail();
    await KI().handler(cron(), zeit());
    assert.equal(sdk.aufrufe.length, 0);
    assert.equal(m2.status, "braucht_dich");
    assert.match(m2.grund, /KI ist für deine Fahrschule ausgeschaltet/);
    neu();
    T.schools[0].bereiche_aus = ["posteingang"];
    const m3 = mail();
    await KI().handler(cron(), zeit());
    assert.equal(sdk.aufrufe.length, 0);
    assert.equal(m3.status, "braucht_dich");
});

test("KI: Schüler, Rechnung, Lücken, Autopilot aus, Tageslimit, alte Mail → Entwurf liegt bereit", async () => {
    const faelle = [
        [{ ki: { kategorie: "schueler" } }, /Fahrschüler/],
        [{ ki: { kategorie: "rechnung", hinweis: "Rechnung prüfen." } }, /Rechnung prüfen/],
        [{ ki: { vollstaendig: false, hinweis: "Kursdaten fehlen." } }, /Kursdaten fehlen/],
        [{ ki: { antwort: "Der nächste Kurs beginnt am [bitte ergänzen: Datum]." } }, /fehlen Angaben/],
        [{ regeln: { autopilot: false } }, /Autopilot ist aus/],
        [{ heute: 20 }, /Tageslimit/],
        [{ alt: true }, /Älter als drei Tage/],
        [{ pause: true }, /pausiert oder nicht verbunden/],
    ];
    for (const [f, grund] of faelle) {
        neu();
        if (f.ki) { const j = kiJson(f.ki); sdk.antwort = () => ({ content: [{ type: "text", text: JSON.stringify(j) }], stop_reason: "end_turn" }); }
        if (f.regeln) T.postfaecher[0].regeln = { ...T.postfaecher[0].regeln, ...f.regeln };
        if (f.pause) T.postfaecher[0].aktiv = false;
        for (let i = 0; i < (f.heute || 0); i++) mail({ status: "beantwortet_ki", gesendet_am: jetzt(), message_id: "<alt" + i + "@x>" });
        const m = mail(f.alt ? { empfangen_am: new Date(Date.now() - 4 * 86400000).toISOString() } : {});
        await KI().handler(cron(), zeit());
        assert.equal(netz.gesendet.length, 0, String(grund));
        assert.equal(m.status, "braucht_dich", String(grund));
        assert.match(m.grund, grund);
        assert.ok(m.entwurf_text.length > 0, String(grund));
    }
});

test("KI: Werbung wird Spam (kein Interessent), reine Info braucht keine Antwort", async () => {
    neu();
    sdk.antwort = () => ({ content: [{ type: "text", text: JSON.stringify(kiJson({ kategorie: "werbung", antwort_noetig: false, antwort: "", hinweis: "Phishing" })) }], stop_reason: "end_turn" });
    const m = mail();
    await KI().handler(cron(), zeit());
    assert.equal(m.status, "spam");
    assert.equal(m.entwurf_text, "");
    assert.equal(T.interessenten.length, 0);
    neu();
    sdk.antwort = () => ({ content: [{ type: "text", text: JSON.stringify(kiJson({ kategorie: "pruefung", antwort_noetig: false, antwort: "", hinweis: "Prüftermin bestätigt." })) }], stop_reason: "end_turn" });
    const m2 = mail();
    await KI().handler(cron(), zeit());
    assert.equal(m2.status, "info");
    assert.equal(m2.grund, "Prüftermin bestätigt.");
});

test("KI: Interessent wird nur einmal angelegt und nicht, wenn die Regel aus ist", async () => {
    neu({});
    T.interessenten.push({ id: "i-1", owner: "lehrer-2", email: "lea@example.org" });
    mail();
    await KI().handler(cron(), zeit());
    assert.equal(T.interessenten.length, 1);
    neu();
    T.postfaecher[0].regeln.interessenten_anlegen = false;
    mail();
    await KI().handler(cron(), zeit());
    assert.equal(T.interessenten.length, 0);
    assert.equal(netz.gesendet.length, 1);
});

test("KI: Fehler der KI → der nächste Lauf versucht es noch einmal, nach drei Versuchen liegt die Mail vor", async () => {
    neu();
    sdk.antwort = () => { throw new APIError(529); };
    const m = mail();
    let r = await KI().handler(cron(), zeit());
    assert.deepEqual(JSON.parse(r.body).ergebnis, ["ki_fehler"]); // nur ein Versuch je Mail und Lauf
    assert.equal(m.status, "neu");
    assert.equal(m.versuche, 1);
    await KI().handler(cron(), zeit());
    await KI().handler(cron(), zeit());
    assert.equal(m.versuche, 3);
    assert.equal(m.status, "braucht_dich");
    assert.match(m.grund, /nicht einordnen/);
    // Abgeschnittene Antwort (kein gültiges JSON) zählt ebenso als Fehler
    neu();
    sdk.antwort = () => ({ content: [{ type: "text", text: "{\"kategorie\":\"interess" }], stop_reason: "max_tokens" });
    const m2 = mail();
    r = await KI().handler(cron(), zeit());
    assert.equal(m2.status, "neu");
    // Verweigerung: sofort vorlegen, nicht dreimal fragen
    neu();
    sdk.antwort = () => ({ content: [], stop_reason: "refusal" });
    const m3 = mail();
    await KI().handler(cron(), zeit());
    assert.equal(m3.status, "braucht_dich");
    assert.equal(m3.versuche, 1);
});

test("KI: Senden scheitert → bleibt zum Senden vorgemerkt, nach drei Versuchen liegt es vor", async () => {
    neu();
    netz.sendenFehler = Object.assign(new Error("Der Server smtp.ionos.de antwortet nicht. Bitte Server und Port prüfen."), { eigen: true });
    const m = mail();
    await KI().handler(cron(), zeit());
    assert.equal(m.status, "zu_senden");
    assert.deepEqual(m.aktionen.map(x => x.art), ["ki", "senden", "senden_fehler"]);
    assert.equal(sdk.aufrufe.length, 1);
    // Nächster Lauf: nur senden, keine neue KI-Runde
    netz.sendenFehler = null;
    await KI().handler(cron(), zeit());
    assert.equal(sdk.aufrufe.length, 1);
    assert.equal(m.status, "beantwortet_ki");
    assert.equal(netz.gesendet.length, 1);
    // Dreimal gescheitert
    neu();
    netz.sendenFehler = Object.assign(new Error("Anmeldung abgelehnt."), { eigen: true });
    const m2 = mail();
    for (let i = 0; i < 3; i++) await KI().handler(cron(), zeit());
    assert.equal(m2.status, "braucht_dich");
    assert.match(m2.grund, /Automatisch senden ging nicht: Anmeldung abgelehnt\. Bitte selbst senden\./);
});

test("KI: unterbrochener Sendeversuch wird nie wiederholt (lieber vorlegen als doppelt senden)", async () => {
    neu();
    const m = mail({ status: "zu_senden", versuche: 1, entwurf_text: "Hallo", entwurf_betreff: "Re: x", aktionen: [{ art: "ki" }, { art: "senden" }] });
    await KI().handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 0);
    assert.equal(m.status, "braucht_dich");
    assert.match(m.grund, /Ordner „Gesendet“/);
});

test("KI: Admin hat die Mail inzwischen erledigt → kein Überschreiben, kein Senden", async () => {
    neu();
    const m = mail();
    sdk.antwort = () => { m.status = "erledigt"; return { content: [{ type: "text", text: JSON.stringify(kiJson()) }], stop_reason: "end_turn" }; };
    const r = await KI().handler(cron(), zeit());
    assert.deepEqual(JSON.parse(r.body).ergebnis, ["inzwischen_bearbeitet"]);
    assert.equal(m.status, "erledigt");
    assert.equal(m.entwurf_text, "");
    assert.equal(netz.gesendet.length, 0);
});

test("KI: wenig Restzeit → entscheiden ja, senden erst im nächsten Lauf; zu wenig Zeit → gar nichts anfangen", async () => {
    neu();
    let rest = 9000;
    const ctx = { getRemainingTimeInMillis: () => rest };
    sdk.antwort = () => { rest = 3000; return { content: [{ type: "text", text: JSON.stringify(kiJson()) }], stop_reason: "end_turn" }; };
    const m = mail();
    await KI().handler(cron(), ctx);
    assert.equal(m.status, "zu_senden");
    assert.equal(netz.gesendet.length, 0);
    neu();
    const m2 = mail();
    const r = await KI().handler(cron(), zeit(5000));
    assert.equal(JSON.parse(r.body).bearbeitet, 0);
    assert.equal(m2.versuche, 0);
});

test("KI und Abruf: nur mit dem Zeitjob-Geheimnis", async () => {
    neu();
    for (const fn of [KI(), ABRUF()]) {
        assert.equal((await fn.handler(cron("falsch"), zeit())).statusCode, 401);
        assert.equal((await fn.handler(cron(""), zeit())).statusCode, 401);
        assert.equal((await fn.handler({ httpMethod: "GET", headers: {} }, zeit())).statusCode, 405);
    }
    delete process.env.CRON_SECRET;
    assert.equal((await KI().handler(cron("undefined"), zeit())).statusCode, 401);
});

// ── posteingang-abruf ──
const roh = (kopf, text) => Buffer.from([...kopf, "Content-Type: text/plain; charset=utf-8", "", text, ""].join("\r\n"));
test("Abruf: neue Mails landen im Posteingang, Automatisches als Info, Stand wird weitergezählt", async () => {
    neu();
    netz.mails = { letzteUid: 42, uidValidity: 7, neuGestartet: false, mails: [
        { uid: 41, source: roh(["From: Lea Muster <lea@example.org>", "Subject: Anfrage", "Message-ID: <a1@example.org>", "Date: Mon, 19 Oct 2026 10:00:00 +0200"],
            "Was kostet Klasse B?\n\nAm 18.10.2026 um 09:00 schrieb Fahrschule <info@x.de>:\n> alt") },
        { uid: 42, source: roh(["From: Max <max@example.org>", "Subject: Abwesend", "Message-ID: <a2@example.org>", "Auto-Submitted: auto-replied"], "Bin im Urlaub.") },
    ] };
    const r = await ABRUF().handler(cron());
    assert.equal(r.statusCode, 200);
    assert.deepEqual(JSON.parse(r.body), { postfaecher: 1, neu: 2 });
    assert.deepEqual(netz.abruf.letzteUid, 40);
    assert.equal(netz.abruf.max, 10);
    assert.equal(netz.abruf.pw, "geheim");
    const [a, b] = T.posteingang;
    assert.equal(a.status, "neu");
    assert.equal(a.text, "Was kostet Klasse B?");
    assert.equal(a.von_email, "lea@example.org");
    assert.equal(a.message_id, "<a1@example.org>");
    assert.equal(a.empfangen_am, "2026-10-19T08:00:00.000Z");
    assert.equal(b.status, "info");
    assert.equal(b.grund, "Automatische Antwort");
    assert.equal(T.postfaecher[0].letzte_uid, 42);
    assert.equal(T.postfaecher[0].letzter_fehler, "");
    assert.ok(T.postfaecher[0].letzter_abruf);
    // Dieselben Mails noch einmal (z. B. nach einem Abbruch): keine Doppelten, Abruf hängt nicht
    const r2 = await ABRUF().handler(cron());
    assert.deepEqual(JSON.parse(r2.body), { postfaecher: 1, neu: 0 });
    assert.equal(T.posteingang.length, 2);
});

test("Abruf: KI aus → nichts abholen; Fehler → vermerkt, nach drei Tagen pausiert", async () => {
    neu();
    T.schools[0].bereiche_aus = ["ki"];
    await ABRUF().handler(cron());
    assert.equal(netz.abruf, null);
    assert.match(T.postfaecher[0].letzter_fehler, /ausgeschaltet/);
    assert.equal(T.posteingang.length, 0);
    neu();
    netz.abrufFehler = Object.assign(new Error("Anmeldung abgelehnt. Prüfe E-Mail-Adresse und Passwort."), { eigen: true });
    await ABRUF().handler(cron());
    const pf = T.postfaecher[0];
    assert.match(pf.letzter_fehler, /Anmeldung abgelehnt/);
    assert.ok(pf.fehler_seit);
    assert.equal(pf.aktiv, true);
    assert.equal(pf.letzte_uid, 40);
    pf.fehler_seit = new Date(Date.now() - 4 * 86400000).toISOString();
    await ABRUF().handler(cron());
    assert.equal(pf.aktiv, false);
    // Interner Fehlertext geht nicht in die Tabelle
    neu();
    netz.abrufFehler = new Error("ECONNRESET 10.0.0.1:993 interner Stack");
    await ABRUF().handler(cron());
    assert.equal(T.postfaecher[0].letzter_fehler, "Abholen fehlgeschlagen.");
});

// ── postfach-verbinden ──
test("Verbinden: nur Fahrschul-Admin, mit Kontingent; Passwort geht nur an den Tresor", async () => {
    neu({ uid: null });
    const body = { anbieter: "ionos", email: "info@fahrschule-test.de", passwort: "geheim", absender_name: "Fahrschule Test" };
    assert.equal((await VERBINDEN().handler(nutzer(body))).statusCode, 401);
    neu({ uid: "114d1f0a-9947-459d-8009-06282799ca44" });
    assert.equal((await VERBINDEN().handler(nutzer(body))).statusCode, 403);
    neu({ uid: "lehrer-2" });
    let r = await VERBINDEN().handler(nutzer(body));
    assert.equal(r.statusCode, 403);
    assert.match(JSON.parse(r.body).error, /Nur der Fahrschul-Admin/);
    neu({ uid: "admin-1" });
    gate.ergebnis = { ok: false, statusCode: 403, error: "KI aus" };
    r = await VERBINDEN().handler(nutzer(body));
    assert.equal(r.statusCode, 403);
    assert.match(JSON.parse(r.body).error, /KI ist für deine Fahrschule ausgeschaltet/);
    neu({ uid: "admin-1" });
    r = await VERBINDEN().handler(nutzer({ ...body, passwort: "" }));
    assert.equal(r.statusCode, 400);
    assert.deepEqual(gate.aufrufe[0], { feature: "postfach", limit: 20, ohneAbo: true });
    netz.pruefenFehler = Object.assign(new Error("Anmeldung abgelehnt. Prüfe E-Mail-Adresse und Passwort."), { eigen: true });
    r = await VERBINDEN().handler(nutzer(body));
    assert.equal(r.statusCode, 400);
    assert.match(JSON.parse(r.body).error, /Anmeldung abgelehnt/);
    assert.equal(rpcAufrufe.filter(x => x.name === "postfach_speichern").length, 0);
});

test("Verbinden: Erfolg speichert Einstellungen ab jetzt; erneut verbunden → dort weiter, wo der Abruf stand", async () => {
    neu({ uid: "admin-1" });
    T.postfaecher = [];
    let r = await VERBINDEN().handler(nutzer({ anbieter: "ionos", email: "Info@Fahrschule-Test.de", passwort: "geheim", absender_name: "Fahrschule Test" }));
    assert.equal(r.statusCode, 200);
    assert.equal(netz.geprueft.pw, "geheim");
    const s = rpcAufrufe.find(x => x.name === "postfach_speichern");
    assert.equal(s.auth, "Bearer service-test");
    assert.equal(s.args.p_school, "schule-1");
    assert.equal(s.args.p_user, "admin-1");
    assert.equal(s.args.p_passwort, "geheim");
    assert.equal(s.args.p_cfg.email, "info@fahrschule-test.de");
    assert.equal(s.args.p_cfg.imap_host, "imap.ionos.de");
    assert.equal(s.args.p_cfg.letzte_uid, 42); // nur Neues ab jetzt
    assert.equal(s.args.p_cfg.uid_validity, 7);
    assert.equal(JSON.stringify(s.args.p_cfg).includes("geheim"), false);
    neu({ uid: "admin-1" });
    T.postfaecher[0].letzte_uid = 30;
    await VERBINDEN().handler(nutzer({ anbieter: "ionos", email: "info@fahrschule-test.de", passwort: "neu" }));
    assert.equal(rpcAufrufe.find(x => x.name === "postfach_speichern").args.p_cfg.letzte_uid, 30);
    neu({ uid: "admin-1" });
    T.postfaecher[0].letzte_uid = 30;
    netz.stand = { uidNext: 5, uidValidity: 99 }; // Postfach neu angelegt
    await VERBINDEN().handler(nutzer({ anbieter: "ionos", email: "info@fahrschule-test.de", passwort: "neu" }));
    assert.equal(rpcAufrufe.find(x => x.name === "postfach_speichern").args.p_cfg.letzte_uid, 4);
});

// ── posteingang-senden ──
test("Von Hand senden: Admin/Büro, ohne KI-Hinweis, an den Absender; Eintrag wird beantwortet", async () => {
    neu({ uid: "admin-1" });
    const m = mail({ status: "braucht_dich", entwurf_text: "Hallo", entwurf_betreff: "Re: Anfrage Klasse B" });
    const r = await SENDEN().handler(nutzer({ id: m.id, betreff: "Re: Anfrage Klasse B", text: "Hallo Frau Muster,\n\ngern!\n\nViele Grüße" }));
    assert.equal(r.statusCode, 200);
    const a = netz.gesendet[0].a;
    assert.equal(a.an, "lea@example.org");
    assert.equal(a.automatisch, false);
    assert.doesNotMatch(a.text, /KI-Assistenz/);
    assert.equal(a.antwortAuf, m.message_id);
    assert.equal(m.status, "beantwortet");
    assert.equal(m.gesendet_von, "admin-1");
    assert.deepEqual(m.aktionen.map(x => x.art), ["senden", "gesendet"]);
    assert.equal(rpcAufrufe.find(x => x.name === "_darf_posteingang").auth, "Bearer nutzer-token");
});

test("Von Hand senden: Rechte, Lücken, laufende KI, gleichzeitiges Senden, Sendefehler", async () => {
    neu({ uid: "lehrer-2", darf: false });
    let m = mail({ status: "braucht_dich" });
    let r = await SENDEN().handler(nutzer({ id: m.id, text: "Hallo" }));
    assert.equal(r.statusCode, 403);
    neu({ uid: "admin-1" });
    m = mail({ status: "braucht_dich" });
    r = await SENDEN().handler(nutzer({ id: m.id, text: "Kurs ab [bitte ergänzen: Datum]" }));
    assert.equal(r.statusCode, 400);
    m.status = "zu_senden";
    r = await SENDEN().handler(nutzer({ id: m.id, text: "Hallo" }));
    assert.equal(r.statusCode, 409);
    assert.equal(netz.gesendet.length, 0);
    // Ein anderer hat den Eintrag gerade geändert (updated_at passt nicht mehr)
    neu({ uid: "admin-1" });
    m = mail({ status: "braucht_dich" });
    const echtFetch = global.fetch;
    global.fetch = async (url, init) => { if ((init && init.method) === "PATCH") m.updated_at = jetzt() + "x"; return echtFetch(url, init); };
    r = await SENDEN().handler(nutzer({ id: m.id, text: "Hallo" }));
    global.fetch = echtFetch;
    assert.equal(r.statusCode, 409);
    assert.equal(netz.gesendet.length, 0);
    // Neue, noch nicht von der KI bearbeitete Mail: verlässt beim Senden den Status "neu"
    neu({ uid: "admin-1" });
    m = mail({ status: "neu" });
    netz.sendenFehler = Object.assign(new Error("Der Server smtp.ionos.de antwortet nicht."), { eigen: true });
    r = await SENDEN().handler(nutzer({ id: m.id, text: "Hallo" }));
    assert.equal(r.statusCode, 502);
    assert.match(JSON.parse(r.body).error, /antwortet nicht/);
    assert.equal(m.status, "braucht_dich");
    assert.deepEqual(m.aktionen.map(x => x.art), ["senden", "senden_fehler"]);
    // Kein Postfach
    neu({ uid: "admin-1" });
    m = mail({ status: "braucht_dich" });
    T.postfaecher = [];
    r = await SENDEN().handler(nutzer({ id: m.id, text: "Hallo" }));
    assert.equal(r.statusCode, 409);
    assert.match(JSON.parse(r.body).error, /kein Postfach verbunden/);
});
