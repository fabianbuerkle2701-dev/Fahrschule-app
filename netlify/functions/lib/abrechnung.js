// Abrechnung für Zeitjobs auf dem Server (Vollautonom „Jeden Monat selbst abrechnen“, Fabian 21.10.2026).
// Erzeugt aus allindrive-autopilot/src/daten/abrechnung.ts (nur die Typen entfernt) – nicht von Hand ändern, sondern
// dort ändern und mit allindrive-autopilot/werkzeuge/server-kopien.mjs neu erzeugen. Ein Test prüft, dass beide passen.

function eurFmt(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function lessonPricePerUE(l, stdPrice) {
  return l && l.price != null && l.price !== "" ? Number(l.price) : Number(stdPrice) || 0;
}

function packageCreditUE(s) {
  return (s.packages || []).reduce((sum, p) => sum + (Number(p.includedUE) || 0), 0);
}

// Für abgerechnete Stunden OHNE Deckungs-Schnappschuss die damals gedeckte UE aus der Rechnung zurückrechnen
function rekonstruierteDeckungUE(s, stdPrice) {
  const out = {};
  if (packageCreditUE(s) <= 0) return out;
  const invByNumber = {};
  (s.invoices || []).forEach((inv) => { if (inv && inv.number) invByNumber[inv.number] = inv; });
  const proRechnung = {};
  (s.drivenLessons || []).forEach((l) => {
    if (!l.invoiced) return;
    (proRechnung[l.invoiced] = proRechnung[l.invoiced] || []).push(l);
  });
  const nachDatum = Object.keys(proRechnung).sort((a, b) => String((invByNumber[a] || {}).date || "").localeCompare(String((invByNumber[b] || {}).date || "")));
  nachDatum.forEach((nr) => {
    const ls = proRechnung[nr];
    const inv = invByNumber[nr];
    if (!inv || ls.some((l) => l.invoicedCoveredUE != null)) return;
    const kosten = (s.costItems || []).filter((it) => it.invoiced === nr).reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
    const berechnet = (Number(inv.total) || 0) - kosten;
    const guthabenDamals = (s.packages || []).filter((p) => !p.date || !inv.date || String(p.date) <= String(inv.date))
      .reduce((sum, p) => sum + (Number(p.includedUE) || 0), 0);
    if (!(guthabenDamals > 0)) return;
    const voll = ls.reduce((sum, l) => sum + ((Number(l.minutes) || 0) / 45) * lessonPricePerUE(l, stdPrice), 0);
    let gedecktEur = Math.round((voll - berechnet) * 100) / 100;
    if (!(gedecktEur > 0.005 * (ls.length + 1))) return;
    const erstesDatum = ls.reduce ((m, l) => (m == null || (l.date || "") < m ? l.date || "" : m), null) || "";
    const vorher = (s.drivenLessons || []).filter((x) => ls.indexOf(x) < 0 && (x.date || "") < erstesDatum)
      .reduce((sum, x) => {
        const ue = (Number(x.minutes) || 0) / 45;
        if (!x.invoiced) return sum + ue;
        return sum + Math.min(ue, x.invoicedCoveredUE != null ? Number(x.invoicedCoveredUE) || 0 : out[x.id] || 0);
      }, 0);
    let restUE = Math.max(0, guthabenDamals - vorher);
    ls.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).forEach((l) => {
      const ue = (Number(l.minutes) || 0) / 45, preis = lessonPricePerUE(l, stdPrice);
      if (gedecktEur <= 0.005 || restUE <= 0 || !(preis > 0)) return;
      const c = Math.min(ue, gedecktEur / preis, restUE);
      out[l.id] = c;
      gedecktEur -= c * preis;
      restUE -= c;
    });
  });
  return out;
}

