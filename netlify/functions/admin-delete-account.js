// Netlify Function: löscht ein Nutzerkonto vollständig (Profil + echtes Anmelde-Konto bei Supabase).
// Läuft NUR auf dem Server, niemals im Browser, weil dafür der mächtige Service-Role-Key nötig ist.
// Dieser Schlüssel wird ausschließlich als Netlify-Umgebungsvariable gespeichert, nie im App-Code.
//
// Überarbeitet (Audit-Fund): die Funktion löschte bisher zuerst die profiles-Zeile per eigenem
// Request und erst danach das eigentliche Auth-Konto - schlug Schritt 2 fehl (siehe unten, das
// betraf praktisch jeden produktiven Fahrlehrer), blieb ein halb gelöschtes Konto zurück: Login
// funktioniert noch, aber ohne Profil, ohne school_id, ohne Abo, ohne jeden Reparaturweg. Die
// profiles-Zeile fällt ohnehin per `profiles_id_fkey ... ON DELETE CASCADE` mit dem Auth-Konto -
// der separate Schritt war nicht nur riskant, sondern überflüssig.
//
// Fünf Tabellen (deletion_log, exam_slots, lesson_reflections, theory_attendance, vouchers)
// verweisen mit NOT NULL-Spalten OHNE eigene ON-DELETE-Regel auf auth.users. Ein direkter
// auth.users-DELETE scheitert deshalb mit einem generischen Datenbankfehler, sobald der
// Fahrlehrer auch nur eine Zeile dort hinterlassen hat (Prüfungstermin, Fahrstunden-Reflexion,
// Theorie-Anwesenheit, Gutschein oder - über eine frühere Schüler-Löschung - einen
// deletion_log-Eintrag). Diese Verweise NICHT stillschweigend aufzulösen (z.B. per SET NULL) ist
// hier bewusst: die Daten dahinter unterliegen teils denselben Aufbewahrungspflichten wie das
// Löschprotokoll selbst (§31 FahrlG, Anlage 1 FahrschAusbO), und was mit ihnen beim Abgang eines
// Fahrlehrers geschehen soll, ist eine Entscheidung des Betreibers, keine, die diese Funktion für
// ihn treffen darf. Statt eines kryptischen 500ers prüft die Funktion jetzt VORAB, was blockiert,
// und meldet es konkret - nichts wird angefasst, solange etwas im Weg steht.
//
// Zusätzlich: die Dateien in den Storage-Buckets (staff-files/student-files/videos) wurden bisher
// nie gelöscht, obwohl ihr einziger Index (die *_files-/videos-Zeilen) mit dem Konto verschwindet -
// personenbezogene Dokumente blieben unauffindbar, aber vorhanden liegen. Die Pfade werden jetzt vor
// der Kontolöschung ausgelesen (reines Lesen), die Objekte selbst aber erst NACH dem erfolgreichen
// Auth-Delete entfernt (siehe Schritt 3/5 unten, mit Begründung) - schlägt die Datei-Löschung
// trotzdem fehl, ist das Konto bereits sauber weg, es bleiben nur Aufräum-Reste im Server-Log.

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
// Nur der zentrale App-Admin darf diese Funktion nutzen (dieselbe feste ID wie im Rest der App).
const ADMIN_UID = "96530a9f-28ae-4ac6-9cfa-26de392ecf05";

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Nur POST erlaubt" }) };

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "Kein Service-Role-Key hinterlegt (SUPABASE_SERVICE_ROLE_KEY)." }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Ungültige Anfrage" }) }; }

  const requesterToken = (event.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const targetUid = body.targetUid;
  if (!requesterToken) return { statusCode: 401, headers, body: JSON.stringify({ error: "Nicht angemeldet" }) };
  if (!targetUid) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Ziel-ID angegeben" }) };

  const sbFetch = (path, init) =>
    fetch(SUPABASE_URL + "/rest/v1/" + path, {
      ...(init || {}),
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, ...((init && init.headers) || {}) },
    });

  try {
    // 1) Prüfen, wer die Anfrage stellt: den Anfragenden per Token identifizieren
    const whoResp = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: serviceKey, Authorization: "Bearer " + requesterToken },
    });
    if (!whoResp.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: "Sitzung ungültig" }) };
    const who = await whoResp.json();
    if (!who || who.id !== ADMIN_UID) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Nur der zentrale App-Admin darf Konten löschen." }) };
    }
    if (targetUid === ADMIN_UID) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Das eigene Admin-Konto kann hier nicht gelöscht werden." }) };
    }

    // 2) Vorab-Prüfung: Umfang ermitteln und alles einsammeln, was eine Löschung blockieren würde -
    // bevor irgendetwas angefasst wird. Fünf Fremdschlüssel (siehe Kommentar oben) lassen einen
    // direkten auth.users-DELETE scheitern, sobald dort Zeilen existieren; das students-owner-CASCADE
    // löst zusätzlich den Rechnungs-Schutz-Trigger aus, sobald ein Schüler dieses Kontos eine
    // Rechnung hat, UND es dürfen keine an Kollegen mitfreigegebenen Schüler stillschweigend
    // mitgerissen werden.
    const uid = encodeURIComponent(targetUid);
    const [studentsResp, examResp, reflResp, theoryResp, voucherResp, delLogResp] = await Promise.all([
      sbFetch("students?owner=eq." + uid + "&select=id,name,data,shared_with"),
      sbFetch("exam_slots?owner=eq." + uid + "&select=id&limit=1"),
      sbFetch("lesson_reflections?owner=eq." + uid + "&select=id&limit=1"),
      sbFetch("theory_attendance?owner=eq." + uid + "&select=id&limit=1"),
      sbFetch("vouchers?created_by=eq." + uid + "&select=id&limit=1"),
      sbFetch("deletion_log?deleted_by=eq." + uid + "&select=id&limit=1"),
    ]);
    for (const [name, r] of [["Schüler", studentsResp], ["Prüfungstermine", examResp], ["Fahrstunden-Reflexionen", reflResp], ["Theorie-Anwesenheiten", theoryResp], ["Gutscheine", voucherResp], ["Löschprotokoll", delLogResp]]) {
      if (!r.ok) return { statusCode: 502, headers, body: JSON.stringify({ error: "Vorab-Prüfung fehlgeschlagen (" + name + "): " + r.status }) };
    }
    const students = (await studentsResp.json()) || [];
    const withInvoices = students.filter((s) => Array.isArray(s.data && s.data.invoices) && s.data.invoices.length > 0);
    const shared = students.filter((s) => Array.isArray(s.shared_with) && s.shared_with.length > 0);
    const otherRefs = [];
    if ((await examResp.json()).length) otherRefs.push("Prüfungstermine");
    if ((await reflResp.json()).length) otherRefs.push("Fahrstunden-Reflexionen");
    if ((await theoryResp.json()).length) otherRefs.push("Theorie-Anwesenheiten");
    if ((await voucherResp.json()).length) otherRefs.push("Gutscheine");
    if ((await delLogResp.json()).length) otherRefs.push("Einträge im Löschprotokoll");

    const blockers = [];
    if (withInvoices.length) blockers.push(withInvoices.length + " Schüler mit Rechnungen (Aufbewahrungspflicht) - zuerst entscheiden, was mit diesen Konten geschehen soll");
    if (shared.length) blockers.push(shared.length + " an Kollegen mitfreigegebene Schüler - würden sonst auch für den Kollegen ersatzlos verschwinden, zuerst den Besitzer wechseln");
    if (otherRefs.length) blockers.push("Vorhandene Datensätze, die mit diesem Konto verknüpft sind: " + otherRefs.join(", "));
    if (blockers.length) {
      // Der Client zeigt bisher nur `error` an (kein eigener Umgang mit `blockers`) - die Liste
      // deshalb direkt in die Meldung einbetten, sonst sieht der Admin nur "geht nicht", ohne zu
      // erfahren, was zuerst zu klären ist.
      const msg = "Konto kann nicht automatisch gelöscht werden:\n" + blockers.map((b) => "- " + b).join("\n");
      return { statusCode: 409, headers, body: JSON.stringify({ error: msg, blockers }) };
    }

    // 3) Dateipfade in den Storage-Buckets einsammeln (reines Lesen, nichts Destruktives) - solange
    // ihr Index (die *_files-/videos-Zeilen) noch existiert, danach wären die Pfade nicht mehr
    // auffindbar. Die eigentliche Löschung passiert bewusst ERST NACH Schritt 5 (siehe dort): ein
    // erster Entwurf hat die Dateien HIER schon entfernt, bevor der finale auth.users-Delete
    // bestätigt war - drei unabhängige Prüfungen haben denselben Fehler gefunden: schlägt der
    // finale Schritt danach doch noch fehl (Netzwerkfehler, ein zwischenzeitlich neu entstandener
    // Blocker), bleibt das Konto vollständig aktiv, aber seine Dokumente sind schon unwiderruflich
    // weg - ein neuer, subtilerer Halb-Zustand als der urspruengliche Fund. Erst loeschen, WENN das
    // Konto wirklich weg ist, macht den ungünstigen Fall stattdessen zu bloss verwaisten Dateien
    // ohne noch aktives Konto - deutlich harmloser und im Log nachvollziehbar (siehe Schritt 6).
    const [studentFilesResp, staffFilesResp, videosResp] = await Promise.all([
      sbFetch("student_files?owner=eq." + uid + "&select=storage_path"),
      sbFetch("staff_files?instructor_uid=eq." + uid + "&select=storage_path"),
      sbFetch("videos?owner=eq." + uid + "&select=storage_path"),
    ]);
    if (!studentFilesResp.ok || !staffFilesResp.ok || !videosResp.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Dateiliste konnte nicht geladen werden - Löschung abgebrochen." }) };
    }
    const buckets = [
      ["student-files", ((await studentFilesResp.json()) || []).map((r) => r.storage_path)],
      ["staff-files", ((await staffFilesResp.json()) || []).map((r) => r.storage_path)],
      ["videos", ((await videosResp.json()) || []).map((r) => r.storage_path)],
    ];

    // 4) Das eigentliche Anmelde-Konto bei Supabase löschen. Kaskadiert per FK-Constraints Profil,
    // Schüler, Termine, Vorlagen, Kalender-Feeds, Gerätetoken, Interessenten, Widget-Tokens und die
    // *_files-/videos-Zeilen in EINER Transaktion - kein separater Profil-Löschschritt mehr nötig
    // (siehe Kommentar oben). Solange dieser Schritt scheitert, wurde noch NICHTS Destruktives
    // angefasst - nur gelesen -, die Operation ist also gefahrlos wiederholbar.
    const delResp = await fetch(SUPABASE_URL + "/auth/v1/admin/users/" + uid, {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
    });
    if (!delResp.ok) {
      const errData = await delResp.json().catch(() => ({}));
      console.error("admin-delete-account: auth-Löschung fehlgeschlagen", delResp.status, errData);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Konto konnte nicht gelöscht werden: " + (errData.msg || errData.error || delResp.status) }) };
    }

    // 5) Erst jetzt, wo das Konto nachweislich weg ist, die Dateien in den Storage-Buckets aktiv
    // entfernen. Scheitert das noch, ist der Schaden begrenzt und im Log sichtbar: das Konto ist
    // sauber vollständig gelöscht, es bleiben nur verwaiste, nicht mehr adressierbare Dateileichen
    // zurück (dieselbe Restlücke wie beim ursprünglichen Audit-Fund, aber ohne ein noch aktives
    // Konto mit lautlos kaputten Dokumenten).
    let filesDeleted = 0;
    const speicherFehler = [];
    for (const [bucket, paths] of buckets) {
      if (!paths.length) continue;
      try {
        const rmResp = await fetch(SUPABASE_URL + "/storage/v1/object/" + bucket, {
          method: "DELETE",
          headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" },
          body: JSON.stringify({ prefixes: paths }),
        });
        if (!rmResp.ok) { speicherFehler.push(bucket + " (" + paths.length + " Dateien, HTTP " + rmResp.status + ")"); continue; }
        filesDeleted += paths.length;
      } catch (e) {
        speicherFehler.push(bucket + " (" + paths.length + " Dateien, " + (e.message || "Netzwerkfehler") + ")");
      }
    }
    if (speicherFehler.length) {
      // Das Konto ist zu diesem Zeitpunkt bereits unwiderruflich gelöscht - das hier ist bewusst
      // KEIN Abbruch mehr, sondern nur noch eine Aufräum-Warnung mit konkreten Pfaden im Log, damit
      // die verwaisten Dateien manuell nachträglich entfernt werden können.
      console.error("admin-delete-account: Konto " + targetUid + " gelöscht, aber Dateien blieben liegen in: " + speicherFehler.join(", "));
    }

    console.log("admin-delete-account: Konto " + targetUid + " gelöscht durch " + who.id + " - " + students.length + " Schüler, " + filesDeleted + " Dateien entfernt" + (speicherFehler.length ? (", " + speicherFehler.length + " Bucket(s) mit Resten") : "") + ".");
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        ok: true, deletedStudents: students.length, deletedFiles: filesDeleted,
        warning: speicherFehler.length ? "Konto gelöscht, aber einige Dateien konnten nicht entfernt werden (siehe Server-Log): " + speicherFehler.join(", ") : undefined,
      }),
    };
  } catch (e) {
    // Dieser Block kann auch VOR der Admin-Prüfung greifen (z.B. wenn schon der Auth-Aufruf
    // scheitert) - Details gehören dann ins Server-Log, nicht in die Antwort. Gleiches Muster wie
    // admin-set-subscription.js.
    console.error("admin-delete-account: Serverfehler", e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler. Bitte später noch einmal versuchen." }) };
  }
};
