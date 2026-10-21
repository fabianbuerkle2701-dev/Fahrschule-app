// Werkstatt-Termine (Fabian 21.10.2026): werkstatt-anfrage, die Werkstatt-Antwort in posteingang-ki und der Zeitjob
// vollautonom-werkstatt – offline. Nachgebaut: Supabase-REST (Tabellen im Speicher, RPCs), Anmeldung, Postfach, Anthropic.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("module");

const DIR = path.join(__dirname, "..", "netlify", "functions");
const sdk = { aufrufe: [], antwort: null };
class FakeAnthropic { constructor() { this.messages = { create: async (params) => { sdk.aufrufe.push(params); return sdk.antwort(params); } }; } }
const altLaden = Module._load;
Module._load = function (anfrage) { return anfrage === "@anthropic-ai/sdk" ? { default: FakeAnthropic } : altLaden.apply(this, arguments); };
const PF_PFAD = path.join(DIR, "lib", "postfach.js");
const echtPF = require(PF_PFAD);
const netz = { gesendet: [], fehler: null };
require.cache[PF_PFAD].exports = {
    ...echtPF,
    antwortSenden: async (cfg, pw, a) => {
        if (netz.fehler) throw Object.assign(new Error(netz.fehler), { eigen: true });
        netz.gesendet.push({ cfg, pw, a });
        const info = { messageId: "<anfrage-" + netz.gesendet.length + "@fahrschule-test.de>" };
        if (typeof a.gesendet === "function") await a.gesendet(info);
        return info;
    },
};
const ANFRAGE = () => require(path.join(DIR, "werkstatt-anfrage.js"));
const POST_KI = () => require(path.join(DIR, "posteingang-ki.js"));
const ZEITJOB = () => require(path.join(DIR, "vollautonom-werkstatt.js"));
const W = require(path.join(DIR, "lib", "werkstatt.js"));

