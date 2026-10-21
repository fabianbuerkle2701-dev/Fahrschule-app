// Vollautonom „An offene Rechnungen erinnern“ (Fabian 21.10.2026): Zeitjob vollautonom-erinnerungen offline.
// Nachgebaut: Supabase-REST (Tabellen im Speicher, RPCs) und das Senden über das Postfach (lib/postfach.js).
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
const F = require(path.join(DIR, "vollautonom-erinnerungen.js"));
const R = require(path.join(DIR, "lib", "rechnungen.js"));

// Mittwoch, 21.10.2026, 10:00 Uhr in Berlin
const MITTWOCH = new Date("2026-10-21T08:00:00Z");
let T, vermerke;
const tag = (n) => new Date(Date.UTC(2026, 9, 21) - n * 86400000).toISOString().slice(0, 10);
function konto(id, extra) {
    return { student_id: id, vorname: "Tim", name: "Becker", email: "tim@example.org", firma: null, archiviert: false,
        invoices: [{ id: "inv-" + id, number: "RE-2026-0" + id.slice(-3), date: tag(30), total: 520 }], payments: [], reminders: [], ...(extra || {}) };
}
function neu(o) {
    const opt = o || {};
    netz.gesendet = []; netz.fehler = null; vermerke = [];
    T = {
        schools: [{ id: "schule-1", name: "Fahrschule Test", invoice_settings: { firma: "Fahrschule Test GmbH", iban: "DE89 3704 0044 0532 0130 00" }, zahlungsziel_tage: 14,
            ki_aus: false, bereiche_aus: [], autopilot_paket: "vollautonom", autopilot_paket_bis: null, ki_autonomie: { erinnerungen: true }, ...(opt.schule || {}) }],
        postfaecher: [{ id: "pf-1", school_id: "schule-1", email: "info@fahrschule-test.de", aktiv: true, letzter_fehler: "", ...(opt.postfach || {}) }],
        nachrichten_ausgang: [],
        konten: opt.konten || [konto("s-001")],
    };
    let zaehler = 0;
    global.fetch = async (url, init) => {
        const u = new URL(String(url));
        const methode = (init && init.method) || "GET";
        const antworten = (status, daten, kopf) => ({ ok: status < 300, status, json: async () => daten, text: async () => JSON.stringify(daten), headers: { get: (n) => (kopf || {})[n.toLowerCase()] || null } });
        if (u.pathname.startsWith("/rest/v1/rpc/")) {
            const name = u.pathname.slice(13);
            const args = JSON.parse(init.body);
            if (name === "school_rechnungen") return antworten(200, JSON.parse(JSON.stringify(T.konten)));
            if (name === "postfach_passwort") return antworten(200, "geheim");
            if (name === "school_erinnerung_ki_vermerken") { vermerke.push(args); return antworten(200, { kanal: "email", erfasstVon: "ki" }); }
            throw new Error("RPC unbekannt " + name);
        }
        const tabelle = u.pathname.slice(9);
        const filter = [...u.searchParams].filter(([k]) => !["select", "order", "limit"].includes(k));
        const passt = (z) => filter.every(([k, v]) => {
            const w = z[k];
            if (v.startsWith("eq.")) return String(w) === v.slice(3);
            if (v.startsWith("in.(")) return v.slice(4, -1).split(",").includes(String(w));
            if (v.startsWith("gte.")) return w != null && new Date(w) >= new Date(v.slice(4));
            throw new Error("Filter " + k + "=" + v);
        });
        const zeilen = (T[tabelle] || []).filter(passt);
        if (methode === "HEAD") return antworten(200, null, { "content-range": "0-0/" + zeilen.length });
        if (methode === "GET") return antworten(200, JSON.parse(JSON.stringify(zeilen)));
        if (methode === "PATCH") { const d = JSON.parse(init.body); zeilen.forEach((z) => Object.assign(z, d)); return antworten(204, null); }
        if (methode === "POST") {
            const d = JSON.parse(init.body);
            if (T[tabelle].some((z) => z.school_id === d.school_id && z.schluessel === d.schluessel)) return antworten(201, []); // ignore-duplicates
            const zeile = { id: "aus-" + (++zaehler), created_at: MITTWOCH.toISOString(), ...d };
            T[tabelle].push(zeile);
            return antworten(201, [zeile]);
        }
        throw new Error("Methode " + methode);
    };
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
    process.env.CRON_SECRET = "cron-test";
    F.uhr.jetzt = () => opt.jetzt || MITTWOCH;
}
const cron = () => ({ httpMethod: "POST", headers: { "x-cron-secret": "cron-test" }, body: "{}" });
const zeit = () => ({ getRemainingTimeInMillis: () => 20000 });

