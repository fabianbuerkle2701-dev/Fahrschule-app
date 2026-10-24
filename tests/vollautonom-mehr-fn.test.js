// Mehr KI-Autonomie (Fabian 23.10.2026: „Die KI soll noch viel mehr übernehmen und autonom erledigen“): die Zeitjobs
// vollautonom-nachfassen, vollautonom-anmeldungen und vollautonom-unterlagen offline.
// Nachgebaut: Supabase-REST (Tabellen im Speicher, Spaltenauswahl mit data->>feld, RPCs) und das Senden über das Postfach.
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
        if (typeof a.gesendet === "function") await a.gesendet({});
        return { messageId: "<x@y>" };
    },
};
const NACHFASSEN = require(path.join(DIR, "vollautonom-nachfassen.js"));
const ANMELDUNGEN = require(path.join(DIR, "vollautonom-anmeldungen.js"));
const UNTERLAGEN = require(path.join(DIR, "vollautonom-unterlagen.js"));

// Mittwoch, 21.10.2026, 10:00 Uhr in Berlin
const MITTWOCH = new Date("2026-10-21T08:00:00Z");
const vor = (stunden, ab) => new Date((ab || MITTWOCH).getTime() - stunden * 3600000).toISOString();
let T, jetzt, bestaetigt, rpcFehler;