let T, opt, rpcs;
const tag = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
function neu(o) {
    opt = o || {};
    netz.gesendet = []; netz.fehler = null; sdk.aufrufe = []; rpcs = [];
    T = {
        schools: [{ id: "schule-1", name: "Fahrschule Test", invoice_settings: {}, locations: [{ phone: "030 123" }], ki_aus: false, bereiche_aus: [],
            autopilot_paket: "teilautonom", autopilot_paket_bis: null, ki_autonomie: {}, ki_steckbrief: "", packages: [], klassen: [],
            vehicles: [{ id: "v1", name: "VW Golf", plate: "S-FS 101", tuvDate: tag(20), mileage: 84210, serviceIntervalKm: 30000, lastServiceKm: 60000 },
                { id: "v2", name: "Audi A3", plate: "S-FS 202", tuvDate: tag(400) }], ...(opt.schule || {}) }],
        profiles: [{ id: "admin-1", school_id: "schule-1", school_admin: true, school_office: false, booking_code: "ABC" },
            { id: "buero-2", school_id: "schule-1", school_admin: false, school_office: true },
            { id: "lehrer-3", school_id: "schule-1", school_admin: false, school_office: false },
            { id: "fremd-9", school_id: "schule-2", school_admin: true, school_office: false }],
        postfaecher: [{ id: "pf-1", school_id: "schule-1", email: "info@fahrschule-test.de", aktiv: true, letzter_fehler: "", regeln: { autopilot: true } }],
        fahrzeug_werkstaetten: [{ id: "w-1", school_id: "schule-1", fahrzeug_id: "v1", name: "Autohaus Muster", email: "service@autohaus.example", ansprechpartner: "Herr Kaya", telefon: "", notiz: "" }],
        werkstatt_anfragen: [], bookings: [], appointments: [], posteingang: [], students: [], interessenten: [],
    };
    let zaehler = 0;
    global.fetch = async (url, init) => {
        const u = new URL(String(url));
        const methode = (init && init.method) || "GET";
        const kopf = (init && init.headers) || {};
        const antworten = (status, daten, k) => ({ ok: status < 300, status, json: async () => daten, text: async () => JSON.stringify(daten), headers: { get: (n) => (k || {})[n.toLowerCase()] || null } });
        if (u.pathname === "/auth/v1/user") return opt.uid === null ? antworten(401, {}) : antworten(200, { id: opt.uid || "admin-1" });
        if (u.pathname.startsWith("/rest/v1/rpc/")) {
            const name = u.pathname.slice(13);
            const args = JSON.parse(init.body || "{}");
            rpcs.push({ name, args, auth: kopf.Authorization });
            if (name === "postfach_passwort") return antworten(200, "geheim");
            if (name === "posteingang_naechster") {
                const z = T.posteingang.filter((r) => ["neu", "zu_senden"].includes(r.status) && r.versuche < 3)[0];
                if (!z) return antworten(200, []);
                z.versuche++;
                return antworten(200, [JSON.parse(JSON.stringify(z))]);
            }
            if (name === "werkstatt_termin_eintragen") {
                if (opt.belegt) return antworten(400, { message: "Das Fahrzeug ist in dieser Zeit schon verplant." });
                const a = T.werkstatt_anfragen.find((x) => x.id === args.p_anfrage);
                const b = { id: "b-" + (T.bookings.length + 1), school_id: a.school_id, vehicle_id: a.fahrzeug_id, start_at: args.p_start, end_at: args.p_ende };
                T.bookings.push(b);
                Object.assign(a, { status: "gebucht", termin_start: args.p_start, termin_ende: args.p_ende, booking_id: b.id });
                return antworten(200, b.id);
            }
            throw new Error("RPC unbekannt " + name);
        }
        const tabelle = u.pathname.slice(9);
        if (!T[tabelle]) throw new Error("Tabelle unbekannt " + tabelle);
        const filter = [...u.searchParams].filter(([k]) => !["select", "order", "limit"].includes(k));
        const passt = (z) => filter.every(([k, v]) => {
            const w = z[k];
            if (v.startsWith("eq.")) return String(w) === v.slice(3);
            if (v.startsWith("in.(")) return v.slice(4, -1).split(",").includes(String(w));
            if (v.startsWith("gte.")) return w != null && new Date(w) >= new Date(v.slice(4));
            if (v.startsWith("gt.")) return w != null && new Date(w) > new Date(v.slice(3));
            if (v.startsWith("lt.")) return w != null && new Date(w) < new Date(v.slice(3));
            throw new Error("Filter " + k + "=" + v);
        });
        const zeilen = T[tabelle].filter(passt);
        if (methode === "HEAD") return antworten(200, null, { "content-range": "0-0/" + zeilen.length });
        if (methode === "GET") return antworten(200, JSON.parse(JSON.stringify(zeilen)));
        if (methode === "PATCH") {
            const d = JSON.parse(init.body);
            zeilen.forEach((z) => Object.assign(z, d));
            return /return=representation/.test(kopf.Prefer || "") ? antworten(200, JSON.parse(JSON.stringify(zeilen))) : antworten(204, null);
        }
        if (methode === "POST") {
            const d = JSON.parse(init.body);
            if (tabelle === "werkstatt_anfragen" && T.werkstatt_anfragen.some((a) => a.school_id === d.school_id && a.fahrzeug_id === d.fahrzeug_id && a.anlass === d.anlass && ["gesendet", "antwort"].includes(a.status)))
                return antworten(409, { message: "duplicate key value violates unique constraint" });
            const zeile = { id: "00000000-0000-4000-8000-" + String(++zaehler).padStart(12, "0"), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), message_id: "", ...d };
            T[tabelle].push(zeile);
            return antworten(201, [zeile]);
        }
        throw new Error("Methode " + methode);
    };
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
    process.env.ANTHROPIC_API_KEY = "nur-fuer-den-test";
    process.env.CRON_SECRET = "cron-test";
}
const nutzer = (body) => ({ httpMethod: "POST", headers: { authorization: "Bearer nutzer-token" }, body: JSON.stringify(body) });
const cron = () => ({ httpMethod: "POST", headers: { "x-cron-secret": "cron-test" }, body: "{}" });
const zeit = () => ({ getRemainingTimeInMillis: () => 20000 });

