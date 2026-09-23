// Gemeinsamer Zugriffsschutz fuer die Anthropic-abrechnenden KI-Functions.
//
// Die Functions pruefen selbst bereits: gueltiges Bearer-Token (irgendeine Session) + Sperre
// des oeffentlichen Demo-Accounts. Das reicht aber nicht: die Registrierung ist offen, also
// koennte sich jeder ein kostenloses Konto anlegen und danach unbegrenzt teure KI-Aufrufe
// ausloesen (Anthropic-Kostenmissbrauch, und kostenpflichtige Features gratis).
//
// subscriptionGate ergaenzt daher zwei Ebenen:
//   1. Abo-Pruefung (profiles.subscription_active) - aktuell bewusst deaktiviert, siehe unten.
//   2. Gemeinsames Tageslimit pro Konto (Kompromiss, Fabian 23.9.2026: kein hartes Abo-Gate
//      reaktivieren, aber auch nicht laenger unbegrenzt). Alle KI-Functions teilen sich EIN
//      Tageskontingent pro Konto (nicht einzeln pro Function - einfacher, und deckelt trotzdem
//      jeden Missbrauchsversuch egal ueber welche Function). Zaehlung serverseitig atomar ueber
//      die RPC public.ki_rate_limit() mit auth.uid() aus dem eigenen Token - kein Service-Role
//      noetig, dieselbe Bauart wie public_chat_rate_limit() fuer die oeffentlichen Functions.
//
// Bewusst FAIL-OPEN bei Infrastruktur-/Leseproblemen (Netzwerk, unerwartete Antwort) - auf BEIDEN
// Ebenen: lieber im seltenen Stoerfall einen KI-Aufruf durchlassen, als einen zahlenden
// Fahrlehrer faelschlich auszusperren. Betriebsvoraussetzung fuer Ebene 1 (falls reaktiviert):
// alle echten Fahrlehrer muessen im Admin-Panel aktiviert sein.

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdnVmdGxmbmtudWN4dW9ydGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDQ2NDQsImV4cCI6MjA5Njg4MDY0NH0.5ZoBdQLnJw23dMZ4IKmAauycVcPoVPIZdmNamZ8MEv8";

// Gemeinsames Tageskontingent ueber alle KI-Functions zusammen, pro Konto. Grosszuegig bemessen -
// ein aktiver Fahrlehrer loest selbst an einem vollen Arbeitstag kaum mehr als eine niedrige
// zweistellige Zahl an KI-Aufrufen aus. Ziel ist nicht, echte Nutzung zu bremsen, sondern eine
// unbegrenzte Kostenspirale zu verhindern. Bei Bedarf einfach hier anpassen.
const KI_DAILY_LIMIT = 150;

// Prueft und erhoeht atomar das gemeinsame Tageskontingent des Kontos (ueber dessen eigenes
// Token, RPC laeuft mit auth.uid() des Aufrufers). true = noch Budget frei (und schon
// mitgezaehlt), false = Limit fuer heute erreicht. Fail-open bei jedem Infrastrukturproblem.
async function dailyLimitOk(token) {
  if (!token) return true;
  try {
    const resp = await fetch(SUPABASE_URL + "/rest/v1/rpc/ki_rate_limit", {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ max_per_day: KI_DAILY_LIMIT }),
    });
    if (!resp.ok) return true; // fail-open
    const out = await resp.json().catch(() => null);
    return out !== false; // alles ausser einem expliziten "false" laesst durch
  } catch (e) {
    return true; // fail-open
  }
}

// Gibt { ok: true } zurueck, wenn der Aufruf erlaubt ist, sonst { ok: false, statusCode, error }.
async function subscriptionGate(uid, token) {
  // Ebene 2 zuerst (siehe Kommentar oben) - unabhaengig vom Abo-Status.
  const unterTageslimit = await dailyLimitOk(token);
  if (!unterTageslimit) {
    return {
      ok: false,
      statusCode: 429,
      error: "Tageslimit für KI-Funktionen erreicht. Ab morgen wieder verfügbar.",
    };
  }

  // EBENE 1 (ABO-PRUEFUNG) TEMPORAER DEAKTIVIERT (Fabian, 25.8.2026): "Ich moechte vorerst alle
  // freischalten" - das Abo-Gate soll noch nicht scharf sein, waehrend die App/das Abo-Modell
  // noch getestet wird. Zum Wiederaktivieren einfach diese Zeile entfernen, der Rest der
  // Funktion ist unveraendert.
  return { ok: true };
  // Ohne uid/token ist die Auth-Pruefung Sache der Function selbst - hier nicht zusaetzlich blocken.
  if (!uid || !token) return { ok: true };
  try {
    const resp = await fetch(
      SUPABASE_URL + "/rest/v1/profiles?id=eq." + encodeURIComponent(uid) + "&select=subscription_active,subscription_lifetime",
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token } }
    );
    if (resp.ok) {
      const rows = await resp.json().catch(() => null);
      const prof = Array.isArray(rows) ? rows[0] : null;
      // Lifetime schliesst alles ein - siehe Abonnement-Bildschirm in der App.
      if (prof && prof.subscription_lifetime === true) return { ok: true };
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
