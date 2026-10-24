// Erzeugt aus allindrive-autopilot/src/daten/regeln-pruefungen.ts (nur die Typen entfernt) – nicht von Hand ändern, sondern dort
// ändern und mit allindrive-autopilot/werkzeuge/server-kopien.mjs neu erzeugen. Ein Test prüft, dass beide passen.
// Regeln für Prüfungen ohne Datenbank-Zugriff: was ansteht, wessen Ergebnis fehlt, welche Unterlagen vor einer Prüfung
// fehlen. Gilt im Autopilot und – als Server-Kopie (werkzeuge/server-kopien.mjs) – im Zeitjob „Unterlagen erinnern“ der App.
// Hier ändern, nicht dort.

const ART_NAME = { theorie: "Theorieprüfung", praxis: "Praxisprüfung" };
// Wie lange eine vergangene Prüfung ohne Ergebnis als „Ergebnis eintragen“ zählt
const NACHTRAG_TAGE = 21;
// Ab wie vielen Tagen vor der Prüfung fehlende Unterlagen dich brauchen
const UNTERLAGEN_TAGE = 21;

// Kalendertag in Berlin eines Zeitpunkts (wie datumBerlin im Kalender)
function datumBerlin(iso) {
  const t = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso)).forEach((p) => { t[p.type] = p.value; });
  return t.year + "-" + t.month + "-" + t.day;
}

// Eine Zeile aus school_pruefungen in die Form oben bringen (unvollständige Einträge fallen weg) – auch der Zeitjob
const zeileAus = (r) => ({
  student_id: String(r.student_id), vorname: String(r.vorname || ""), name: String(r.name || ""), klasse: String(r.klasse || "B"),
  lehrer_id: String(r.lehrer_id || ""), lehrer: String(r.lehrer || ""), tel: String(r.tel || ""), email: String(r.email || ""), theorie: String(r.theorie || ""),
  schritte: (r.schritte) || {},
  pruefungen: ((r.pruefungen) || []).filter((e) => e && (e.art === "theorie" || e.art === "praxis") && /^\d{4}-\d{2}-\d{2}/.test(String(e.date || "")))
    .map((e) => ({ id: String(e.id || ""), art: e.art, date: String(e.date).slice(0, 10), passed: e.passed === true, ergebnis: e.ergebnis === true })),
  reife: (r.reife) || null,
  termine: ((r.termine) || []).filter((t) => t && t.start),
  plaetze: ((r.plaetze) || []).filter((p) => p && (p.art === "theorie" || p.art === "praxis") && p.datum),
});

// ── Lage eines Schülers ───────────────────────────────────────────────────