// Damaliger Standardpreis je Rechnung für abgerechnete Stunden ohne eigenen Preis und ohne Schnappschuss
function abgerechneterStandardpreis(s, abgerechnet) {
  const out = {};
  const ohnePaket = packageCreditUE(s) <= 0;
  const proRechnung = {};
  abgerechnet.forEach((_covered, l) => { (proRechnung[l.invoiced ] = proRechnung[l.invoiced ] || []).push(l); });
  Object.keys(proRechnung).forEach((nr) => {
    const ls = proRechnung[nr];
    const eigenerPreis = (l) => (l.invoicedPrice != null && l.invoicedPrice !== "") || (l.price != null && l.price !== "");
    const ohne = ls.filter((l) => !eigenerPreis(l));
    if (ohne.length === 0) return;
    if (!ohnePaket && ls.some((l) => l.invoicedCoveredUE == null)) return;
    const inv = (s.invoices || []).find((x) => x && x.number === nr);
    if (!inv) return;
    const kosten = (s.costItems || []).filter((it) => it.invoiced === nr).reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
    let rest = (Number(inv.total) || 0) - kosten;
    let ueOhne = 0;
    ls.forEach((l) => {
      const billUE = (Number(l.minutes) || 0) / 45 - (abgerechnet.get(l) || 0);
      if (eigenerPreis(l)) rest -= billUE * Number(l.invoicedPrice != null && l.invoicedPrice !== "" ? l.invoicedPrice : l.price);
      else ueOhne += billUE;
    });
    if (!(ueOhne > 0.001)) return;
    const preis = Math.round((rest / ueOhne) * 100) / 100;
    if (Number.isFinite(preis) && preis > 0) out[nr] = preis;
  });
  return out;
}

