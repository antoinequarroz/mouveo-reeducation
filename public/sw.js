const CACHE = "mouveo-v10";
const CORE = [
  "/", "/manifest.webmanifest", "/favicon.svg",
  "/voice/christophe/ready.mp3", "/voice/christophe/position.mp3", "/voice/christophe/calibrated.mp3",
  "/voice/christophe/three.mp3", "/voice/christophe/two.mp3", "/voice/christophe/one.mp3",
  "/voice/christophe/start.mp3", "/voice/christophe/good.mp3", "/voice/christophe/mission_complete.mp3",
  "/voice/christophe/next_game.mp3", "/voice/christophe/reposition.mp3", "/voice/christophe/paused.mp3",
  "/voice/christophe/resume.mp3", "/voice/christophe/arm_start.mp3", "/voice/christophe/legs_start.mp3",
  "/voice/christophe/balance_start.mp3", "/voice/christophe/squat_start.mp3", "/voice/christophe/trunk.mp3",
  "/voice/christophe/symmetry.mp3", "/voice/christophe/slow_return.mp3", "/voice/christophe/good_control.mp3",
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
