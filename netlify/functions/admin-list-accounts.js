// Netlify Function: listet alle registrierten Konten (E-Mail, Erstellungsdatum, letzter Login)
// zusammen mit den zugehörigen Profildaten. Nur der zentrale App-Admin darf das abrufen.

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
const ADMIN_UID = "96530a9f-28ae-4ac6-9cfa-26de392ecf05";

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
    const profResp = await fetch(SUPABASE_URL + "/rest/v1/profiles?select=id,email,school_id,school_admin,subscription_active,subscription_amount,subscription_last_paid", {
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
    });
    const profiles = profResp.ok ? await profResp.json() : [];
    const profById = {};
    (profiles || []).forEach((p) => { profById[p.id] = p; });

    // Fahrschulnamen dazu, damit man nicht nur die ID sieht
    const schoolResp = await fetch(SUPABASE_URL + "/rest/v1/schools?select=id,name", {
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
    });
    const schools = schoolResp.ok ? await schoolResp.json() : [];
    const schoolNameById = {};
    (schools || []).forEach((s) => { schoolNameById[s.id] = s.name; });

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
        subscription_amount: prof.subscription_amount || null,
        subscription_last_paid: prof.subscription_last_paid || null,
      };
    }).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

    return { statusCode: 200, headers, body: JSON.stringify({ accounts: result }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Serverfehler: " + (e.message || "unbekannt") }) };
  }
};