test("Erinnerung geht über das Postfach der Fahrschule raus – mit Hinweis, im Ausgang und im Protokoll vermerkt", async () => {
    neu();
    const r = await F.handler(cron(), zeit());
    assert.equal(r.statusCode, 200);
    assert.equal(netz.gesendet.length, 1);
    const a = netz.gesendet[0].a;
    assert.equal(a.an, "tim@example.org");
    assert.equal(a.betreff, "Zahlungserinnerung · Rechnung RE-2026-0001");
    assert.equal(a.erzeugt, true, "Auto-Submitted: auto-generated");
    assert.match(a.text, /^Hallo Tim,/);
    assert.match(a.text, /520,00\s€/);
    assert.match(a.text, /IBAN: DE89 3704 0044 0532 0130 00/);
    assert.match(a.text, /automatisch verschickt/);
    assert.equal(netz.gesendet[0].pw, "geheim");
    assert.equal(T.nachrichten_ausgang.length, 1);
    assert.equal(T.nachrichten_ausgang[0].status, "gesendet");
    assert.equal(T.nachrichten_ausgang[0].gesendet_von, null);
    assert.equal(T.nachrichten_ausgang[0].bezug, "s-001:inv-s-001");
    assert.deepEqual(vermerke, [{ p_student_id: "s-001", p_invoice_id: "inv-s-001", p_stufe: 1, p_betrag: 520 }]);
    // Ein zweiter Lauf am selben Tag schickt nichts noch einmal
    await F.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 1);
});

test("Nur mit Paket, Schalter, KI und Bereich Rechnungen – und nur werktags von 9 bis 17 Uhr", async () => {
    for (const schule of [{ autopilot_paket: "teilautonom" }, { ki_autonomie: {} }, { ki_autonomie: { erinnerungen: "ja" } }, { ki_aus: true },
        { bereiche_aus: ["rechnungen"] }, { autopilot_paket_bis: "2026-10-01T00:00:00Z" }]) {
        neu({ schule });
        await F.handler(cron(), zeit());
        assert.equal(netz.gesendet.length, 0, JSON.stringify(schule));
    }
    for (const jetzt of [new Date("2026-10-24T08:00:00Z"), new Date("2026-10-21T05:30:00Z"), new Date("2026-10-21T15:00:00Z")]) {
        neu({ jetzt });
        const r = await F.handler(cron(), zeit());
        assert.equal(JSON.parse(r.body).ruhe, true, jetzt.toISOString());
        assert.equal(netz.gesendet.length, 0);
    }
    neu({ postfach: { aktiv: false } });
    await F.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 0);
    neu({ postfach: { letzter_fehler: "Anmeldung fehlgeschlagen" } });
    await F.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 0);
    neu();
    assert.equal((await F.handler({ httpMethod: "POST", headers: { "x-cron-secret": "falsch" }, body: "{}" }, zeit())).statusCode, 401);
});