test("Anfrage: nur Admin und Büro, nur mit KI-Paket und eingeschalteter KI", async () => {
    neu({ uid: null });
    assert.equal((await ANFRAGE().handler(nutzer({ aktion: "vorschau", fahrzeug_id: "v1", anlass: "hu" }))).statusCode, 401);
    neu({ uid: "lehrer-3" });
    assert.equal((await ANFRAGE().handler(nutzer({ aktion: "vorschau", fahrzeug_id: "v1", anlass: "hu" }))).statusCode, 403);
    neu({ schule: { autopilot_paket: null } });
    const r = await ANFRAGE().handler(nutzer({ aktion: "vorschau", fahrzeug_id: "v1", anlass: "hu" }));
    assert.equal(r.statusCode, 402);
    assert.match(JSON.parse(r.body).error, /KI-Paket/);
    neu({ schule: { bereiche_aus: ["fuhrpark"] } });
    assert.equal((await ANFRAGE().handler(nutzer({ aktion: "vorschau", fahrzeug_id: "v1", anlass: "hu" }))).statusCode, 403);
    neu({ uid: "buero-2" });
    assert.equal((await ANFRAGE().handler(nutzer({ aktion: "vorschau", fahrzeug_id: "v1", anlass: "hu" }))).statusCode, 200, "das Büro darf");
    neu();
    assert.equal((await ANFRAGE().handler(nutzer({ aktion: "vorschau", fahrzeug_id: "v2", anlass: "hu" }))).statusCode, 409, "ohne Werkstatt");
    T.fahrzeug_werkstaetten[0].email = "keine-adresse";
    assert.equal((await ANFRAGE().handler(nutzer({ aktion: "vorschau", fahrzeug_id: "v1", anlass: "hu" }))).statusCode, 409, "ohne gültige E-Mail");
});

test("Vorschau mit freien Zeiten – Fahrstunden und Kalender des Fahrzeugs sind belegt, fremde Fahrschulen zählen nicht", async () => {
    neu();
    const ab = W.tagPlus(W.berlinTeile(new Date().toISOString()).datum, 2);
    // Den ersten Werktag ab übermorgen komplett belegen (Fahrstunde vormittags, Kalender nachmittags)
    let d = ab;
    while ([0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay())) d = W.tagPlus(d, 1);
    T.appointments.push({ owner: "admin-1", fahrzeug: "v1", start_at: W.berlinZeit(d, 9), end_at: W.berlinZeit(d, 10) });
    T.bookings.push({ school_id: "schule-1", vehicle_id: "v1", start_at: W.berlinZeit(d, 14), end_at: W.berlinZeit(d, 15) });
    T.appointments.push({ owner: "fremd-9", fahrzeug: "v1", start_at: W.berlinZeit(W.tagPlus(d, 1), 9), end_at: W.berlinZeit(W.tagPlus(d, 1), 10) });
    const r = await ANFRAGE().handler(nutzer({ aktion: "vorschau", fahrzeug_id: "v1", anlass: "hu" }));
    assert.equal(r.statusCode, 200);
    const v = JSON.parse(r.body);
    assert.equal(v.an, "service@autohaus.example");
    assert.equal(v.vorschlaege.length, 3);
    assert.ok(v.vorschlaege.every((z) => W.berlinTeile(z.start).datum !== d), "der belegte Tag fehlt");
    assert.equal(W.berlinTeile(v.vorschlaege[0].start).stunde, 8, "fremde Fahrschule mit gleicher Fahrzeug-Kennung zählt nicht");
    assert.match(v.text, /^Guten Tag Herr Kaya,/);
    assert.equal(v.betreff, "Terminanfrage HU/TÜV · VW Golf (S-FS 101)");
});

