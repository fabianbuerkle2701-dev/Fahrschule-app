// Erzeugt aus allindrive-autopilot/src/daten/regeln-interessenten.ts (nur die Typen entfernt) – nicht von Hand ändern, sondern dort
// ändern und mit allindrive-autopilot/werkzeuge/server-kopien.mjs neu erzeugen. Ein Test prüft, dass beide passen.
// Regeln für Interessenten ohne Datenbank-Zugriff: wann jemand dran ist und der Nachfass-Text. Gilt im Autopilot und – als
// Server-Kopie (werkzeuge/server-kopien.mjs) – im Zeitjob „Interessenten nachfassen“ der App. Hier ändern, nicht dort.

// Kalendertag in Berlin (JJJJ-MM-TT), um tage Tage verschoben – über das Datum gerechnet, nicht über Stunden
function berlinTag(ms, tage = 0) {
  const t = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(ms)).forEach((p) => { t[p.type] = p.value; });
  return new Date(Date.UTC(+t.year, +t.month - 1, +t.day + tage)).toISOString().slice(0, 10);
}

// Braucht dich – wie „unbeantwortet“ in der App: Wiedervorlage fällig, oder neu und seit über 48 Stunden ohne Kontakt

function dran(i, jetzt = Date.now()) {
  if (i.status !== "offen" && i.status !== "kontaktiert") return null;
  const heute = berlinTag(jetzt);
  const wv = i.follow_up_am ? String(i.follow_up_am).slice(0, 10) : "";
  if (wv && wv <= heute) return "wiedervorlage";
  if (i.status === "offen" && !wv && i.created_at && jetzt - new Date(i.created_at).getTime() > 48 * 3600000) return "ohne_antwort";
  return null;
}

// Nachfass-Text: kurz, freundlich, ohne Preise (die stehen im Steckbrief bzw. kommen von dir)
function nachfassText(i, schule, sie) {
  const vorname = String(i.vorname || ""), name = String(i.name || ""), klasseWert = String(i.klasse || "");
  const klasse = klasseWert ? " für Klasse " + klasseWert : "";
  const gruss = sie ? (name ? "Guten Tag " + [vorname, name].filter(Boolean).join(" ") + "," : "Guten Tag,") : "Hallo " + (vorname || name || "") + ",";
  if (i.status === "kontaktiert") {
    return sie
      ? gruss + "\n\nwir wollten kurz nachhören, ob Sie sich schon" + klasse + " entschieden haben. Gerne melden wir Sie direkt an oder beantworten noch offene Fragen – rufen Sie uns einfach an oder antworten Sie auf diese Nachricht.\n\nViele Grüße\n" + schule
      : gruss + "\n\nwir wollten kurz nachhören, ob du dich schon" + klasse + " entschieden hast. Wenn du magst, melden wir dich direkt an – oder wir beantworten noch offene Fragen. Ruf einfach an oder antworte hier.\n\nViele Grüße\n" + schule;
  }
  return sie
    ? gruss + "\n\nvielen Dank für Ihr Interesse an der " + schule + klasse.replace(" für ", ", ") + "! Haben Sie noch Fragen, oder sollen wir einen Termin für die Anmeldung ausmachen? Wir melden uns gerne telefonisch.\n\nViele Grüße\n" + schule
    : gruss + "\n\ndanke für dein Interesse an der " + schule + "! Hast du noch Fragen" + (klasseWert ? " zu Klasse " + klasseWert : "") + ", oder sollen wir gleich einen Termin für die Anmeldung ausmachen?\n\nViele Grüße\n" + schule;
}
function nachfassBetreff(schule, sie) {
  return (sie ? "Ihre" : "Deine") + " Anfrage bei der " + schule;
}

module.exports = { berlinTag, dran, nachfassText, nachfassBetreff };