test("Vorsichtiger als die Liste: keine Stufe 3, nicht unter 5 €, nicht an Archivierte, Firmen nur über die Rechnungs-E-Mail", async () => {
    const faelle = [
        [konto("s-002", { invoices: [{ id: "i2", number: "RE-2026-0002", date: tag(70), total: 300 }] }), "Stufe 3 (über 45 Tage)"],
        [konto("s-003", { invoices: [{ id: "i3", number: "RE-2026-0003", date: tag(30), total: 104 }], payments: [{ amount: 100, date: tag(10), invoiceId: "i3" }] }), "4 € offen"],
        [konto("s-004", { archiviert: true }), "archiviert"],
        [konto("s-005", { firma: { name: "Logistik Nord GmbH", email: "" } }), "Firma ohne Rechnungs-E-Mail"],
        [konto("s-006", { email: "kaputt@" }), "ungültige Adresse"],
        [konto("s-007", { invoices: [{ id: "i7", number: "RE-2026-0007", date: tag(30), total: 520 }], reminders: [{ date: tag(3), stage: 1, invoiceId: "i7" }] }), "vor drei Tagen erinnert"],
        [konto("s-008", { invoices: [{ id: "i8", number: "RE-2026-0008", date: tag(10), total: 520 }] }), "noch nicht überfällig genug"],
        [konto("s-009", { invoices: [{ id: "i9", number: "RE-2026-0009", date: tag(30), total: 520, cancelledBy: "RE-2026-0010" }] }), "storniert"],
    ];
    for (const [k, warum] of faelle) {
        neu({ konten: [k] });
        await F.handler(cron(), zeit());
        assert.equal(netz.gesendet.length, 0, warum);
    }
    // Firma mit Rechnungs-E-Mail: Sie-Form an die Firma, Stufe 2 ab 21 Tagen
    neu({ konten: [konto("s-010", { firma: { name: "Logistik Nord GmbH", email: "buchhaltung@logistik-nord.example" }, invoices: [{ id: "i10", number: "RE-2026-0010", date: tag(40), total: 1890 }] })] });
    await F.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 1);
    assert.equal(netz.gesendet[0].a.an, "buchhaltung@logistik-nord.example");
    assert.equal(netz.gesendet[0].a.betreff, "2. Zahlungserinnerung · Rechnung RE-2026-0010");
    assert.match(netz.gesendet[0].a.text, /^Sehr geehrte Damen und Herren,/);
    assert.match(netz.gesendet[0].a.text, /automatisch versendet/);
    assert.equal(vermerke[0].p_stufe, 2);
});

test("Doppelt ist schlimmer als gar nicht: eine Erinnerung der letzten Tage im Ausgang sperrt; höchstens 10 je Lauf; Sendefehler stoppt", async () => {
    neu();
    T.nachrichten_ausgang.push({ id: "alt", school_id: "schule-1", art: "erinnerung", bezug: "s-001:inv-s-001", status: "reserviert", schluessel: "x", created_at: new Date("2026-10-18T10:00:00Z").toISOString() });
    await F.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 0);
    const viele = Array.from({ length: 14 }, (_, i) => konto("s-1" + String(i).padStart(2, "0")));
    neu({ konten: viele });
    await F.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 10);
    neu({ konten: viele.slice(0, 3) });
    netz.fehler = "Anmeldung am Postausgang fehlgeschlagen";
    const r = await F.handler(cron(), zeit());
    assert.equal(JSON.parse(r.body).ergebnis["schule-1"], "senden_fehler");
    assert.equal(T.nachrichten_ausgang.length, 1, "nach dem ersten Fehler kein weiterer Versuch");
    assert.equal(T.nachrichten_ausgang[0].status, "fehler");
    assert.equal(vermerke.length, 0);
});

test("Keine Erinnerung an eine Rechnung, die der Autopilot nicht verschicken konnte", async () => {
    neu();
    T.nachrichten_ausgang.push({ id: "x", school_id: "schule-1", art: "rechnung", bezug: "s-001:inv-s-001", status: "fehler",
        fehler: "Rechnung RE-2026-0001 erstellt, aber nicht verschickt: Anmeldung fehlgeschlagen", schluessel: "y", created_at: new Date("2026-10-01T09:00:00Z").toISOString() });
    await F.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 0);
    // Von Hand nachgeschickt: dann wieder normal
    T.nachrichten_ausgang.push({ id: "z", school_id: "schule-1", art: "rechnung", bezug: "s-001:inv-s-001", status: "gesendet", schluessel: "w", created_at: new Date("2026-10-02T09:00:00Z").toISOString() });
    await F.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 1);
});

test("Rechenregeln: Schlüssel je Rechnung und Tag, Auswahl sortiert nach Dringlichkeit", () => {
    assert.equal(F.schluesselFuer("a:b", "2026-10-21"), F.schluesselFuer("a:b", "2026-10-21"));
    assert.notEqual(F.schluesselFuer("a:b", "2026-10-21"), F.schluesselFuer("a:b", "2026-10-22"));
    assert.match(F.schluesselFuer("a:b", "2026-10-21"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    const pos = R.positionen(R.kontenAus([konto("s-001"), konto("s-002", { invoices: [{ id: "x", number: "RE-2026-0099", date: tag(35), total: 100 }] })]), 14, "2026-10-21");
    assert.deepEqual(F.kandidaten(pos).map((p) => p.rechnung.id), ["x", "inv-s-001"]);
});