test("Senden: an die hinterlegte Werkstatt, Anfrage mit Message-ID gespeichert, nie zweimal offen; Fehler bricht ab", async () => {
    neu();
    const vorschau = JSON.parse((await ANFRAGE().handler(nutzer({ aktion: "vorschau", fahrzeug_id: "v1", anlass: "hu" }))).body);
    let r = await ANFRAGE().handler(nutzer({ aktion: "senden", fahrzeug_id: "v1", anlass: "hu", betreff: vorschau.betreff, text: vorschau.text + "\nP.S. Bitte mit Ersatzwagen.",
        vorschlaege: vorschau.vorschlaege, an: "boese@example.org" }));
    assert.equal(r.statusCode, 200);
    assert.equal(netz.gesendet.length, 1);
    assert.equal(netz.gesendet[0].a.an, "service@autohaus.example", "Empfänger aus der Werkstatt, nie aus der Anfrage");
    assert.match(netz.gesendet[0].a.text, /Ersatzwagen/);
    const a = T.werkstatt_anfragen[0];
    assert.deepEqual({ status: a.status, anlass: a.anlass, mid: a.message_id, von_ki: a.von_ki, wer: a.erstellt_von, n: a.vorschlaege.length },
        { status: "gesendet", anlass: "hu", mid: "<anfrage-1@fahrschule-test.de>", von_ki: false, wer: "admin-1", n: 3 });
    r = await ANFRAGE().handler(nutzer({ aktion: "senden", fahrzeug_id: "v1", anlass: "hu", betreff: "x", text: "y" }));
    assert.equal(r.statusCode, 409);
    assert.equal(netz.gesendet.length, 1);
    // Senden scheitert: Anfrage abgebrochen, eine neue ist danach möglich
    neu();
    netz.fehler = "Anmeldung am Postausgang fehlgeschlagen";
    r = await ANFRAGE().handler(nutzer({ aktion: "senden", fahrzeug_id: "v1", anlass: "service", betreff: "Terminanfrage", text: "Hallo" }));
    assert.equal(r.statusCode, 502);
    assert.equal(T.werkstatt_anfragen[0].status, "abgebrochen");
    assert.equal((await ANFRAGE().handler(nutzer({ aktion: "senden", fahrzeug_id: "v1", anlass: "service", betreff: "Terminanfrage", text: "[bitte ergänzen: Datum]" }))).statusCode, 400);
});

function anfrageMitAntwort(stand) {
    const vorschlaege = W.freieZeiten([], W.tagPlus(W.berlinTeile(new Date().toISOString()).datum, 3), 3, 21);
    T.werkstatt_anfragen.push({ id: "00000000-0000-4000-8000-0000000000a1", school_id: "schule-1", fahrzeug_id: "v1", werkstatt_id: "w-1", anlass: "hu", status: "gesendet",
        an: "service@autohaus.example", betreff: "Terminanfrage HU/TÜV · VW Golf (S-FS 101)", message_id: "<anfrage-1@fahrschule-test.de>", vorschlaege,
        antwort: {}, created_at: new Date(Date.now() - 86400000).toISOString(), updated_at: new Date().toISOString(), ...(stand || {}) });
    const mail = { id: "00000000-0000-4000-8000-0000000000m1", school_id: "schule-1", postfach_id: "pf-1", message_id: "<antwort@autohaus.example>",
        antwort_auf: "<anfrage-1@fahrschule-test.de>", referenzen: "<anfrage-1@fahrschule-test.de>", von_name: "Autohaus Muster", von_email: "service@autohaus.example",
        betreff: "Re: Terminanfrage HU/TÜV · VW Golf (S-FS 101)", text: "Guten Tag, der erste Termin passt. Gruß Kaya", empfangen_am: new Date().toISOString(),
        status: "neu", aktionen: [], versuche: 0, kategorie: "", grund: "", entwurf_text: "", entwurf_betreff: "", updated_at: new Date().toISOString() };
    T.posteingang.push(mail);
    sdk.antwort = () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ zusage: true, gegenvorschlag: false, absage: false,
        termin_start: W.berlinTeile(vorschlaege[0].start).datum + "T08:00", termin_ende: "", rueckfrage: false, zusammenfassung: "Der erste Termin passt." }) }] });
    return { mail, vorschlaege };
}

