// Kleine Hülle um die Supabase-REST-Schnittstelle mit dem Service-Schlüssel (nur Server).
// Für Functions, die ohne angemeldeten Fahrlehrer laufen (Zeitjobs) oder Tresor-Funktionen brauchen.

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";

function dienst(serviceKey) {
  const kopf = (extra) => ({ apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", ...(extra || {}) });
  async function pruefe(resp, was) {
    if (resp.ok)
      return resp.status === 204 ? null : resp.json().catch(() => null);
    const text = await resp.text().catch(() => "");
    throw Object.assign(new Error(was + " " + resp.status + (text ? " " + text.slice(0, 200) : "")), { status: resp.status });
  }
  return {
    url: SUPABASE_URL,
    rpc: async (name, args) => pruefe(await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, { method: "POST", headers: kopf(), body: JSON.stringify(args || {}) }), "rpc " + name),
    lesen: async (pfad) => pruefe(await fetch(SUPABASE_URL + "/rest/v1/" + pfad, { headers: kopf() }), "lesen"),
    // Anzahl der Zeilen (HEAD mit count=exact)
    zaehlen: async (pfad) => {
      const r = await fetch(SUPABASE_URL + "/rest/v1/" + pfad, { method: "HEAD", headers: kopf({ Prefer: "count=exact" }) });
      if (!r.ok)
        throw Object.assign(new Error("zaehlen " + r.status), { status: r.status });
      return Number(((r.headers.get("content-range") || "").split("/")[1] || "0").trim()) || 0;
    },
    // Ändern; mitZeilen: die geänderten Zeilen zurückgeben (leer = der Filter traf nichts mehr)
    aendern: async (tabelle, filter, daten, mitZeilen) => pruefe(await fetch(SUPABASE_URL + "/rest/v1/" + tabelle + "?" + filter, {
      method: "PATCH", headers: kopf({ Prefer: mitZeilen ? "return=representation" : "return=minimal" }), body: JSON.stringify(daten) }), "aendern " + tabelle),
    // Einfügen; doppelte (laut eindeutigem Index) werden still übersprungen
    einfuegen: async (tabelle, daten, ignorieren) => pruefe(await fetch(SUPABASE_URL + "/rest/v1/" + tabelle, {
      method: "POST", headers: kopf({ Prefer: "return=representation" + (ignorieren ? ",resolution=ignore-duplicates" : "") }), body: JSON.stringify(daten) }), "einfuegen " + tabelle),
  };
}

// Angemeldeten Benutzer zum Token holen (Anon-Schlüssel genügt)
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdnVmdGxmbmtudWN4dW9ydGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDQ2NDQsImV4cCI6MjA5Njg4MDY0NH0.5ZoBdQLnJw23dMZ4IKmAauycVcPoVPIZdmNamZ8MEv8";
async function benutzerAusToken(token) {
  if (!token)
    return null;
  try {
    const r = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token } });
    if (!r.ok)
      return null;
    const d = await r.json().catch(() => null);
    return d && d.id ? d : null;
  }
  catch (e) {
    return null;
  }
}
// Eine RPC mit dem Token des Fahrlehrers (RLS und auth.uid() greifen wie in der App)
async function rpcAlsBenutzer(token, name, args) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, { method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(args || {}) });
  if (!r.ok)
    return null;
  return r.json().catch(() => null);
}

// Öffentliche Basis-Adresse der App (Buchungslink im Steckbrief der KI)
const APP_URL = "https://allindrive.netlify.app";

module.exports = { dienst, benutzerAusToken, rpcAlsBenutzer, SUPABASE_URL, APP_URL };
