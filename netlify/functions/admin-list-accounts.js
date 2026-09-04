// Netlify Function: listet alle registrierten Konten (E-Mail, Erstellungsdatum, letzter Login)
// zusammen mit den zugehörigen Profildaten. Nur der zentrale App-Admin darf das abrufen.

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
const ADMIN_UID = "96530a9f-28ae-4ac6-9cfa-26de392ecf05";

// Holt eine komplette PostgREST-Tabelle seitenweise und gibt Fehler zurück, statt sie zu schlucken.
// Vorher wurde genau eine Antwort ohne Range-Header geholt und jeder Fehlerstatus zu einer leeren
// Liste umgedeutet: das Admin-Panel zeigte dann mit HTTP 200 jeden zahlenden Fahrlehrer als
// "kein Abo / keine Fahrschule" - direkt neben dem endgültigen "Löschen"-Knopf. Aus demselben Grund
// wird jetzt geblättert: eine serverseitige Zeilen-Kappung würde für die überzähligen Profile
// exakt dieselbe Falschanzeige erzeugen.
async function ladeAlleZeilen(pfad, serviceKey) {
  const zeilen = [];
  const proSeite = 1000;
  while (zeilen.length < 20000) {
    const von = zeilen.length;
    const resp = await fetch(SUPABASE_URL + "/rest/v1/" + pfad, {
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
        Range: von + "-" + (von + proSeite - 1),
        Prefer: "count=exact",
      },
    });
    if (!resp.ok) return { ok: false, status: resp.status, detail: await resp.text().catch(() => "") };
    const seite = await resp.json();
    const liste = Array.isArray(seite) ? seite : [];
    liste.forEach((z) => zeilen.push(z));
    if (liste.length === 0) break;
    // Content-Range sieht aus wie "0-49/120" - der Teil hinter dem Schrägstrich ist die Gesamtzahl
    const gesamt = Number(((resp.headers.get("content-range") || "").split("/")[1] || "").trim());
    if (Number.isFinite(gesamt) ? zeilen.length >= gesamt : liste.length < proSeite) break;
  }
  return { ok: true, zeilen: zeilen };
}

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers, body: JSON.stringify({ error: "Nur GET erlaubt" }) };

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "Kein Service-Role-Key hinterlegt (SUPABASE_SERVICE_ROLE_KEY)." }) };

  const requesterToken = (event.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!requesterToken) return { statusCode: 401, headers, body: JSON.stringify({ error: "Nicht angemeldet" }) };

  try {
    const whoResp = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: serviceKey, Authorization: "Bearer " + requesterToken },
    });
    if (!whoResp.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: "Sitzung ungültig" }) };
    const who = await whoResp.json();
    if (!who || who.id !== ADMIN_UID) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Nur der zentrale App-Admin darf diese Liste sehen." }) };
    }

    // Alle Auth-Konten holen (Supabase liefert Seiten zu je 50, wir holen bis zu 500)
    let allUsers = [];
    for (let page = 1; page <= 10; page++) {
      const resp = await fetch(SUPABASE_URL + "/auth/v1/admin/users?page=" + page + "&per_page=50", {
        headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
      });
      if (!resp.ok) break;
      const data = await resp.json();
      const users = (data && data.users) || [];
      allUsers = allUsers.concat(users);
      if (users.length < 50) break;
    }

    // Profile dazu laden (Fahrschule, Admin-Status, Abo-Status)
    const profRes = await ladeAlleZeilen("profiles?select=id,email,school_id,school_admin,subscription_active,subscription_amount,subscription_last_paid,theory_addon_active,subscription_lifetime", serviceKey);
    if (!profRes.ok) {
      console.error("admin-list-accounts: profiles-Abfrage fehlgeschlagen", profRes.status, profRes.detail);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Die Kontendaten konnten gerade nicht geladen werden. Bitte versuch es gleich noch einmal." }) };
    }
    const profById = {};
    profRes.zeilen.forEach((p) => { profById[p.id] = p; });

    // Fahrschulnamen dazu, damit man nicht nur die ID sieht
    const schoolRes = await ladeAlleZeilen("schools?select=id,name", serviceKey);
    if (!schoolRes.ok) {
      console.error("admin-list-accounts: schools-Abfrage fehlgeschlagen", schoolRes.status, schoolRes.detail);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Die Kontendaten konnten gerade nicht geladen werden. Bitte versuch es gleich noch einmal." }) };
    }
    const schoolNameById = {};
    schoolRes.zeilen.forEach((s) => { schoolNameById[s.id] = s.name; });

    const result = allUsers.map((u) => {
      const prof = profById[u.id] || {};
      return {
        id: u.id,
        email: u.email || prof.email || "(keine E-Mail)",
        created_at: u.created_at || null,
        last_sign_in_at: u.last_sign_in_at || null,
        school_name: prof.school_id ? (schoolNameById[prof.school_id] || "unbekannt") : null,
        school_admin: !!prof.school_admin,
        is_central_admin: u.id === ADMIN_UID,
        subscription_active: !!prof.subscription_active,
        // Kein "|| null": der Betrag 0 ist gewollt ("beitragsfrei, aber Abo aktiv") und darf nicht
        // zu null werden - das Panel zeigt sonst wieder "Betrag festlegen" statt "0,00 €/Monat"
        subscription_amount: prof.subscription_amount != null ? prof.subscription_amount : null,
        subscription_last_paid: prof.subscription_last_paid != null ? prof.subscription_last_paid : null,
        theory_addon_active: !!prof.theory_addon_active,
        // Wurde geladen, aber nie ausgeliefert: dadurch war der Lifetime-Schalter im Admin-Panel
        // immer "aus", der Abo-Schalter nie gesperrt und ein vergebener Lifetime-Zugang
        // nach dem Neuladen nicht mehr entziehbar (toggleLifetime schickte immer "true")
        subscription_lifetime: !!prof.subscription_lifetime,
      };
    }).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

    return { statusCode: 200, headers, body: JSON.stringify({ accounts: result }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
