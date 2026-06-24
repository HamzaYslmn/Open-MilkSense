// Shared Turkish labels, alert metadata, and format helpers for the UI.
export const AREA_LABEL = {
  bedding: "Yatak / Dinlenme", barn: "Kapalı Ahır", feeding: "Yemleme", watering: "Su / İçme",
  paddock: "Gezinti / Padok", waiting: "Bekleme", parlor_path: "Sağımhane Yolu", parlor: "Sağımhane",
};
export const ALERT = {
  heat: { label: "Kızgınlık", color: "var(--color-heat)", icon: "🔥" },
  health: { label: "Sağlık", color: "var(--color-health)", icon: "🩺" },
  productivity: { label: "Verim", color: "var(--color-prod)", icon: "📉" },
  feeding: { label: "Beslenme", color: "var(--color-feeding)", icon: "🍽️" },
  fence: { label: "Çit", color: "var(--color-fence)", icon: "🚧" },
};
export const ANA_LABEL = {
  heat: "Kızgınlık tespiti", health: "Kritik sağlık", productivity: "Verimlilik",
  feeding: "Anormal beslenme", fence: "Sanal çit",
};
export const ALERT_TYPES = Object.keys(ALERT);  // canonical order: heat → health → productivity → feeding → fence

// current activity (from the emulator's `activity` field) -> Turkish label + glyph
export const BEHAVIOR_TR = {
  resting: { label: "Dinleniyor", icon: "😴" }, eating: { label: "Yemleniyor", icon: "🌾" },
  drinking: { label: "Su içiyor", icon: "💧" }, grazing: { label: "Otluyor", icon: "🌿" },
  standing: { label: "Ayakta", icon: "🐮" }, waiting: { label: "Bekliyor", icon: "⏳" },
  walking: { label: "Yürüyor", icon: "🚶" }, milking: { label: "Sağılıyor", icon: "🥛" },
  restless: { label: "Huzursuz", icon: "🔥" }, unknown: { label: "Bilinmiyor", icon: "🐄" },
};
export const behaviorOf = (c) => BEHAVIOR_TR[c.activity] || BEHAVIOR_TR.unknown;

// where each NFC zone sits on the map (metre offsets from the barn) — cows roam between these
export const AREA_POS = {
  barn: [0, 0], bedding: [65, -75], feeding: [65, 65], watering: [-5, -100],
  waiting: [-70, 60], parlor_path: [-100, -5], parlor: [-125, -58], paddock: [125, 150],
};
export const SEV = { critical: 0, warning: 1, info: 2 };
export const SEV_TR = { critical: "kritik", warning: "uyarı", info: "bilgi" };

// farm buildings drawn on the map — metre offsets (north, east) from the barn + size in metres
export const BUILDINGS = [
  { label: "Kapalı Ahır", n: 0, e: 0, w: 75, h: 55 },
  { label: "Yatak", n: 65, e: -75, w: 80, h: 45 },
  { label: "Yemleme", n: 65, e: 65, w: 70, h: 42 },
  { label: "Su", n: -5, e: -100, w: 34, h: 30 },
  { label: "Bekleme", n: -70, e: 60, w: 55, h: 40 },
  { label: "Sağım Yolu", n: -100, e: -5, w: 28, h: 60 },
  { label: "Sağımhane", n: -125, e: -58, w: 62, h: 46 },
];

// soft tinted pill: faint colour wash + bright colored text + subtle border (use with `border`)
export const tagStyle = (color) => ({ background: color + "22", color, borderColor: color + "59" });

export const fmtTime = (ts) => (ts ? new Date(ts * 1000).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "—");
export const fmtDate = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }) : "—");
export const durShort = (sec) => { const m = Math.max(0, Math.round(sec / 60)); return m >= 60 ? `${(m / 60) | 0}sa ${m % 60}dk` : `${m}dk`; };
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export const topAlert = (c) => (c.alerts && c.alerts.length ? [...c.alerts].sort((a, b) => SEV[a.severity] - SEV[b.severity])[0] : null);
export const fmtEvidence = (data) => !data ? "" : Object.entries(data).map(([k, v]) =>
  k.endsWith("_ts") ? `${k.slice(0, -3).replace(/_/g, " ")} ${fmtTime(v)}`
    : k === "öneri" ? v : Array.isArray(v) ? v.join(", ") : `${k.replace(/_/g, " ")}: ${v}`).join("  ·  ");
