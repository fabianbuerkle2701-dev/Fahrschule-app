// Netlify Function: ein Nutzer löscht sein EIGENES Konto vollständig (Profil, Schüler, Termine,
// Dateien und das Anmelde-Konto bei Supabase). Pflicht nach Art. 17 DSGVO und für Apps im
// App Store (Konto-Löschung muss in der App selbst möglich sein).
//
// Vertrag (für den Knopf in der App):
//   POST, Header "Authorization: Bearer <Session-Token>", Body {"confirm":"LÖSCHEN"}
//   Antwort {ok:true} oder {error:"<verständliche deutsche Meldung>"}
//
// Dieselben Schritte und Vorab-Prüfungen wie admin-delete-account.js (gemeinsam in
// lib/konto-loeschen.js) - nur dass hier niemand ein FREMDES Konto löschen kann: die Ziel-ID
// kommt ausschließlich aus dem geprüften Token, nie aus dem Body. Der Service-Role-Key lebt nur
// als Netlify-Umgebungsvariable.
//
// Was eine Löschung blockiert, wird NICHT stillschweigend aufgelöst (siehe Begründung in
// admin-delete-account.js): Rechnungen unterliegen der Aufbewahrungspflicht, an Kollegen
// freigegebene Schüler würden auch bei diesen verschwinden, und Prüfungstermine/Reflexionen/
// Anwesenheiten/Gutscheine/Löschprotokoll hängen per Fremdschlüssel am Konto. In diesen Fällen
// antwortet die Function mit einer Erklärung, was vorher zu klären ist - angefasst wird nichts.
//
// Fahrschule (Abschluss-Audit 2026-09): schools hängt an keinem Konto, beim Löschen blieb die
// eigene Fahrschule samt Stammdaten stehen. Jetzt:
//   - einziger Admin einer Fahrschule MIT Kollegen: Löschung wird abgelehnt (409). Sonst hätte
//     die Schule keinen Admin mehr, und nur der Support kann einen neuen bestimmen - die Kollegen
//     kämen bis dahin nicht mehr an Standorte, Preise, Rechnungsdaten und Einladungen.
//   - letztes Mitglied: die Fahrschule wird nach dem Konto mitgelöscht. Bewusst NICHT abgelehnt:
//     die Konto-Löschung muss in der App selbst möglich sein (Art. 17, App Store), und niemand
//     sonst braucht die Schule noch. Hängen noch Videos oder Gutscheine anderer Konten an ihr
//     (würden per CASCADE mitgehen), bleibt sie stehen und die Reste stehen im Log.

const { SUPABASE_URL, pruefeBlocker, sammleDateipfade, loescheAuthKonto, loescheDateien, loescheLeereSchule } = require("./lib/konto-loeschen");