// ->> wie in Postgres: Text, null bleibt null
const alsText = (w) => (w == null ? null : typeof w === "object" ? JSON.stringify(w) : String(w));
function auswahl(zeile, select) {
    if (!select || select === "*") return zeile;
    const o = {};
    select.split(",").forEach((teil) => {
        const m = teil.match(/^(\w+):data->>(\w+)$/);
        if (m) o[m[1]] = alsText((zeile.data || {})[m[2]]);
        else if (/^\w+$/.test(teil)) o[teil] = zeile[teil];
        else throw new Error("Auswahl " + teil);
    });
    return o;
}
function neu(o) {
    const opt = o || {};
    netz.gesendet = []; netz.fehler = null; bestaetigt = []; rpcFehler = new Set(opt.rpcFehler || []);
    jetzt = opt.jetzt || MITTWOCH;
    T = {
        schools: [{ id: "schule-1", name: "Fahrschule Test", ki_aus: false, bereiche_aus: [], autopilot_paket: "vollautonom", autopilot_paket_bis: null,
            ki_autonomie: { interessenten_nachfassen: true, anmeldungen_uebernehmen: true, unterlagen_erinnern: true }, ...(opt.schule || {}) }],
        postfaecher: [{ id: "pf-1", school_id: "schule-1", email: "info@fahrschule-test.de", aktiv: true, letzter_fehler: "", ...(opt.postfach || {}) }],
        profiles: opt.profiles || [{ id: "admin-1", school_id: "schule-1", display_name: "Anna Admin", school_admin: true },
            { id: "lehrer-1", school_id: "schule-1", display_name: "Lars Lehrer", school_admin: false },
            { id: "fremd-1", school_id: "schule-2", display_name: "Fremd", school_admin: true }],
        nachrichten_ausgang: opt.ausgang || [],
        interessenten: opt.interessenten || [],
        posteingang: opt.posteingang || [],
        students: opt.students || [],
        student_assignment_log: [],
        pruefungen: opt.pruefungen || [],
    };
    let zaehler = 0;
    global.fetch = async (url, init) => {
        const u = new URL(String(url));
        const methode = (init && init.method) || "GET";
        const antworten = (status, daten, kopf) => ({ ok: status < 300, status, json: async () => daten, text: async () => JSON.stringify(daten), headers: { get: (n) => (kopf || {})[n.toLowerCase()] || null } });
        if (u.pathname.startsWith("/rest/v1/rpc/")) {
            const name = u.pathname.slice(13);
            const args = JSON.parse(init.body);
            if (name === "postfach_passwort") return antworten(200, "geheim");
            if (name === "school_pruefungen") return antworten(200, JSON.parse(JSON.stringify(args.p_school_id === "schule-1" ? T.pruefungen : [])));
            if (name === "school_anmeldung_bestaetigen") {
                const s = T.students.find((x) => x.id === args.p_student_id);
                if (!s || s.data.pending !== true || rpcFehler.has(s.id)) return antworten(400, { message: "Diese Anmeldung ist schon erledigt." });
                s.data.pending = false;
                bestaetigt.push(s.id);
                return antworten(200, { name: s.data.vorname + " " + s.data.name, bonus: null, geworben_durch: null });
            }
            throw new Error("RPC unbekannt " + name);
        }
        const tabelle = u.pathname.slice(9);
        const p = u.searchParams;
        const filter = [...p].filter(([k]) => !["select", "order", "limit", "offset"].includes(k));
        const passt = (z) => filter.every(([k, v]) => {
            const w = z[k];
            if (v.startsWith("eq.")) return String(w) === v.slice(3);
            if (v.startsWith("in.(")) return v.slice(4, -1).split(",").includes(String(w));
            if (v.startsWith("gte.")) return w != null && new Date(w) >= new Date(v.slice(4));
            throw new Error("Filter " + k + "=" + v);
        });
        let zeilen = (T[tabelle] || []).filter(passt);
        if (methode === "HEAD") return antworten(200, null, { "content-range": "0-0/" + zeilen.length });
        if (methode === "GET") {
            if (p.get("order") === "id") zeilen = zeilen.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
            const ab = Number(p.get("offset") || 0);
            zeilen = zeilen.slice(ab, p.get("limit") ? ab + Math.min(Number(p.get("limit")), 1000) : ab + 1000);
            return antworten(200, JSON.parse(JSON.stringify(zeilen.map((z) => auswahl(z, p.get("select"))))));
        }
        if (methode === "PATCH") { const d = JSON.parse(init.body); zeilen.forEach((z) => Object.assign(z, d)); return antworten(204, null); }
        if (methode === "POST") {
            const d = JSON.parse(init.body);
            if (tabelle === "nachrichten_ausgang" && T[tabelle].some((z) => z.school_id === d.school_id && z.schluessel === d.schluessel)) return antworten(201, []);
            const zeile = { id: tabelle.slice(0, 3) + "-" + (++zaehler), created_at: jetzt.toISOString(), ...d };
            T[tabelle].push(zeile);
            return antworten(201, [zeile]);
        }
        throw new Error("Methode " + methode);
    };
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
    process.env.CRON_SECRET = "cron-test";
    [NACHFASSEN, ANMELDUNGEN, UNTERLAGEN].forEach((F) => { F.uhr.jetzt = () => jetzt; });
}
const cron = () => ({ httpMethod: "POST", headers: { "x-cron-secret": "cron-test" }, body: "{}" });
const zeit = () => ({ getRemainingTimeInMillis: () => 20000 });
const AUS = [{ autopilot_paket: "teilautonom" }, { ki_autonomie: {} }, { ki_autonomie: { interessenten_nachfassen: "ja", anmeldungen_uebernehmen: "ja", unterlagen_erinnern: "ja" } },
    { ki_aus: true }, { bereiche_aus: ["ki"] }, { autopilot_paket_bis: "2026-10-01T00:00:00Z" }];

// ── Interessenten nachfassen ─────────────────────────────────────────────

function interessent(id, extra) {
    return { id, owner: "lehrer-1", vorname: "Lena", name: "Kurz", email: "lena@example.org", klasse: "B", status: "offen", follow_up_am: null, created_at: vor(72), ...(extra || {}) };
}

test("Nachfassen: Interessent ohne Antwort bekommt den Text des Autopiloten – danach „In Kontakt“, Wiedervorlage in drei Tagen", async () => {
    neu({ interessenten: [interessent("i-1")] });
    const r = await NACHFASSEN.handler(cron(), zeit());
    assert.equal(r.statusCode, 200);
    assert.equal(netz.gesendet.length, 1);
    const a = netz.gesendet[0].a;
    assert.equal(a.an, "lena@example.org");
    assert.equal(a.betreff, "Deine Anfrage bei der Fahrschule Test");
    assert.equal(a.erzeugt, true, "Auto-Submitted: auto-generated");
    assert.match(a.text, /^Hallo Lena,\n\ndanke für dein Interesse an der Fahrschule Test! Hast du noch Fragen zu Klasse B/);
    assert.match(a.text, /\n—\nDiese Nachricht wurde automatisch verschickt\.$/);
    assert.equal(T.nachrichten_ausgang.length, 1);
    assert.deepEqual([T.nachrichten_ausgang[0].art, T.nachrichten_ausgang[0].status, T.nachrichten_ausgang[0].bezug, T.nachrichten_ausgang[0].gesendet_von],
        ["nachfassen", "gesendet", "i-1", null]);
    assert.equal(T.interessenten[0].status, "kontaktiert");
    assert.equal(T.interessenten[0].follow_up_am, "2026-10-24");
    // Ein zweiter Lauf am selben Tag schickt nichts noch einmal
    await NACHFASSEN.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 1);
});

