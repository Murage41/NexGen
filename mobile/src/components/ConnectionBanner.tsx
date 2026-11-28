import { useEffect, useState } from 'react';

// Shown while the station can't be reached: the phone is offline, or the link or
// the station PC is down. Hidden again as soon as the station answers.
export default function ConnectionBanner() {
  const [unreachable, setUnreachable] = useState(() => !navigator.onLine);

  useEffect(() => {
    const down = () => setUnreachable(true);
    const up = () => setUnreachable(false);
    window.addEventListener('nexgen:station-unreachable', down);
    window.addEventListener('nexgen:station-reachable', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('nexgen:station-unreachable', down);
      window.removeEventListener('nexgen:station-reachable', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  if (!unreachable) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-50 bg-amber-500 text-white text-sm px-4 py-2 flex items-center justify-between gap-3"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
    >
      <span>Can't reach the station. Check the phone's internet.</span>
      <button type="button" onClick={() => window.location.reload()} className="font-semibold underline shrink-0">
        Try again
      </button>
    </div>
  );
}
