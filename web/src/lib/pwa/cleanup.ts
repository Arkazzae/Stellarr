/**
 * Service workers and CacheStorage outlive deployments. Earlier web releases
 * were installable as a PWA, so once the regular client loads it removes both
 * and an old installation cannot keep controlling the page.
 */
export async function removeLegacyPwaArtifacts(): Promise<void> {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if (typeof window !== "undefined" && "caches" in window) {
    const names = await window.caches.keys();
    await Promise.all(names.map((name) => window.caches.delete(name)));
  }
}