test("Nachfassen: nur mit Paket, Schalter, KI und Bereich Interessenten – werktags von 9 bis 17 Uhr, mit Postfach", async () => {
    for (const schule of [...AUS, { bereiche_aus: ["interessenten"] }]) {
        neu({ schule, interessenten: [interessent("i-1")] });
        await NACHFASSEN.handler(cron(), zeit());
        assert.equal(netz.gesendet.length, 0, JSON.stringify(schule));
    }
    for (const j of [new Date("2026-10-24T08:00:00Z"), new Date("2026-10-21T06:30:00Z"), new Date("2026-10-21T15:00:00Z")]) {
        neu({ jetzt: j, interessenten: [interessent("i-1", { created_at: vor(72, j) })] });
        assert.equal(JSON.parse((await NACHFASSEN.handler(cron(), zeit())).body).ruhe, true, j.toISOString());
        assert.equal(netz.gesendet.length, 0);
    }
    for (const postfach of [{ aktiv: false }, { letzter_fehler: "Anmeldung fehlgeschlagen" }]) {
        neu({ postfach, interessenten: [interessent("i-1")] });
        await NACHFASSEN.handler(cron(), zeit());
        assert.equal(netz.gesendet.length, 0, JSON.stringify(postfach));
    }
    neu();
    assert.equal((await NACHFASSEN.handler({ httpMethod: "POST", headers: { "x-cron-secret": "falsch" }, body: "{}" }, zeit())).statusCode, 401);
    assert.equal((await NACHFASSEN.handler({ httpMethod: "GET", headers: {} }, zeit())).statusCode, 405);
});

test("Nachfassen: nicht, wer noch nicht dran ist, keine Adresse hat, gerade schreibt oder schon zweimal automatisch bekam", async () => {
    const faelle = [
        [interessent("i-2", { created_at: vor(30) }), [], [], "erst seit 30 Stunden da"],
        [interessent("i-3", { status: "angemeldet" }), [], [], "angemeldet"],
        [interessent("i-4", { status: "kontaktiert", follow_up_am: "2026-10-23" }), [], [], "Wiedervorlage erst übermorgen"],
        [interessent("i-5", { email: "" }), [], [], "ohne E-Mail"],
        [interessent("i-6", { email: "kaputt@" }), [], [], "ungültige Adresse"],
        [interessent("i-7"), [{ school_id: "schule-1", von_email: "LENA@example.org ", empfangen_am: vor(20), gesendet_am: null }], [], "hat gestern geschrieben"],
        [interessent("i-8"), [{ school_id: "schule-1", von_email: "lena@example.org", empfangen_am: vor(200), gesendet_am: vor(40) }], [], "Antwort aus dem Posteingang vorgestern"],
        [interessent("i-9", { status: "kontaktiert", follow_up_am: "2026-10-20" }), [],
            [{ school_id: "schule-1", art: "nachfassen", bezug: "i-9", status: "gesendet", gesendet_von: "admin-1", created_at: vor(48) }], "vor zwei Tagen nachgefasst"],
        [interessent("i-10", { status: "kontaktiert", follow_up_am: "2026-10-20" }), [],
            [{ school_id: "schule-1", art: "nachfassen", bezug: "i-10", status: "gesendet", gesendet_von: null, created_at: vor(24 * 10) },
                { school_id: "schule-1", art: "nachfassen", bezug: "i-10", status: "gesendet", gesendet_von: null, created_at: vor(24 * 5) }], "schon zweimal automatisch"],
        [interessent("i-11", { owner: "fremd-1" }), [], [], "Interessent einer anderen Fahrschule"],
    ];
    for (const [i, posteingang, ausgang, warum] of faelle) {
        neu({ interessenten: [i], posteingang, ausgang });
        await NACHFASSEN.handler(cron(), zeit());
        assert.equal(netz.gesendet.length, 0, warum);
    }
    // Einmal von Hand nachgefasst, einmal automatisch: ein zweites automatisches darf noch
    neu({ interessenten: [interessent("i-12", { status: "kontaktiert", follow_up_am: "2026-10-21" })],
        ausgang: [{ school_id: "schule-1", art: "nachfassen", bezug: "i-12", status: "gesendet", gesendet_von: "admin-1", created_at: vor(24 * 10) },
            { school_id: "schule-1", art: "nachfassen", bezug: "i-12", status: "gesendet", gesendet_von: null, created_at: vor(24 * 5) }] });
    await NACHFASSEN.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 1);
    assert.match(netz.gesendet[0].a.text, /wir wollten kurz nachhören, ob du dich schon für Klasse B entschieden hast/);
});