test("Antwort der Werkstatt, Teilautonom: Termin gelesen und dem Admin vorgelegt – nichts eingetragen, nichts gesendet", async () => {
    neu();
    const { mail, vorschlaege } = anfrageMitAntwort();
    const r = await POST_KI().handler(cron(), zeit());
    assert.deepEqual(JSON.parse(r.body).ergebnis, ["werkstatt_antwort"]);
    assert.equal(sdk.aufrufe.length, 1);
    assert.deepEqual(sdk.aufrufe[0].output_config.format.schema, W.SCHEMA);
    assert.match(sdk.aufrufe[0].messages[0].content, /der erste Termin passt/);
    assert.equal(mail.status, "braucht_dich");
    assert.match(mail.grund, /^Die Werkstatt hat zugesagt: .* – im Fuhrpark eintragen\.$/);
    const a = T.werkstatt_anfragen[0];
    assert.equal(a.status, "antwort");
    assert.equal(a.antwort_mail_id, mail.id);
    assert.equal(a.antwort.start, vorschlaege[0].start);
    assert.equal(a.antwort.ende, vorschlaege[0].ende);
    assert.equal(rpcs.filter((x) => x.name === "werkstatt_termin_eintragen").length, 0);
    assert.equal(netz.gesendet.length, 0);
});

test("Antwort der Werkstatt, Vollautonom mit Schalter: eingetragen und bestätigt – belegt oder unklar bleibt beim Admin", async () => {
    neu({ schule: { autopilot_paket: "vollautonom", ki_autonomie: { werkstatt_termine: true } } });
    let { mail, vorschlaege } = anfrageMitAntwort();
    await POST_KI().handler(cron(), zeit());
    const buchung = rpcs.find((x) => x.name === "werkstatt_termin_eintragen");
    assert.deepEqual(buchung.args, { p_anfrage: "00000000-0000-4000-8000-0000000000a1", p_start: vorschlaege[0].start, p_ende: vorschlaege[0].ende });
    assert.equal(buchung.auth, "Bearer service-test");
    assert.equal(T.bookings.length, 1);
    assert.equal(netz.gesendet.length, 1);
    assert.equal(netz.gesendet[0].a.an, "service@autohaus.example");
    assert.equal(netz.gesendet[0].a.antwortAuf, "<antwort@autohaus.example>");
    assert.match(netz.gesendet[0].a.text, /eingetragen und bringen das Fahrzeug \(VW Golf, Kennzeichen S-FS 101\) vorbei/);
    assert.match(netz.gesendet[0].a.text, /automatisch verschickt/);
    assert.equal(mail.status, "info");
    assert.match(mail.grund, /^Termin bei der Werkstatt eingetragen: .* – Bestätigung gesendet\.$/);
    // Das Fahrzeug ist dann verplant: nichts gesendet, beim Admin
    neu({ belegt: true, schule: { autopilot_paket: "vollautonom", ki_autonomie: { werkstatt_termine: true } } });
    ({ mail } = anfrageMitAntwort());
    await POST_KI().handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 0);
    assert.equal(mail.status, "braucht_dich");
    assert.match(mail.grund, /verplant/);
    // Rückfrage der Werkstatt: nicht eintragen
    neu({ schule: { autopilot_paket: "vollautonom", ki_autonomie: { werkstatt_termine: true } } });
    ({ mail } = anfrageMitAntwort());
    sdk.antwort = () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ zusage: false, gegenvorschlag: false, absage: false, termin_start: "", termin_ende: "",
        rueckfrage: true, zusammenfassung: "Fragt nach der Fahrgestellnummer." }) }] });
    await POST_KI().handler(cron(), zeit());
    assert.equal(rpcs.filter((x) => x.name === "werkstatt_termin_eintragen").length, 0);
    assert.match(mail.grund, /Rückfrage/);
});

