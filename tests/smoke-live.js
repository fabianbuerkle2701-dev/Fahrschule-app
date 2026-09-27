#!/usr/bin/env node
// Smoke-Test gegen die LIVE-App - nach jedem Deploy laufen lassen (Maßnahme 3, Produktplan 2026-09).
//
//   node tests/smoke-live.js                              # prüft https://allindrive.netlify.app
//   node tests/smoke-live.js https://app.allindrive.app   # anderer Host (netcup)
//
// Prüft nur, was nichts kostet und nichts verändert:
//   1. index.html lädt, APP_VERSION live = APP_VERSION lokal (sonst: Deploy nicht angekommen/Cache)
//   2. die per <script integrity> eingebundenen Bibliotheken sind erreichbar
//   3. öffentliche Supabase-RPCs antworten (Demo-Buchungscode, nur lesend)
//   4. jede Netlify-Function ist deployt: leerer POST ohne Anmeldung muss mit 400/401/403/405
//      abgelehnt werden. Alle Functions prüfen Anmeldung bzw. Pflichtfelder VOR jedem KI-Aufruf,
//      es entstehen also keine Anthropic-Kosten. 404 = nicht deployt, 5xx = kaputt.
// Exit-Code 0 = alles gut, 1 = mindestens ein Fehler.
"use strict";
const fs = require("fs");
const path = require("path");

const BASIS = (process.argv[2] || "https://allindrive.netlify.app").replace(/\/+$/, "");
const WURZEL = path.join(__dirname, "..");
const DEMO_CODE = "sonnenweg-demo";
const ergebnisse = [];

function merke(ok, was, detail) {
    ergebnisse.push({ ok, was, detail });
    console.log((ok ? "  ✓ " : "  ✗ ") + was + (detail ? " – " + detail : ""));
}

async function holen(url, opts, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms || 15000);
    try {
        return await fetch(url, { ...(opts || {}), signal: ctl.signal });
    } finally {
        clearTimeout(t);
    }
}

async function main() {
    console.log("Smoke-Test gegen " + BASIS + "\n");
    const lokal = fs.readFileSync(path.join(WURZEL, "index.html"), "utf8");
    const lokalVersion = (lokal.match(/const APP_VERSION = "([^"]+)"/) || [])[1];

    // 1. Seite + Version
    let html = "";
    try {
        const r = await holen(BASIS + "/?smoke=" + Date.now());
        html = await r.text();
        merke(r.ok, "index.html lädt", "HTTP " + r.status + ", " + Math.round(html.length / 1024) + " KB");
    } catch (e) {
        merke(false, "index.html lädt", e.message);
    }
    const liveVersion = (html.match(/const APP_VERSION = "([^"]+)"/) || [])[1];
    merke(!!liveVersion && liveVersion === lokalVersion, "Version live = lokal", "live " + (liveVersion || "?") + ", lokal " + lokalVersion);

    // 2. Bibliotheken mit Integritäts-Hash
    const skripte = [...html.matchAll(/<script[^>]*src="(https:[^"]+)"[^>]*integrity=/g)].map(m => m[1]);
    for (const src of skripte) {
        try {
            const r = await holen(src, { method: "GET" });
            merke(r.ok, "Bibliothek " + src.split("/").slice(-1)[0], "HTTP " + r.status);
        } catch (e) {
            merke(false, "Bibliothek " + src, e.message);
        }
    }

    // 3. Öffentliche RPCs (Werte aus der LIVE-Seite, damit ein Schlüsselwechsel auffällt)
    // SUPABASE_URL-Konstante statt *.supabase.co - der netcup-Server nutzt einen eigenen Supabase.
    const sbUrl = (html.match(/const SUPABASE_URL = "([^"]+)"/) || [])[1];
    const anon = (html.match(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/) || [])[0];
    if (!sbUrl || !anon) {
        merke(false, "Supabase-Zugang in index.html gefunden");
    } else {
        const rpc = async (name, body) => {
            const r = await holen(sbUrl + "/rest/v1/rpc/" + name, { method: "POST",
                headers: { apikey: anon, Authorization: "Bearer " + anon, "Content-Type": "application/json" }, body: JSON.stringify(body) });
            return { status: r.status, daten: await r.json().catch(() => null) };
        };
        try {
            const info = await rpc("public_booking_info", { code: DEMO_CODE });
            const zeile = Array.isArray(info.daten) ? info.daten[0] : null;
            merke(info.status === 200 && !!(zeile && zeile.school_name), "RPC public_booking_info (Demo)", "HTTP " + info.status + (zeile ? ", " + zeile.school_name : ""));
            const jetzt = new Date();
            const busy = await rpc("public_busy_times", { code: DEMO_CODE, von: jetzt.toISOString(), bis: new Date(+jetzt + 7 * 864e5).toISOString() });
            merke(busy.status === 200 && Array.isArray(busy.daten), "RPC public_busy_times (Demo)", "HTTP " + busy.status);
        } catch (e) {
            merke(false, "Öffentliche RPCs", e.message);
        }
    }

    // 4. Netlify-Functions
    const functions = fs.readdirSync(path.join(WURZEL, "netlify", "functions")).filter(f => f.endsWith(".js")).map(f => f.slice(0, -3)).sort();
    for (const name of functions) {
        const url = BASIS + "/.netlify/functions/" + name;
        try {
            // calendar-feed ist ein GET-Feed (Kalender-Apps), ohne Token abgelehnt
            const r = name === "calendar-feed"
                ? await holen(url, { method: "GET" })
                : await holen(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            const text = await r.text();
            // calendar-feed meldet einen fehlenden/falschen Token selbst mit 404 und eigenem Text -
            // das ist ein deployter Feed, kein fehlender (Netlify selbst antwortet dann anders).
            const ok = [400, 401, 403, 405].includes(r.status) || (name === "calendar-feed" && r.status === 404 && /Kalender-Link/.test(text));
            merke(ok, "Function " + name, "HTTP " + r.status + (ok ? "" : " " + text.slice(0, 120).replace(/\s+/g, " ")));
        } catch (e) {
            merke(false, "Function " + name, e.message);
        }
    }

    const fehler = ergebnisse.filter(x => !x.ok);
    console.log("\n" + (fehler.length ? fehler.length + " von " + ergebnisse.length + " Prüfungen FEHLGESCHLAGEN" : "Alle " + ergebnisse.length + " Prüfungen bestanden"));
    process.exit(fehler.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