test("Nachfassen: fällige Wiedervorlagen zuerst, höchstens 10 je Lauf; Senden schiefgegangen = Fehler im Ausgang, kein Vermerk", async () => {
    const liste = Array.from({ length: 12 }, (_, n) => interessent("i-" + (100 + n), { email: "p" + n + "@example.org", created_at: vor(100 + n) }));
    liste.push(interessent("i-wv", { status: "kontaktiert", follow_up_am: "2026-10-21", email: "wv@example.org" }));
    neu({ interessenten: liste });
    await NACHFASSEN.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 10);
    assert.equal(netz.gesendet[0].a.an, "wv@example.org");
    assert.equal(netz.gesendet[1].a.an, "p11@example.org", "dann die am längsten Wartenden");
    neu({ interessenten: [interessent("i-1")] });
    netz.fehler = "Der Mailserver hat die Anmeldung abgelehnt.";
    const r = JSON.parse((await NACHFASSEN.handler(cron(), zeit())).body);
    assert.equal(r.ergebnis["schule-1"], "senden_fehler");
    assert.equal(T.nachrichten_ausgang[0].status, "fehler");
    assert.equal(T.interessenten[0].status, "offen");
});

// ── Online-Anmeldungen übernehmen ────────────────────────────────────────

function anmeldung(id, extra, data) {
    return { id, owner: "lehrer-1", created_at: vor(1), ...(extra || {}),
        data: { vorname: "Mia", name: "Schulz", tel: "0151 2345678", geb: "2008-03-01", pending: true, enrolledAt: "2026-10-21", ...(data || {}) } };
}
function schueler(id, data, extra) {
    return { id, owner: "lehrer-1", created_at: "2026-03-01T10:00:00Z", ...(extra || {}), data: { vorname: "Tom", name: "Becker", tel: "0170 1111111", ...(data || {}) } };
}

test("Anmeldungen: eine eindeutige Online-Anmeldung wird übernommen und steht im Protokoll – auch nachts, ohne Nachricht", async () => {
    neu({ jetzt: new Date("2026-10-24T22:30:00Z"), students: [schueler("s-1"), anmeldung("a-1", { created_at: "2026-10-24T20:00:00Z" })] });
    const r = JSON.parse((await ANMELDUNGEN.handler(cron(), zeit())).body);
    assert.equal(r.uebernommen, 1);
    assert.deepEqual(bestaetigt, ["a-1"]);
    assert.equal(T.students[1].data.pending, false);
    assert.equal(netz.gesendet.length, 0);
    assert.equal(T.student_assignment_log.length, 1);
    const e = T.student_assignment_log[0];
    assert.deepEqual([e.school_id, e.student_id, e.aktion, e.student_name, e.durch_user, e.durch_name, e.von_teacher, e.nach_name],
        ["schule-1", "a-1", "akte", "Mia Schulz · Online-Anmeldung von der KI übernommen", "admin-1", "KI (Autopilot)", "lehrer-1", "Lars Lehrer"]);
    // Nichts mehr offen: der nächste Lauf tut nichts
    await ANMELDUNGEN.handler(cron(), zeit());
    assert.equal(bestaetigt.length, 1);
});

