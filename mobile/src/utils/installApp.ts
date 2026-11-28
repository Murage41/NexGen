// Installing NexGen as a phone app (Android Chrome offers it through
// "beforeinstallprompt"; iPhone uses Safari's Share > Add to Home Screen).
// Imported once from main.tsx so the browser's offer is caught before any page needs it.
import { useEffect, useState } from 'react';

type InstallOffer = Event & { prompt: () => Promise<void> };

let offer: InstallOffer | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

window.addEventListener('beforeinstallprompt', (event) => {
  offer = event as InstallOffer;
  changed();
});

window.addEventListener('appinstalled', () => {
  offer = null;
  changed();
});

export function useCanInstallApp(): boolean {
  const [canInstall, setCanInstall] = useState(offer !== null);
  useEffect(() => {
    const update = () => setCanInstall(offer !== null);
    listeners.add(update);
    update();
    return () => { listeners.delete(update); };
  }, []);
  return canInstall;
}

export async function installApp() {
  const current = offer;
  if (!current) return;
  offer = null;
  changed();
  await current.prompt();
}

export function registerPhoneApp() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => { /* The app still works as a web page. */ });
  });
}
