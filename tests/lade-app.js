// Lädt die reinen Rechenfunktionen aus index.html in eine Node-Sandbox, ohne Browser und ohne
// Build-Schritt. Das Haupt-Script (<script type="module">) wird mit Attrappen für window, document,
// React und Supabase ausgeführt; App() selbst wird dabei nie gerendert.
// Aufruf in Tests: const app = require("./lade-app")(["sumCharges", "PREISPOSTEN_32", ...]);
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function attrappe(name) {
    const f = function () { return attrappe(name + "()"); };
    return new Proxy(f, {
        get(t, k) {
            if (k === Symbol.toPrimitive) return () => "";
            if (k === "then") return undefined; // nicht als Promise erscheinen
            if (k === Symbol.iterator) return function* () {};
            if (k === "length") return 0;
            return attrappe(name + "." + String(k));
        },
        set() { return true; },
        apply() { return attrappe(name + "()"); },
        construct() { return attrappe("new " + name); },
    });
}

module.exports = function ladeApp(namen) {
    const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    const start = html.indexOf('<script type="module">');
    if (start < 0) throw new Error("Haupt-Script nicht gefunden");
    const ende = html.indexOf("</script>", start);
    let code = html.slice(start + '<script type="module">'.length, ende);
    const speicher = {};
    const kontext = {
        console: { log() {}, warn() {}, error() {}, info() {} },
        setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
        requestAnimationFrame: () => 0, queueMicrotask() {},
        Intl, Date, Math, JSON, Number, String, Array, Object, Set, Map, WeakMap, Promise, RegExp, Error,
        TextEncoder, TextDecoder, URL, URLSearchParams, Symbol, Proxy, Reflect, BigInt, Uint8Array, ArrayBuffer, DataView,
        parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, escape, unescape, atob, btoa,
        localStorage: { getItem: k => (k in speicher ? speicher[k] : null), setItem: (k, v) => { speicher[k] = String(v); }, removeItem: k => { delete speicher[k]; } },
        sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        React: attrappe("React"), ReactDOM: attrappe("ReactDOM"), supabase: attrappe("supabase"),
        document: attrappe("document"), navigator: attrappe("navigator"), location: attrappe("location"),
        fetch: () => new Promise(() => {}), matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        crypto: require("crypto").webcrypto,
    };
    for (const n of ["MutationObserver", "ResizeObserver", "IntersectionObserver", "Image", "Audio", "Notification", "Blob", "File", "FileReader",
        "Event", "CustomEvent", "HTMLElement", "Element", "Node", "performance", "getComputedStyle", "addEventListener", "removeEventListener",
        "alert", "confirm", "prompt", "AbortController", "indexedDB", "caches", "history", "screen", "visualViewport", "BroadcastChannel", "Worker", "L", "Capacitor", "webkit"])
        kontext[n] = attrappe(n);
    kontext.window = new Proxy(kontext, { get: (t, k) => (k in t ? t[k] : attrappe("window." + String(k))), set: (t, k, v) => { t[k] = v; return true; } });
    kontext.self = kontext.window;
    kontext.globalThis = kontext.window;
    vm.createContext(kontext);
    // Das Script endet mit der asynchronen Anmelde-/Render-IIFE; die läuft ins Leere (fetch hängt).
    code += "\n;globalThis.__export = {" + namen.map(n => JSON.stringify(n) + ": typeof " + n + " !== 'undefined' ? " + n + " : undefined").join(",") + "};";
    vm.runInContext(code, kontext, { filename: "index.html#module" });
    const out = kontext.__export;
    const fehlend = namen.filter(n => out[n] === undefined);
    if (fehlend.length) throw new Error("Nicht auf Modulebene gefunden: " + fehlend.join(", "));
    return out;
};