test("Termin eintragen aus dem Autopilot: mit dem Token des Nutzers, Meldung der Datenbank, auf Wunsch bestätigt", async () => {
    neu();
    const { mail, vorschlaege } = anfrageMitAntwort({ status: "antwort", antwort_mail_id: "00000000-0000-4000-8000-0000000000m1" });
    mail.status = "braucht_dich";
    let r = await ANFRAGE().handler(nutzer({ aktion: "eintragen", anfrage_id: "00000000-0000-4000-8000-0000000000a1", start: vorschlaege[0].start, ende: vorschlaege[0].ende, bestaetigen: true }));
    assert.equal(r.statusCode, 200);
    assert.equal(JSON.parse(r.body).bestaetigt, true);
    assert.equal(rpcs.find((x) => x.name === "werkstatt_termin_eintragen").auth, "Bearer nutzer-token");
    assert.equal(netz.gesendet[0].a.antwortAuf, "<antwort@autohaus.example>");
    assert.equal(netz.gesendet[0].a.betreff, "Re: Terminanfrage HU/TÜV · VW Golf (S-FS 101)");
    neu({ belegt: true });
    anfrageMitAntwort();
    r = await ANFRAGE().handler(nutzer({ aktion: "eintragen", anfrage_id: "00000000-0000-4000-8000-0000000000a1", start: new Date(Date.now() + 86400000).toISOString(), ende: new Date(Date.now() + 90000000).toISOString() }));
    assert.equal(r.statusCode, 409);
    assert.equal(JSON.parse(r.body).error, "Das Fahrzeug ist in dieser Zeit schon verplant.");
    assert.equal(netz.gesendet.length, 0);
});

test("Zeitjob: fragt bei fälliger HU selbst an (Vollautonom + Schalter), nicht doppelt, nicht ohne Schalter", async () => {
    const F = ZEITJOB();
    F.uhr.jetzt = () => new Date("2026-10-21T08:00:00Z"); // Mittwoch, 10 Uhr
    neu({ schule: { autopilot_paket: "vollautonom", ki_autonomie: { werkstatt_termine: true } } });
    let r = await F.handler(cron(), zeit());
    assert.equal(JSON.parse(r.body).ergebnis["schule-1"], "gesendet");
    assert.equal(netz.gesendet.length, 1, "nur v1 hat eine Werkstatt; v2 ist nicht fällig");
    assert.match(netz.gesendet[0].a.text, /automatisch verschickt/);
    assert.equal(netz.gesendet[0].a.erzeugt, true);
    assert.equal(T.werkstatt_anfragen[0].von_ki, true);
    r = await F.handler(cron(), zeit());
    assert.equal(netz.gesendet.length, 1, "Anfrage offen – keine zweite");
    for (const schule of [{ autopilot_paket: "vollautonom", ki_autonomie: {} }, { autopilot_paket: "teilautonom", ki_autonomie: { werkstatt_termine: true } }, { autopilot_paket: "vollautonom", ki_autonomie: { werkstatt_termine: true }, ki_aus: true }]) {
        neu({ schule });
        await F.handler(cron(), zeit());
        assert.equal(netz.gesendet.length, 0, JSON.stringify(schule));
    }
    F.uhr.jetzt = () => new Date("2026-10-24T08:00:00Z"); // Samstag
    neu({ schule: { autopilot_paket: "vollautonom", ki_autonomie: { werkstatt_termine: true } } });
    assert.equal(JSON.parse((await F.handler(cron(), zeit())).body).ruhe, true);
    assert.equal(netz.gesendet.length, 0);
});