const plusTage = (tag, n) => new Date(Date.parse(tag + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const UNTERLAGEN_NAME = { sehtest: "Sehtest", erstehilfe: "Erste Hilfe", passfoto: "Passfoto", antrag: "Antrag" };
const zeitBerlin = (iso) => new Date(iso).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

function pruefungsLage(z, heute, jetztMs = Date.now()) {
  const grenze = plusTage(heute, -NACHTRAG_TAGE);
  const alle = [];
  const hatErgebnis = (art, datum) => z.pruefungen.some((e) => e.art === art && e.date === datum && (e.ergebnis || e.passed));
  const hatEintrag = (art, datum) => z.pruefungen.some((e) => e.art === art && e.date === datum);
  // Versuche ohne Ergebnis: angesetzt (heute/später) oder Ergebnis fehlt (kürzlich vorbei)
  z.pruefungen.forEach((e) => {
    if (e.ergebnis || e.passed) return;
    alle.push({ art: e.art, datum: e.date, zeit: null, ort: null, quelle: "eintrag", examId: e.id || null, ende: null });
  });
  // Prüfungstermine im Kalender und zugeteilte Prüfplätze ohne eigenen Versuch an dem Tag
  z.termine.forEach((t) => {
    const art = t.art === "theorie" ? "theorie" : "praxis";
    const datum = datumBerlin(t.start);
    if (hatEintrag(art, datum)) {
      const x = alle.find((a) => a.art === art && a.datum === datum && !a.zeit);
      if (x) { x.zeit = zeitBerlin(t.start); x.ende = t.ende || t.start; }
      return;
    }
    if (alle.some((a) => a.art === art && a.datum === datum)) return;
    alle.push({ art, datum, zeit: zeitBerlin(t.start), ort: null, quelle: "termin", examId: null, ende: t.ende || t.start });
  });
  z.plaetze.forEach((p) => {
    const datum = String(p.datum).slice(0, 10);
    if (hatErgebnis(p.art, datum)) return;
    const x = alle.find((a) => a.art === p.art && a.datum === datum);
    if (x) { x.ort = x.ort || p.ort || null; x.zeit = x.zeit || (p.zeit ? p.zeit.slice(0, 5) : null); return; }
    if (hatEintrag(p.art, datum)) return;
    alle.push({ art: p.art, datum, zeit: p.zeit ? p.zeit.slice(0, 5) : null, ort: p.ort || null, quelle: "platz", examId: null, ende: null });
  });
  // Eine Prüfungsfahrt im Kalender, die heute schon zu Ende ist, zählt wie gestern: das Ergebnis fehlt
  const vorbei = (t) => t.datum < heute || (!!t.ende && Date.parse(t.ende) <= jetztMs);
  const ergebnisFehlt = alle.filter((t) => vorbei(t) && t.datum >= grenze).sort((a, b) => a.datum.localeCompare(b.datum));
  const anstehend = alle.filter((t) => !vorbei(t) && t.datum >= heute).sort((a, b) => (a.datum + (a.zeit || "")).localeCompare(b.datum + (b.zeit || "")));
  const naechste = anstehend[0];
  const fehlt = [];
  if (naechste && naechste.datum <= plusTage(heute, UNTERLAGEN_TAGE)) {
    Object.keys(UNTERLAGEN_NAME).forEach((k) => { if (!(z.schritte[k] && z.schritte[k].done)) fehlt.push(UNTERLAGEN_NAME[k]); });
    if (naechste.art === "praxis" && !z.theorie) fehlt.push("Theorie bestanden");
  }
  const praxisBestanden = z.pruefungen.filter((e) => e.art === "praxis" && e.passed).map((e) => e.date).sort();
  const bestandenAm = praxisBestanden.length ? praxisBestanden[praxisBestanden.length - 1]
    : z.schritte.praxis_bestanden && z.schritte.praxis_bestanden.done ? (z.schritte.praxis_bestanden.date || "").slice(0, 10) || null : null;
  const reifOhneTermin = !!z.reife && z.reife.ergebnis !== "nicht_bestanden" && !bestandenAm && !anstehend.some((t) => t.art === "praxis");
  return { ergebnisFehlt, anstehend, fehlt, reifOhneTermin, bestandenAm };
}

// Für Startseite und Seitenleiste: wie oft das Ergebnis fehlt, wie viele bald geprüft werden und es fehlt noch etwas
function pruefungsZahlen(liste, heute, jetztMs = Date.now()) {
  let ergebnisse = 0, unterlagen = 0;
  liste.forEach((z) => {
    const l = pruefungsLage(z, heute, jetztMs);
    ergebnisse += l.ergebnisFehlt.length;
    if (l.fehlt.length) unterlagen++;
  });
  return { ergebnisse, unterlagen };
}

// Die vier Unterlagen für den Führerschein, wie die App sie in der Nachricht nennt (UNTERLAGEN_TEXT)
const UNTERLAGEN_TEXT = { sehtest: "Sehtest", erstehilfe: "Erste-Hilfe-Kurs", passfoto: "biometrisches Passfoto", antrag: "Antrag bei der Führerscheinstelle" };
function fehlendeUnterlagen(z) {
  return Object.keys(UNTERLAGEN_TEXT).filter((k) => !(z.schritte[k] && z.schritte[k].done));
}
// Erinnerung an fehlende Unterlagen vor einer Prüfung – wie unterlagenNachricht() der App, aus Sicht der Fahrschule
function unterlagenBetreff(t) {
  return "Unterlagen für deine " + ART_NAME[t.art] + " am " + t.datum.slice(8, 10) + "." + t.datum.slice(5, 7) + ".";
}
function unterlagenNachricht(z, t, schule) {
  const fehlt = fehlendeUnterlagen(z);
  const vorname = String(z.vorname || "").trim();
  return "Hallo" + (vorname ? " " + vorname : "") + ",\n\nfür deine " + ART_NAME[t.art] + " am " + t.datum.slice(8, 10) + "." + t.datum.slice(5, 7) + ". fehlt noch:\n"
    + fehlt.map((k) => "• " + UNTERLAGEN_TEXT[k]).join("\n")
    + "\n\nBitte kümmere dich möglichst bald darum" + (fehlt.indexOf("antrag") >= 0 ? " – der Antrag dauert bei der Führerscheinstelle oft einige Wochen" : "")
    + ". Gib uns Bescheid, wenn du es erledigt hast.\n\nViele Grüße\n" + schule;
}

module.exports = { ART_NAME, NACHTRAG_TAGE, UNTERLAGEN_TAGE, zeileAus, pruefungsLage, pruefungsZahlen, UNTERLAGEN_TEXT, fehlendeUnterlagen, unterlagenBetreff, unterlagenNachricht };
