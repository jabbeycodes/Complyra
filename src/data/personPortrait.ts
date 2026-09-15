/**
 * Deterministic illustrated portraits for people who do not yet have an
 * uploaded photo. Used by the program-site hero so Maple House is not
 * initials-only. A stored photoUrl always wins.
 */
function hashName(name: string): number {
  return [...name].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) | 0, 7);
}

const SKIN = ["#f3d0b5", "#e0b089", "#c68642", "#8d5524", "#f1c27d", "#d4a574"];
const HAIR = ["#2c1810", "#3d2314", "#1a1a1a", "#5c4033", "#4a3728", "#2f1b12"];
const SHIRT = ["#3f5c3b", "#6f815c", "#8b5e3c", "#2f4630", "#5a6b4a", "#4d6b42"];

export function portraitDataUrl(name: string): string {
  const h = Math.abs(hashName(name));
  const skin = SKIN[h % SKIN.length];
  const hair = HAIR[(h >> 3) % HAIR.length];
  const shirt = SHIRT[(h >> 5) % SHIRT.length];
  const hairH = 28 + (h % 10);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#efe4d4"/>
        <stop offset="1" stop-color="#d7c4a6"/>
      </linearGradient>
    </defs>
    <rect width="80" height="80" fill="url(#g)"/>
    <ellipse cx="40" cy="86" rx="32" ry="22" fill="${shirt}"/>
    <ellipse cx="40" cy="44" rx="20" ry="23" fill="${skin}"/>
    <path d="M18 40 C20 ${hairH} 28 16 40 16 C52 16 60 ${hairH} 62 40 C54 28 26 28 18 40Z" fill="${hair}"/>
    <circle cx="33" cy="44" r="2.2" fill="#2a2118"/>
    <circle cx="47" cy="44" r="2.2" fill="#2a2118"/>
    <path d="M34 54 Q40 58 46 54" fill="none" stroke="#8a6a4e" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function portraitSrc(name: string, uploaded?: string | null): string | undefined {
  if (uploaded) return uploaded;
  if (!name.trim()) return undefined;
  return portraitDataUrl(name);
}