test("Anmeldungen: nur mit Paket, Schalter, KI, Interessenten und Online-Anmeldung an – und nur mit Admin", async () => {
    for (const schule of [...AUS, { bereiche_aus: ["interessenten"] }, { bereiche_aus: ["anmeldung"] }]) {
        neu({ schule, students: [anmeldung("a-1")] });
        await ANMELDUNGEN.handler(cron(), zeit());
        assert.equal(bestaetigt.length, 0, JSON.stringify(schule));
    }
    neu({ students: [anmeldung("a-1")], profiles: [{ id: "lehrer-1", school_id: "schule-1", display_name: "Lars Lehrer", school_admin: false }] });
    assert.equal(JSON.parse((await ANMELDUNGEN.handler(cron(), zeit())).body).ergebnis["schule-1"], "kein_admin");
    assert.equal(bestaetigt.length, 0);
    assert.equal((await ANMELDUNGEN.handler({ httpMethod: "POST", headers: {}, body: "{}" }, zeit())).statusCode, 401);
});

test("Anmeldungen: was nicht eindeutig ist, bleibt beim Menschen", async () => {
    const faelle = [
        [[anmeldung("a-1", { created_at: vor(0.1) })], "erst seit sechs Minuten da"],
        [[anmeldung("a-1", {}, { name: "Schulz2" })], "Ziffer im Namen"],
        [[anmeldung("a-1", {}, { vorname: "www.billig-pillen.example" })], "Link statt Name"],
        [[anmeldung("a-1", {}, { tel: "" })], "ohne Telefonnummer"],
        [[anmeldung("a-1", {}, { tel: "12 34" })], "Nummer zu kurz"],
        [[anmeldung("a-1", {}, { referredByCode: "TOM-7" })], "mit Empfehlungscode (Bonus)"],
        [[anmeldung("a-1", {}, { archived: true })], "archiviert"],
        [[anmeldung("a-1", {}, { dataDeletedAt: "2026-10-22" })], "Daten gelöscht"],
        [[schueler("s-1", { vorname: "Mia", name: "Schulz", tel: "0171 9999999", archived: true }), anmeldung("a-1")], "ehemalige Schülerin mit gleichem Namen"],
        [[schueler("s-1", { vorname: "schulz", name: " MIA ", tel: "0171 9999999" }), anmeldung("a-1")], "gleicher Name, andere Reihenfolge"],
        [[schueler("s-1", { tel: "+49 151 2345678" }), anmeldung("a-1")], "gleiche Nummer bei jemand anderem"],
        [[anmeldung("a-1"), anmeldung("a-2", {}, { tel: "0160 5555555" })], "zweimal angemeldet"],
    ];
    for (const [students, warum] of faelle) {
        neu({ students });
        await ANMELDUNGEN.handler(cron(), zeit());
        assert.equal(bestaetigt.length, 0, warum);
    }
    // Umlaute, Bindestrich und Apostroph sind Namen
    neu({ students: [anmeldung("a-1", {}, { vorname: "Zoë-Marie", name: "O’Brien Çelik" })] });
    await ANMELDUNGEN.handler(cron(), zeit());
    assert.deepEqual(bestaetigt, ["a-1"]);
});

test("Anmeldungen: älteste zuerst, höchstens 20 je Lauf, ein Fehler hält die anderen nicht auf; Doppelte auch jenseits von 1.000 Schülern", async () => {
    const viele = Array.from({ length: 22 }, (_, n) => anmeldung("a-" + String(n).padStart(2, "0"), { created_at: vor(2 + n) },
        { vorname: "Kim", name: "Nummer" + "abcdefghijklmnopqrstuvw"[n], tel: "0152 10000" + String(n).padStart(2, "0") }));
    neu({ students: viele, rpcFehler: ["a-21"] });
    const r = JSON.parse((await ANMELDUNGEN.handler(cron(), zeit())).body);
    assert.equal(r.uebernommen, 20);
    assert.equal(bestaetigt[0], "a-20", "a-21 (die älteste) war schon erledigt – weiter mit der nächsten");
    assert.ok(!bestaetigt.includes("a-00") && !bestaetigt.includes("a-21"));
    // 1.000 Schüler auf der ersten Seite, der Doppelte auf der zweiten
    const bestand = Array.from({ length: 1000 }, (_, n) => schueler("b-" + String(n).padStart(4, "0"), { vorname: "Alt", name: "Schüler" + n, tel: "0160 2" + String(n).padStart(6, "0") }));
    neu({ students: [...bestand, schueler("z-dup", { vorname: "Mia", name: "Schulz", tel: "0171 9999999" }), anmeldung("a-1")] });
    await ANMELDUNGEN.handler(cron(), zeit());
    assert.equal(bestaetigt.length, 0, "der Doppelte steht auf Seite 2");
    neu({ students: [...bestand, anmeldung("a-1")] });
    await ANMELDUNGEN.handler(cron(), zeit());
    assert.deepEqual(bestaetigt, ["a-1"]);
});