function lessonBillables(s, stdPrice) {
  const lessons = (s.drivenLessons || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  let creditUE = packageCreditUE(s);
  const rekonstruiert = rekonstruierteDeckungUE(s, stdPrice);
  const abgerechnet = new Map ();
  lessons.forEach((l) => {
    if (!l.invoiced) return;
    const ue = (Number(l.minutes) || 0) / 45;
    const covered = l.invoicedCoveredUE != null
      ? Math.min(ue, Number(l.invoicedCoveredUE) || 0)
      : Math.min(ue, rekonstruiert[l.id] || 0, creditUE);
    creditUE = Math.max(0, creditUE - covered);
    abgerechnet.set(l, covered);
  });
  const damaligerStdPreis = abgerechneterStandardpreis(s, abgerechnet);
  return lessons.map((l) => {
    const ue = (Number(l.minutes) || 0) / 45;
    if (l.invoiced) {
      const covered = abgerechnet.get(l) || 0;
      const billableUE = ue - covered;
      const preis = l.invoicedPrice != null && l.invoicedPrice !== "" && Number.isFinite(Number(l.invoicedPrice))
        ? Number(l.invoicedPrice)
        : l.price != null && l.price !== "" ? Number(l.price)
          : damaligerStdPreis[l.invoiced] != null ? damaligerStdPreis[l.invoiced] : lessonPricePerUE(l, stdPrice);
      const amount = Math.round(billableUE * preis * 100) / 100;
      return { lesson: l, ue, coveredUE: covered, billableUE, amount };
    }
    const covered = Math.min(ue, creditUE);
    creditUE = Math.max(0, creditUE - ue);
    const billableUE = ue - covered;
    const amount = Math.round(billableUE * lessonPricePerUE(l, stdPrice) * 100) / 100;
    return { lesson: l, ue, coveredUE: covered, billableUE, amount };
  });
}

// Kontostand wie in der App (sumCharges/sumPayments): Fahrstunden (je eigener Preis, abzüglich Paket-Guthaben) und freie Posten
// gegen alle Zahlungen – unabhängig davon, ob schon eine Rechnung geschrieben ist (Fabian 23.10.2026: „offene Beträge“)
function lessonsCharge(s, stdPrice) {
  return lessonBillables(s, stdPrice).reduce((sum, b) => sum + (Number.isFinite(b.amount) ? b.amount : 0), 0);
}
function sumCharges(s, pricePerUE) {
  const auto = lessonsCharge(s, pricePerUE);
  const free = (s.costItems || []).reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
  return auto + free;
}
function sumPayments(s) {
  return (s.payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
}
function lessonUE(s) {
  return (s.drivenLessons || []).reduce((sum, l) => sum + (Number(l.minutes) || 0), 0) / 45;
}

// "offen" = Rechnung über erbrachte Leistungen; "guthaben" = vorab aufgeladen, Leistungen werden nie zusätzlich berechnet
function abrechnungsModell(s, standard) {
  const eigen = s && s.abrechnungsModell;
  if (eigen === "guthaben" || eigen === "offen") return eigen;
  return standard === "guthaben" ? "guthaben" : "offen";
}

// Offene Posten als Rechnungszeilen – gleich für Fahrlehrer-Rechnung und Rechnung aus der Schülerakte
function rechnungsEntwurfZeilen(stu, price, standardModell, ohneAusgenommene) {
  const rows = [];
  if (!stu) return rows;
  if (abrechnungsModell(stu, standardModell) === "guthaben") return rows;
  const billableById = {};
  lessonBillables(stu, price).forEach((b) => { billableById[b.lesson.id] = b.amount; });
  const byPrice = {};
  (stu.drivenLessons || []).filter((l) => !l.invoiced && !(ohneAusgenommene && l.nichtBerechnen)).forEach((l) => {
    const einzel = Math.round((billableById[l.id] || 0) * 100) / 100;
    if (einzel <= 0.005) return;
    const k = String(einzel);
    if (!byPrice[k]) byPrice[k] = { einzel, ids: [], anzahl: 0, daten: [] };
    byPrice[k].ids.push(l.id);
    byPrice[k].anzahl += 1;
    if (/^\d{4}-\d{2}-\d{2}$/.test(l.date || "")) byPrice[k].daten.push(l.date);
  });
  Object.keys(byPrice).forEach((k) => {
    const g = byPrice[k];
    g.daten.sort();
    rows.push({ key: "lessons:" + k, kind: "lessongroup", ids: g.ids,
      von: g.daten[0] || "", bis: g.daten[g.daten.length - 1] || "",
      label: g.anzahl + " " + (g.anzahl === 1 ? "Fahrstunde" : "Fahrstunden") + (g.einzel > 0 ? " à " + eurFmt(g.einzel) : ""),
      date: "", amount: Math.round(g.einzel * g.anzahl * 100) / 100 });
  });
  (stu.costItems || []).forEach((it, idx) => {
    if (!it.invoiced && !(ohneAusgenommene && it.nichtBerechnen))
      rows.push({ key: "cost:" + (it.id || idx), id: it.id || null, idx, kind: "cost", label: it.label || "", date: "", amount: Number(it.amount) || 0 });
  });
  return rows;
}

function rechnungsPostenAusZeilen(chosen) {
  return chosen.map((r) => (r.kind === "lessongroup" && r.von
    ? { label: r.label, amount: r.amount, date: r.date || "", von: r.von, bis: r.bis || r.von }
    : { label: r.label, amount: r.amount, date: r.date || "" }));
}

// Je abgerechneter Fahrstunde eingefrorene Paket-UE und Preis je UE – an create_invoice (Schul-Weg)
function rechnungsSchnappschuss(stu, price, lessonIds) {
  const covered = {};
  lessonBillables(stu, price).forEach((b) => { covered[b.lesson.id] = b.coveredUE; });
  const out = {};
  (stu.drivenLessons || []).forEach((l) => {
    if (lessonIds.indexOf(l.id) >= 0) out[l.id] = { invoicedCoveredUE: covered[l.id] || 0, invoicedPrice: lessonPricePerUE(l, price) };
  });
  return out;
}

// Leistungszeitraum (§ 14 Abs. 4 Nr. 6 UStG); eine Stornorechnung übernimmt den Zeitraum der stornierten
function rechnungsLeistungszeitraum(s, inv) {
  if (!inv) return null;
  const quelle = inv.stornoOf ? ((s && s.invoices) || []).find((x) => x.number === inv.stornoOf) : inv;
  if (!quelle) return null;
  const daten = [];
  const iso = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
  (quelle.items || []).forEach((it) => [it.von, it.bis, it.date].forEach((d) => { if (iso(d)) daten.push(d); }));
  if (daten.length === 0) ((s && s.drivenLessons) || []).forEach((l) => { if (l.invoiced === quelle.number && iso(l.date)) daten.push(l.date); });
  if (daten.length === 0) return null;
  daten.sort();
  return { von: daten[0], bis: daten[daten.length - 1] };
}

function rechnungKleinunternehmer(s, inv, fallback) {
  const orig = inv && inv.stornoOf ? ((s && s.invoices) || []).find((x) => x && x.number === inv.stornoOf) : null;
  const quelle = orig || inv;
  return quelle && quelle.kleinunternehmer != null ? !!quelle.kleinunternehmer : !!fallback;
}

module.exports = { eurFmt, lessonPricePerUE, packageCreditUE, rekonstruierteDeckungUE, abgerechneterStandardpreis, lessonBillables, lessonsCharge, sumCharges, sumPayments, lessonUE, abrechnungsModell, rechnungsEntwurfZeilen, rechnungsPostenAusZeilen, rechnungsSchnappschuss, rechnungsLeistungszeitraum, rechnungKleinunternehmer };
