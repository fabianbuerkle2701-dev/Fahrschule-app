// KI-Fahrzeugsuche (Fabian 21.10.2026): Beim Anlegen eines Fahrzeugs schlägt die KI im Internet nach, welches
// Auto es ist und welche Intervalle gelten (Service, HU). Hier nur die Bausteine ohne Netz, damit testbar:
// Anweisung, Nachricht, Antwort lesen und prüfen. Die KI schlägt vor - eingetragen wird nur das Service-Intervall,
// und nur, wenn noch keins da ist (entscheidet der Client).

const SYSTEM = `Du hilfst einer deutschen Fahrschule, ein neues Schulfahrzeug einzutragen. Finde mit der Websuche heraus, welches Fahrzeug gemeint ist und welche Intervalle der Hersteller vorgibt.

- Service/Inspektion: Kilometer- und Zeitintervall des Herstellers für dieses Modell und diese Motorisierung. Gibt es einen variablen (Longlife-) und einen festen Service, nimm den festen – Fahrschulwagen fahren viel Stadt und Kurzstrecke.
- HU (TÜV) für einen Pkw in Deutschland, der als Fahrschulwagen genutzt wird: Abstand in Monaten.
- Nur gesicherte Angaben aus seriösen Quellen (Hersteller, ADAC, Fachpresse). Geht das Modell aus dem Namen nicht eindeutig hervor, setz "sicher" auf false und schreib in den Hinweis, was fehlt (zum Beispiel Baujahr oder Motor).

Antworte am Ende ausschließlich mit einem JSON-Objekt, ohne Markdown und ohne Text davor oder danach:
{"erkannt": "Modell, wie du es verstanden hast", "sicher": true, "service_km": 30000, "service_monate": 24, "hu_monate": 24, "hinweis": "höchstens zwei kurze Sätze", "quellen": [{"titel": "…", "url": "https://…"}]}
Unbekannte Zahlen sind null.`;

const t = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);

function nachricht(f) {
  const x = f || {};
  const km = Number(x.km);
  return "Fahrzeug: " + t(x.name, 120) + (t(x.typ, 30) ? " (" + t(x.typ, 30) + ")" : "") + (km > 0 ? ", Kilometerstand " + Math.round(km) + " km" : "");
}

// Das JSON-Objekt aus der Antwort: Mit Websuche kommt der Text oft in mehreren Blöcken (Zitate dazwischen)
function jsonAusText(text) {
  const s = String(text || "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a)
    return null;
  try {
    const o = JSON.parse(s.slice(a, b + 1));
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  }
  catch (e) {
    return null;
  }
}

// Fundstellen der Websuche aus den Zitaten der Antwort
function zitateAus(content) {
  const out = [];
  (Array.isArray(content) ? content : []).forEach(b => {
    if (!b || b.type !== "text" || !Array.isArray(b.citations))
      return;
    b.citations.forEach(c => {
      if (c && c.url)
        out.push({ titel: c.title || "", url: c.url });
    });
  });
  return out;
}

const ganz = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
function quelleOk(q) {
  const url = t(q && q.url, 500);
  if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(url))
    return null;
  return { titel: t(q && q.titel, 120) || url.replace(/^https:\/\/(www\.)?/i, "").split("/")[0], url };
}

// Zahlen in plausiblen Grenzen, Texte gekürzt, Quellen nur https (eigene Angaben zuerst, dann Zitate), höchstens drei
function ergebnisPruefen(roh, zitate) {
  const r = roh || {};
  const quellen = [];
  [...(Array.isArray(r.quellen) ? r.quellen : []), ...(Array.isArray(zitate) ? zitate : [])].forEach(q => {
    const ok = quelleOk(q);
    if (ok && quellen.length < 3 && !quellen.some(x => x.url === ok.url))
      quellen.push(ok);
  });
  return {
    erkannt: t(r.erkannt, 120),
    sicher: r.sicher === true,
    service_km: ganz(r.service_km, 3000, 100000),
    service_monate: ganz(r.service_monate, 3, 48),
    hu_monate: ganz(r.hu_monate, 12, 36),
    hinweis: t(r.hinweis, 300),
    quellen,
  };
}

module.exports = { SYSTEM, nachricht, jsonAusText, zitateAus, ergebnisPruefen };
