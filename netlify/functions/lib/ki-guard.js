// Gemeinsamer Zugriffsschutz fuer die Anthropic-abrechnenden KI-Functions.
//
// Die Functions pruefen selbst bereits: gueltiges Bearer-Token (irgendeine Session) + Sperre
// des oeffentlichen Demo-Accounts. Das reicht aber nicht: die Registrierung ist offen, also
// koennte sich jeder ein kostenloses Konto anlegen und danach unbegrenzt teure KI-Aufrufe
// ausloesen (Anthropic-Kostenmissbrauch, und kostenpflichtige Features gratis).
//
// subscriptionGate ergaenzt daher: nur Konten mit aktivem Abo (profiles.subscription_active)
// duerfen KI ausloesen. Gelesen wird das EIGENE Profil des Anfragenden ueber sein eigenes Token
// (RLS: eigene Zeile ist lesbar) - kein Service-Role noetig.
//
// Bewusst FAIL-OPEN bei Infrastruktur-/Leseproblemen (Netzwerk, unerwartete Antwort): lieber im
// seltenen Stoerfall einen KI-Aufruf durchlassen, als einen zahlenden Fahrlehrer faelschlich
// auszusperren. Geblockt wird nur, wenn das Profil eindeutig gelesen wurde UND kein aktives Abo
// traegt. Betriebsvoraussetzung: alle echten Fahrlehrer muessen im Admin-Panel aktiviert sein.

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdnVmdGxmbmtudWN4dW9ydGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDQ2NDQsImV4cCI6MjA5Njg4MDY0NH0.5ZoBdQLnJw23dMZ4IKmAauycVcPoVPIZdmNamZ8MEv8";

// Gibt { ok: true } zurueck, wenn der Aufruf erlaubt ist, sonst { ok: false, statusCode, error }.
async function subscriptionGate(uid, token) {
  // Ohne uid/token ist die Auth-Pruefung Sache der Function selbst - hier nicht zusaetzlich blocken.
  if (!uid || !token) return { ok: true };
  try {
    const resp = await fetch(
      SUPABASE_URL + "/rest/v1/profiles?id=eq." + encodeURIComponent(uid) + "&select=subscription_active",
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token } }
    );
    if (resp.ok) {
      const rows = await resp.json().catch(() => null);
      const prof = Array.isArray(rows) ? rows[0] : null;
      if (prof && prof.subscription_active !== true) {
        return {
          ok: false,
          statusCode: 402,
          error: "Diese KI-Funktion ist Teil des Abos. Bitte schalte deinen Zugang frei.",
        };
      }
    }
    // resp nicht ok / Profil nicht eindeutig gelesen -> fail open
  } catch (e) {
    // Netzwerk-/Parsefehler -> fail open
  }
  return { ok: true };
}

module.exports = { subscriptionGate };
