const CACHE = "mouveo-v8";
const CORE = [
  "/", "/manifest.webmanifest", "/favicon.svg",
  "/voice/ariane/ready.mp3", "/voice/ariane/position.mp3", "/voice/ariane/calibrated.mp3",
  "/voice/ariane/three.mp3", "/voice/ariane/two.mp3", "/voice/ariane/one.mp3",
  "/voice/ariane/start.mp3", "/voice/ariane/good.mp3", "/voice/ariane/mission_complete.mp3",
  "/voice/ariane/next_game.mp3", "/voice/ariane/reposition.mp3", "/voice/ariane/paused.mp3",
  "/voice/ariane/resume.mp3",
];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))));
});
