import { execSync } from 'node:child_process';

// Utolsó commit adatai a kezdőképernyő verziójeléhez.
// Fejlesztés és build közben is fut; a smoke (npx vite) is ezt kapja el.
function buildInfo() {
  try {
    const short = execSync('git log -1 --format=%h', { encoding: 'utf8' }).trim();
    const stamp = execSync('git log -1 --format=%cI', { encoding: 'utf8' }).trim();
    return { short, stamp };
  } catch {
    return { short: '', stamp: '' }; // nincs .git (pl. tarball) — a JS jelzi, hogy dev build
  }
}

export default {
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo()),
  },
};