// ── Fehlende Unterlagen anmahnen ─────────────────────────────────────────

const erledigt = (k) => ({ done: true, date: "2026-09-01" });
function zeile(id, extra) {
    return { student_id: id, vorname: "Jonas", name: "Weber", klasse: "B", lehrer_id: "lehrer-1", lehrer: "Lars Lehrer", tel: "", email: "jonas@example.org", theorie: "",
        schritte: { sehtest: erledigt("sehtest"), erstehilfe: { done: false, date: null }, passfoto: { done: false, date: null }, antrag: { done: false, date: null } },
        pruefungen: [{ id: "e-" + id, art: "theorie", date: "2026-11-09", passed: false, ergebnis: false }], reife: null, termine: [], plaetze: [], ...(extra || {}) };
}

test("Unterlagen: vor der Theorieprüfung kommt die Erinnerung – höchstens zweimal, eine Woche auseinander", async () => {
    neu({ pruefungen: [zeile("s-1")] });
    await UNTERLAGEN.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 1);
    const a = netz.gesendet[0].a;
    assert.equal(a.an, "jonas@example.org");
    assert.equal(a.betreff, "Unterlagen für deine Theorieprüfung am 09.11.");
    assert.equal(a.erzeugt, true);
    assert.equal(a.text, "Hallo Jonas,\n\nfür deine Theorieprüfung am 09.11. fehlt noch:\n• Erste-Hilfe-Kurs\n• biometrisches Passfoto\n• Antrag bei der Führerscheinstelle"
        + "\n\nBitte kümmere dich möglichst bald darum – der Antrag dauert bei der Führerscheinstelle oft einige Wochen. Gib uns Bescheid, wenn du es erledigt hast."
        + "\n\nViele Grüße\nFahrschule Test\n\n—\nDiese Erinnerung wurde automatisch verschickt. Hast du schon alles abgegeben? Dann betrachte sie einfach als erledigt.");
    assert.deepEqual([T.nachrichten_ausgang[0].art, T.nachrichten_ausgang[0].bezug, T.nachrichten_ausgang[0].status], ["unterlagen", "s-1:2026-11-09", "gesendet"]);
    const ausgang = T.nachrichten_ausgang;
    // Derselbe Tag, drei Tage später: nichts. Acht Tage später: die zweite. Danach keine mehr.
    for (const [j, erwartet] of [["2026-10-21T13:00:00Z", 0], ["2026-10-26T09:00:00Z", 0], ["2026-10-29T09:00:00Z", 1], ["2026-11-06T09:00:00Z", 0]]) {
        neu({ jetzt: new Date(j), pruefungen: [zeile("s-1")], ausgang });
        await UNTERLAGEN.handler(cron(), zeit());
        assert.equal(netz.gesendet.length, erwartet, j);
    }
    assert.equal(ausgang.filter((x) => x.status === "gesendet").length, 2);
});

test("Unterlagen: auch für Prüfungstermine im Kalender und Prüfplätze; nur mit Paket, Schalter, KI, Postfach und zur Sendezeit", async () => {
    neu({ pruefungen: [zeile("s-1", { pruefungen: [], termine: [{ start: "2026-11-02T08:00:00Z", ende: "2026-11-02T09:00:00Z", art: "theorie" }] }),
        zeile("s-2", { pruefungen: [], email: "lea@example.org", plaetze: [{ art: "theorie", datum: "2026-10-28", zeit: "08:30:00", ort: "TÜV Süd" }] })] });
    await UNTERLAGEN.handler(cron(), zeit());
    assert.deepEqual(netz.gesendet.map((g) => g.a.betreff), ["Unterlagen für deine Theorieprüfung am 28.10.", "Unterlagen für deine Theorieprüfung am 02.11."]);
    for (const schule of AUS) {
        neu({ schule, pruefungen: [zeile("s-1")] });
        await UNTERLAGEN.handler(cron(), zeit());
        assert.equal(netz.gesendet.length, 0, JSON.stringify(schule));
    }
    for (const j of [new Date("2026-10-25T09:00:00Z"), new Date("2026-10-21T06:59:00Z"), new Date("2026-10-21T15:00:00Z")]) {
        neu({ jetzt: j, pruefungen: [zeile("s-1")] });
        assert.equal(JSON.parse((await UNTERLAGEN.handler(cron(), zeit())).body).ruhe, true, j.toISOString());
    }
    neu({ postfach: { aktiv: false }, pruefungen: [zeile("s-1")] });
    await UNTERLAGEN.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 0);
});

