// Gemeinsame Schritte zum vollständigen Löschen eines Nutzerkontos, genutzt von
// admin-delete-account.js (zentraler Admin löscht ein fremdes Konto) und delete-own-account.js
// (Nutzer löscht sein eigenes Konto). Kein eigener Endpoint, nur per require() genutzt.
//
// Beide Wege MÜSSEN exakt dieselben Vorab-Prüfungen und dieselbe Reihenfolge haben - deshalb
// hier an einer Stelle statt zweimal kopiert (die ausführliche Begründung der Reihenfolge steht
// in admin-delete-account.js). Alle Aufrufe laufen mit dem Service-Role-Key, der die RLS bewusst
// umgeht; die Prüfung, WER löschen darf, liegt vorher beim jeweiligen Endpoint.

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";

function restFetch(serviceKey) {
  return (path, init) =>
    fetch(SUPABASE_URL + "/rest/v1/" + path, {
      ...(init || {}),
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, ...((init && init.headers) || {}) },
    });
}

// Schritt 2: alles einsammeln, was eine Löschung blockieren würde - nur lesen.
// Ergebnis: { fehler } bei einem HTTP-Fehler, sonst { students, withInvoices, shared, otherRefs }.
async function pruefeBlocker(serviceKey, targetUid) {
  const sbFetch = restFetch(serviceKey);
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
    if (!r.ok) return { fehler: "Vorab-Prüfung fehlgeschlagen (" + name + "): " + r.status };
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
  return { students, withInvoices, shared, otherRefs };
}

// Schritt 3: Dateipfade der Storage-Buckets einsammeln, solange ihr Index noch existiert.
// Ergebnis: Liste [bucket, pfade] oder null bei einem HTTP-Fehler.
async function sammleDateipfade(serviceKey, targetUid) {
  const sbFetch = restFetch(serviceKey);
  const uid = encodeURIComponent(targetUid);
  const [studentFilesResp, staffFilesResp, videosResp] = await Promise.all([
    sbFetch("student_files?owner=eq." + uid + "&select=storage_path"),
    sbFetch("staff_files?instructor_uid=eq." + uid + "&select=storage_path"),
    sbFetch("videos?owner=eq." + uid + "&select=storage_path"),
  ]);
  if (!studentFilesResp.ok || !staffFilesResp.ok || !videosResp.ok) return null;
  return [
    ["student-files", ((await studentFilesResp.json()) || []).map((r) => r.storage_path)],
    ["staff-files", ((await staffFilesResp.json()) || []).map((r) => r.storage_path)],
    ["videos", ((await videosResp.json()) || []).map((r) => r.storage_path)],
  ];
}

// Schritt 4: das Anmelde-Konto löschen (kaskadiert Profil, Schüler, Termine usw.).
// Ergebnis: { ok: true } oder { ok: false, status, errData }.
async function loescheAuthKonto(serviceKey, targetUid) {
  const delResp = await fetch(SUPABASE_URL + "/auth/v1/admin/users/" + encodeURIComponent(targetUid), {
    method: "DELETE",
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
  });
  if (delResp.ok) return { ok: true };
  const errData = await delResp.json().catch(() => ({}));
  return { ok: false, status: delResp.status, errData };
}

// Schritt 5: erst NACH dem erfolgreichen Konto-Löschen die Dateien entfernen.
// Ergebnis: { filesDeleted, speicherFehler }.
async function loescheDateien(serviceKey, buckets) {
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
  return { filesDeleted, speicherFehler };
}

module.exports = { SUPABASE_URL, pruefeBlocker, sammleDateipfade, loescheAuthKonto, loescheDateien };
