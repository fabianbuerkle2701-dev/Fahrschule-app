// Netlify Function: liefert einen zeitlich begrenzten (signierten) Link zu einem Video aus der
// öffentlichen Video-Bibliothek der Buchungsseite.
//
// Der videos-Storage-Bucket ist privat (Audit-Fund S2, 23.9.2026 - vorher public:true, umging
// damit seine eigenen RLS-Policies über den unauthentifizierten /storage/v1/object/public/-
// Endpunkt komplett). Ein anonymer Buchungsseiten-Besucher kann sich daher keine signierte URL
// mehr selbst erzeugen (createSignedUrl prüft dieselbe RLS, die für den videos-Bucket nur
// eingeloggte Fahrlehrer zulässt - Interessenten/Fahrschüler ohne Login haben keinen auth.uid()).
//
// Diese Funktion validiert stattdessen serverseitig über denselben Buchungscode-Mechanismus wie
// public_videos() (dieselbe RPC, dieselbe Autorisierung: Video muss zur Fahrschule des Codes
// gehören), und erzeugt die signierte URL erst danach mit dem Service-Role-Key, der die RLS
// bewusst umgeht - wie admin-set-subscription.js/mark-own-payment-done.js.
//
// Bewusst ohne Bearer-Token wie booking-chat.js/morning-briefing.js - Interessenten und
// Fahrschüler ohne eigenen Login sollen die öffentliche Videobibliothek sehen können.

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdnVmdGxmbmtudWN4dW9ydGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDQ2NDQsImV4cCI6MjA5Njg4MDY0NH0.5ZoBdQLnJw23dMZ4IKmAauycVcPoVPIZdmNamZ8MEv8";

// 1 Stunde - reicht für eine Ansicht des Videos, dieselbe Dauer wie studentFileSignedUrl() im Client.
const GUELTIG_SEKUNDEN = 3600;

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Nur POST erlaubt" }) };

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error("public-video-url: SUPABASE_SERVICE_ROLE_KEY fehlt");
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server nicht korrekt konfiguriert." }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Ungültige Anfrage" }) }; }

  const code = (body.code || "").toString().trim();
  const videoId = (body.videoId || "").toString().trim();
  if (!code) return { statusCode: 400, headers, body: JSON.stringify({ error: "Kein Buchungscode übergeben" }) };
  if (!videoId) return { statusCode: 400, headers, body: JSON.stringify({ error: "Keine Video-ID übergeben" }) };

  try {
    // Dieselbe Autorisierungsprüfung wie public_videos(): Video muss zur Fahrschule des Codes
    // gehören (eigene Videos des Fahrlehrers ODER schulweit geteilte). Über die anonyme Rolle
    // aufgerufen wie jede andere public_*-RPC - für die Prüfung selbst sind keine erhöhten
    // Rechte nötig, nur für das anschließende Signieren.
    const listResp = await fetch(SUPABASE_URL + "/rest/v1/rpc/public_videos", {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!listResp.ok) return { statusCode: 502, headers, body: JSON.stringify({ error: "Video konnte nicht geprüft werden." }) };
    const list = await listResp.json().catch(() => []);
    const video = Array.isArray(list) ? list.find((v) => v && v.id === videoId) : null;
    if (!video || !video.storage_path)
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Video nicht gefunden." }) };

    // Nur Dateien aus dem eigenen Ordner des Video-Besitzers signieren (Audit 2026-09, L-H1):
    // storage_path war beim Anlegen frei wählbar, eine videos-Zeile konnte also auf die Datei
    // eines FREMDEN Fahrlehrers zeigen - mit dem Service-Key hier wäre die sonst unerreichbar.
    // Die Tabellen-Policy verhindert solche Zeilen inzwischen; das hier deckt Altbestände ab.
    const ownerResp = await fetch(
      SUPABASE_URL + "/rest/v1/videos?id=eq." + encodeURIComponent(videoId) + "&select=owner,storage_path",
      { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey } }
    );
    if (!ownerResp.ok) return { statusCode: 502, headers, body: JSON.stringify({ error: "Video konnte nicht geprüft werden." }) };
    const ownerRows = await ownerResp.json().catch(() => []);
    const row = Array.isArray(ownerRows) ? ownerRows[0] : null;
    // Punkt- und Leersegmente zusätzlich ablehnen: fetch() normalisiert "<besitzer>/../<fremd>/x"
    // vor dem Senden zu "<fremd>/x" - der startsWith-Vergleich allein würde das durchlassen.
    const segmente = video.storage_path.split("/");
    const pfadSauber = !segmente.some((s) => s === "" || s === "." || s === "..");
    if (!row || !row.owner || row.storage_path !== video.storage_path || !pfadSauber || !video.storage_path.startsWith(row.owner + "/")) {
      console.error("public-video-url: Pfad liegt nicht im Ordner des Besitzers", videoId);
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Video nicht gefunden." }) };
    }

    const signResp = await fetch(
      SUPABASE_URL + "/storage/v1/object/sign/videos/" + video.storage_path.split("/").map(encodeURIComponent).join("/"),
      {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: GUELTIG_SEKUNDEN }),
      }
    );
    if (!signResp.ok) {
      const errData = await signResp.json().catch(() => ({}));
      console.error("public-video-url: Signieren fehlgeschlagen", errData);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Video-Link konnte nicht erstellt werden." }) };
    }
    const signed = await signResp.json();
    if (!signed || !signed.signedURL)
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Video-Link konnte nicht erstellt werden." }) };
    // signed.signedURL kommt relativ ("/object/sign/videos/...?token=...") - Basis davorsetzen.
    const url = SUPABASE_URL + "/storage/v1" + signed.signedURL;
    return { statusCode: 200, headers, body: JSON.stringify({ url }) };
  } catch (e) {
    console.error("public-video-url:", e);
    // Anonym erreichbar - e.message (Host-/DNS-Angaben) bleibt im Server-Log.
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Video-Link konnte nicht erstellt werden." }) };
  }
};