test("Unterlagen: nicht nach bestandener Theorie, nicht vor einer Praxisprüfung, nicht zu kurzfristig oder zu früh, nicht ohne Lücke", async () => {
    const alle = { sehtest: erledigt(), erstehilfe: erledigt(), passfoto: erledigt(), antrag: erledigt() };
    const faelle = [
        [zeile("s-1", { theorie: "2026-09-20", pruefungen: [{ id: "p", art: "praxis", date: "2026-11-09", passed: false, ergebnis: false }] }), "Theorie bestanden, Praxis steht an"],
        [zeile("s-1", { pruefungen: [{ id: "t", art: "theorie", date: "2026-09-20", passed: true, ergebnis: true }, { id: "p", art: "praxis", date: "2026-11-09", passed: false, ergebnis: false }] }),
            "Theorie als Versuch bestanden"],
        [zeile("s-1", { pruefungen: [{ id: "p", art: "praxis", date: "2026-11-09", passed: false, ergebnis: false }] }), "als Nächstes die Praxis"],
        [zeile("s-1", { pruefungen: [{ id: "t", art: "theorie", date: "2026-10-23", passed: false, ergebnis: false }] }), "Prüfung übermorgen"],
        [zeile("s-1", { pruefungen: [{ id: "t", art: "theorie", date: "2026-11-13", passed: false, ergebnis: false }] }), "erst in 23 Tagen"],
        [zeile("s-1", { pruefungen: [{ id: "t", art: "theorie", date: "2026-10-14", passed: false, ergebnis: false }] }), "Prüfung war letzte Woche"],
        [zeile("s-1", { schritte: alle }), "alles da"],
        [zeile("s-1", { email: "" }), "ohne E-Mail"],
        [zeile("s-1", { email: "jonas@" }), "ungültige Adresse"],
    ];
    for (const [z, warum] of faelle) {
        neu({ pruefungen: [z] });
        await UNTERLAGEN.handler(cron(), zeit());
        assert.equal(netz.gesendet.length, 0, warum);
    }
    // Genau drei Tage vorher geht es noch
    neu({ pruefungen: [zeile("s-1", { pruefungen: [{ id: "t", art: "theorie", date: "2026-10-24", passed: false, ergebnis: false }] })] });
    await UNTERLAGEN.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 1);
});

test("Unterlagen: höchstens 10 je Lauf, die nächste Prüfung zuerst; das Tageslimit gilt", async () => {
    const liste = Array.from({ length: 12 }, (_, n) => zeile("s-" + n, { email: "s" + n + "@example.org",
        pruefungen: [{ id: "t", art: "theorie", date: "2026-11-" + String(10 - Math.min(n, 9)).padStart(2, "0"), passed: false, ergebnis: false }] }));
    neu({ pruefungen: liste });
    await UNTERLAGEN.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 10);
    assert.equal(netz.gesendet[0].a.betreff, "Unterlagen für deine Theorieprüfung am 01.11.");
    const voll = Array.from({ length: 100 }, (_, n) => ({ school_id: "schule-1", art: "erinnerung", bezug: "x" + n, status: "gesendet", gesendet_von: null, created_at: vor(1) }));
    neu({ pruefungen: [zeile("s-1")], ausgang: voll });
    assert.equal(JSON.parse((await UNTERLAGEN.handler(cron(), zeit())).body).ergebnis["schule-1"], "tageslimit");
    assert.equal(netz.gesendet.length, 0);
});
