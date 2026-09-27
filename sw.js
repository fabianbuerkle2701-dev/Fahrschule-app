// Offline-Start der App im Browser (v2.39.0).
//
// Nur ein Rückfall für den Fall ohne Netz, kein Versions-Cache:
// - Die Seite selbst (index.html) kommt IMMER zuerst aus dem Netz. Eine neue Version ist damit
//   sofort da wie bisher; die gespeicherte Kopie wird nur ausgeliefert, wenn das Netz fehlt.
// - Bibliotheken (React, supabase-js, per SRI festgenagelte CDN-Adressen), Schriften und eigene
//   Bilder: gespeicherte Kopie sofort, im Hintergrund frisch nachladen.
// - Alles andere (Supabase, Netlify-Functions, POST) läuft unberührt durch.
//
// Notbremse: Sollte dieser Service Worker je Probleme machen, diese Datei durch
//   self.addEventListener("install", () => self.skipWaiting());
//   self.addEventListener("activate", e => e.waitUntil(self.registration.unregister()));
// ersetzen und deployen - dann meldet er sich bei jedem Nutzer beim nächsten Besuch selbst ab.

const CACHE = "allindrive-offline-v1";
const SEITE = "/index.html";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function istStatisch(url) {
  if (url.origin === self.location.origin)
    return /^\/(assets|theorie-bilder)\//.test(url.pathname);
  return /^(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  if (req.mode === "navigate" && url.origin === self.location.origin) {
    const istApp = url.pathname === "/" || url.pathname === SEITE;
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (istApp && res.ok) {
            const kopie = res.clone();
            caches.open(CACHE).then((c) => c.put(SEITE, kopie)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(SEITE).then((hit) => hit || Response.error()))
    );
    return;
  }

  if (!istStatisch(url)) return;
  e.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(req).then((hit) => {
        const frisch = fetch(req)
          .then((res) => {
            if (res.ok) c.put(req, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => hit || Response.error());
        if (hit) {
          e.waitUntil(frisch.catch(() => {}));
          return hit;
        }
        return frisch;
      })
    )
  );
});
