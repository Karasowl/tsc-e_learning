/*
 * Service worker mínimo del LMS TSC Capacita.
 * Objetivo: cumplir el criterio de instalabilidad de la PWA sin romper nada.
 *
 * Reglas de seguridad (no destructivo):
 *  - Solo intercepta GET del MISMO origen. Cualquier otro origen (el API vive en
 *    su propio host) pasa directo al navegador: NO se cachea ni se toca la auth.
 *  - Navegación: network-first con fallback a una cáscara offline simple.
 *  - Estáticos de build/marca (/_next/static, /icons): network-first con copia
 *    en caché para poder abrir la app sin señal. Estos assets llevan hash, así
 *    que nunca sirven una versión vieja de una ruta viva.
 *  - Todo lo demás no se intercepta.
 */
const CACHE = "tsc-capacita-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  // Nunca tocar otros orígenes (API, fuentes, etc.): el navegador los maneja.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Navegación: intenta la red; si falla, cáscara offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((cached) => cached || Response.error())
      )
    );
    return;
  }

  // Estáticos con hash de build y marca: network-first + copia en caché.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || Response.error()))
    );
    return;
  }

  // Resto: sin interceptar (red directa, sin caché).
});