// Das öffentliche Demo-Konto teilen sich alle Interessenten - es darf niemand löschen.
const DEMO_UID = "114d1f0a-9947-459d-8009-06282799ca44";
// Der zentrale App-Admin hängt an festen IDs im Code und in Policies - nicht per Knopfdruck.
const ADMIN_UID = "96530a9f-28ae-4ac6-9cfa-26de392ecf05";
const BESTAETIGUNG = "LÖSCHEN";

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
  const fehler = (statusCode, error) => ({ statusCode, headers, body: JSON.stringify({ error }) });

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return fehler(405, "Nur POST erlaubt");

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error("delete-own-account: SUPABASE_SERVICE_ROLE_KEY fehlt");
    return fehler(500, "Das Löschen ist gerade nicht möglich. Bitte später noch einmal versuchen.");
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return fehler(400, "Ungültige Anfrage"); }

  // Bewusste Bestätigung statt eines versehentlichen Doppeltipps - die Löschung ist endgültig.
  if (!body || String(body.confirm || "").trim().toUpperCase() !== BESTAETIGUNG) {
    return fehler(400, "Bitte zur Bestätigung „" + BESTAETIGUNG + "“ eingeben.");
  }

  const reqHeaders = event.headers || {};
  const requesterToken = (reqHeaders.authorization || reqHeaders.Authorization || "").replace(/^Bearer\s+/i, "");
  if (!requesterToken) return fehler(401, "Nicht angemeldet. Bitte neu anmelden und noch einmal versuchen.");

  try {
    // 1) Wer fragt? Die zu löschende ID kommt NUR aus dem geprüften Token.
    const whoResp = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: serviceKey, Authorization: "Bearer " + requesterToken },
    });
    if (!whoResp.ok) return fehler(401, "Deine Anmeldung ist abgelaufen. Bitte neu anmelden und noch einmal versuchen.");
    const who = await whoResp.json().catch(() => null);
    const uid = who && who.id;
    if (!uid) return fehler(401, "Deine Anmeldung ist abgelaufen. Bitte neu anmelden und noch einmal versuchen.");
    if (uid === DEMO_UID) return fehler(403, "Das Demo-Konto kann nicht gelöscht werden.");
    if (uid === ADMIN_UID) return fehler(403, "Das zentrale Admin-Konto kann nicht über die App gelöscht werden.");

    // 2) Vorab-Prüfung (nur lesen): was würde die Löschung blockieren?
    const pruefung = await pruefeBlocker(serviceKey, uid);
    if (pruefung.fehler) {
      console.error("delete-own-account: " + pruefung.fehler);
      return fehler(502, "Die Löschung konnte gerade nicht geprüft werden. Bitte später noch einmal versuchen.");
    }
    const { students, withInvoices, shared, otherRefs, schule } = pruefung;
    const gruende = [];
    if (withInvoices.length) {
      gruende.push("Für " + withInvoices.length + " Schüler gibt es Rechnungen. Rechnungen unterliegen der gesetzlichen Aufbewahrungspflicht und dürfen nicht einfach mitgelöscht werden.");
    }
    if (shared.length) {
      gruende.push(shared.length + (shared.length === 1 ? " Schüler ist" : " Schüler sind") +
        " mit Kollegen geteilt und würde" + (shared.length === 1 ? "" : "n") +
        " auch bei ihnen verschwinden. Gib " + (shared.length === 1 ? "ihn" : "sie") + " vorher an einen Kollegen ab oder entferne die Freigabe.");
    }
    if (otherRefs.length) {
      gruende.push("Mit deinem Konto sind noch Daten verknüpft, die aufbewahrt werden müssen: " + otherRefs.join(", ") + ".");
    }
    if (schule && schule.istAdmin && schule.andereMitglieder > 0 && schule.andereAdmins === 0) {
      gruende.push("Du bist der einzige Admin deiner Fahrschule" + (schule.name ? " „" + schule.name + "“" : "") +
        ". Ohne dich könnte niemand mehr Standorte, Preise, Rechnungsdaten und Einladungen verwalten. Die Admin-Rolle muss vorher an eine Kollegin oder einen Kollegen übergehen.");
    }
    if (gruende.length) {
      const msg = "Dein Konto kann nicht automatisch gelöscht werden:\n- " + gruende.join("\n- ") +
        "\nBitte melde dich beim Support, dann klären wir die Löschung gemeinsam.";
      return fehler(409, msg);
    }

    // 3) Dateipfade einsammeln, solange ihr Index noch existiert (nur lesen).
    const buckets = await sammleDateipfade(serviceKey, uid);
    if (!buckets) return fehler(502, "Die Löschung konnte gerade nicht vorbereitet werden. Bitte später noch einmal versuchen.");

    // 4) Anmelde-Konto löschen - kaskadiert Profil, Schüler, Termine usw. in einer Transaktion.
    const del = await loescheAuthKonto(serviceKey, uid);
    if (!del.ok) {
      console.error("delete-own-account: auth-Löschung fehlgeschlagen", del.status, del.errData);
      return fehler(502, "Dein Konto konnte gerade nicht gelöscht werden. Es wurde nichts verändert - bitte später noch einmal versuchen.");
    }

    // 5) Erst jetzt die Dateien entfernen. Scheitert das, ist das Konto trotzdem weg - die Reste
    // stehen im Server-Log und werden von Hand entfernt; für den Nutzer ist die Löschung erledigt.
    const { filesDeleted, speicherFehler } = await loescheDateien(serviceKey, buckets);
    if (speicherFehler.length) {
      console.error("delete-own-account: Konto " + uid + " gelöscht, aber Dateien blieben liegen in: " + speicherFehler.join(", "));
    }
    // 6) Letztes Mitglied: die jetzt leere Fahrschule mitlöschen (Begründung oben). Scheitert das,
    // ist das Konto trotzdem weg - die Schule bleibt dann wie bisher stehen und steht im Log.
    let schuleGeloescht = false;
    if (schule && schule.andereMitglieder === 0) {
      if (schule.fremdeVideos > 0 || schule.fremdeGutscheine > 0) {
        console.error("delete-own-account: Fahrschule " + schule.id + " bleibt stehen - es hängen noch " +
          (schule.fremdeVideos > 0 ? "Videos" : "Gutscheine") + " anderer Konten daran.");
      } else {
        const sd = await loescheLeereSchule(serviceKey, schule.id);
        if (sd.ok) schuleGeloescht = true;
        else console.error("delete-own-account: Konto " + uid + " gelöscht, aber Fahrschule " + schule.id + " blieb stehen (HTTP " + sd.status + ").");
      }
    }
    console.log("delete-own-account: Konto " + uid + " vom Nutzer selbst gelöscht - " + students.length + " Schüler, " + filesDeleted + " Dateien entfernt" + (schuleGeloescht ? ", leere Fahrschule " + schule.id + " mitgelöscht" : "") + ".");
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error("delete-own-account: Serverfehler", e);
    return fehler(500, "Das Löschen ist gerade nicht möglich. Bitte später noch einmal versuchen.");
  }
};
