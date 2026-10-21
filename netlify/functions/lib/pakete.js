// Autopilot-Pakete (Fabian 21.10.2026): Die Verwaltung im Autopilot ist kostenlos, die KI gibt es in Paketen –
// Teilautonom (die KI bereitet vor) und Vollautonom (die KI erledigt, was der Admin einschaltet). Gebucht wird über
// Stripe; die Preise legt der zentrale Admin in app_settings.autopilot_preise fest. Ohne Netz testbar.

const PAKETE = {
  teilautonom: { name: "Teilautonom", rang: 1 },
  vollautonom: { name: "Vollautonom", rang: 2 },
};
// Was die KI in Vollautonom selbst erledigen darf – einzeln vom Admin einzuschalten (schools.ki_autonomie), Start: alles aus
const AUTONOMIE = ["mails_alle", "erinnerungen", "zahlungen_buchen", "belege_buchen", "abrechnen", "werkstatt_termine"];

// Preis in Cent aus den Einstellungen (Euro je Monat); null, wenn keiner festgelegt ist
function preisCent(preise, paket) {
  const e = Number(preise && preise[paket]);
  return Number.isFinite(e) && e >= 1 && e <= 10000 ? Math.round(e * 100) : null;
}

// Wohin Stripe nach dem Bezahlen zurückleitet: nur bekannte Adressen des Autopiloten
const ZIELE = ["https://autopilot.allindrive.app", "http://localhost:5240", "http://localhost:5241"];
function rueckweg(origin) {
  const o = String(origin || "").replace(/\/+$/, "");
  return ZIELE.indexOf(o) >= 0 ? o : ZIELE[0];
}

// Stripe-Abo → Paket der Fahrschule. Bezahlt (oder in der Probezeit, oder Zahlung gerade fehlgeschlagen und noch in
// der Frist) gilt das Paket bis zum Ende des bezahlten Zeitraums; gekündigt oder unbezahlt: keins.
function paketAusAbo(abo) {
  const a = abo || {};
  const paket = PAKETE[a.metadata && a.metadata.paket] ? a.metadata.paket : null;
  const ende = Number(a.current_period_end || (a.items && a.items.data && a.items.data[0] && a.items.data[0].current_period_end) || 0);
  const aktiv = ["active", "trialing", "past_due"].indexOf(a.status) >= 0;
  return {
    paket: aktiv ? paket : null,
    bis: aktiv && ende > 0 ? new Date(ende * 1000).toISOString() : null,
  };
}

module.exports = { PAKETE, AUTONOMIE, preisCent, rueckweg, paketAusAbo };
