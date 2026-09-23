// Gemeinsamer Zeitdeckel für alle Anthropic-Aufrufe der Netlify-Functions.
// Kein eigener Endpoint (kein exports.handler), nur per require() genutzt.
//
// Warum: Ohne Deckel wartet fetch() so lange, bis Netlify die ganze Function nach Ablauf ihres
// Zeitlimits hart abbricht. Der Client bekommt dann eine unstrukturierte Plattform-Fehlerseite
// (kein JSON), zeigt "Fehler: Unexpected token <" o.ä. und weiß nicht, dass es sich lohnt, es
// einfach noch einmal zu versuchen (Audit 2026-09, L-M6).
//
// Das tatsächliche Limit hängt an der Netlify-Konfiguration (Standard 10 s, erweiterbar) und ist
// im Code nicht bekannt. Deshalb wird die verbleibende Laufzeit aus dem Lambda-Kontext gelesen
// und etwas Reserve für die eigene Antwort abgezogen. Fehlt der Kontext (lokale Tests), greift
// ein fester Wert.
const RESERVE_MS = 1500;
const MINDEST_MS = 1000;
const ERSATZ_MS = 25000;

function kiSignal(context) {
  let ms = ERSATZ_MS;
  if (context && typeof context.getRemainingTimeInMillis === "function") {
    const rest = Number(context.getRemainingTimeInMillis());
    if (Number.isFinite(rest) && rest > 0) ms = Math.max(MINDEST_MS, rest - RESERVE_MS);
  }
  return AbortSignal.timeout(ms);
}

// AbortSignal.timeout() bricht mit einem "TimeoutError" ab; ältere Laufzeiten melden "AbortError".
function istKiTimeout(e) {
  return !!e && (e.name === "TimeoutError" || e.name === "AbortError");
}

function kiTimeoutAntwort(headers) {
  return {
    statusCode: 504,
    headers,
    body: JSON.stringify({ error: "Die KI hat zu lange gebraucht. Bitte in einem Moment noch einmal versuchen." }),
  };
}

module.exports = { kiSignal, istKiTimeout, kiTimeoutAntwort };
