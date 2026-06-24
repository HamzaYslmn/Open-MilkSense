// Herd analytics — Heat, Critical Health, Productivity, Abnormal Feeding. Ported from the
// Python module; pure functions over a herd object that exposes the per-cow histories.
export const WINDOW = 86400;
export const T = {
  min_coverage: 0.3, heat_ratio: 1.6, heat_rest_max: 0.75,
  temp_high: 39.5, temp_crit: 40.0, temp_smooth: 5,
  prod_drop_frac: 0.18, prod_min_milkings: 4, low_ratio: 0.4, cough_24h: 250,
};

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
function slope(ys) {
  const n = ys.length; if (n < 2) return 0;
  const sx = (n * (n - 1)) / 2, sxx = ys.reduce((s, _, i) => s + i * i, 0);
  const sy = ys.reduce((a, b) => a + b, 0), sxy = ys.reduce((s, y, i) => s + i * y, 0);
  const d = n * sxx - sx * sx;
  return d ? (n * sxy - sx * sy) / d : 0;
}
export function smoothTemp(herd, cid) {
  const t = herd.reports(cid).slice(-T.temp_smooth).map((r) => r.temp).filter((v) => v != null);
  if (!t.length) return null;
  t.sort((a, b) => a - b);
  return t[t.length >> 1];
}
function heatOnset(herd, cid, day0, herdHourly) {
  const buckets = {};
  for (const r of herd.reports(cid, day0)) { const h = Math.floor(r.ts / 3600); buckets[h] = (buckets[h] || 0) + (r.steps || 0); }
  for (const h of Object.keys(buckets).map(Number).sort((a, b) => a - b)) if (buckets[h] > 1.5 * herdHourly) return h * 3600;
  return day0;
}
function insemination(onset) {
  const hour = Math.floor((onset % 86400) / 3600);
  return { ts: onset + 12 * 3600, hint: hour < 12 ? "bu akşam tohumlayın" : "yarın sabah tohumlayın" };
}

export function evaluateAll(herd) {
  const ids = herd.cowIds();
  const metrics = {};
  for (const cid of ids) {
    const t = herd.nowTs(cid), since = t - WINDOW, b = herd.behavior(cid);
    metrics[cid] = { ...b, steps: b.steps_24h, temp: smoothTemp(herd, cid) ?? 38.5, since };
  }
  const med = {};
  for (const f of ["steps", "feed_min", "rest_min"]) med[f] = median(ids.map((c) => metrics[c][f]));
  const out = {}; ids.forEach((c) => (out[c] = []));
  for (const cid of ids) {
    const m = metrics[cid], ready = m.coverage >= T.min_coverage, alerts = out[cid];
    const low = (f) => med[f] > 0 && m[f] < T.low_ratio * med[f];

    const ratio = med.steps ? m.steps / med.steps : 0;
    const restless = med.rest_min <= 0 || m.rest_min < T.heat_rest_max * med.rest_min;
    if (ready && ratio >= T.heat_ratio && restless) {
      const onset = heatOnset(herd, cid, m.since, med.steps / 24), ins = insemination(onset);
      alerts.push({ id: cid, type: "heat", severity: "info", since: onset,
        message: `Kızgınlık — hareket normalin ${ratio.toFixed(1)} katı. En uygun zaman: ${ins.hint}.`,
        data: { hareket_kat: +ratio.toFixed(1), başlangıç_ts: onset, tohumlama_ts: ins.ts, öneri: ins.hint } });
    }

    const fever = m.temp >= T.temp_high, feverCrit = m.temp >= T.temp_crit, behavioral = [];
    if (ready) for (const [f, lbl] of [["rest_min", "geviş/dinlenme"], ["feed_min", "yemleme"], ["steps", "hareket"]]) if (low(f)) behavioral.push("düşük " + lbl);
    if (ready && m.acev_24h >= T.cough_24h) behavioral.push(`öksürük/solunum (${m.acev_24h} olay)`);
    if (fever || behavioral.length >= 2) {
      const sigs = (fever ? [`ateş ${m.temp.toFixed(1)}°C`] : []).concat(behavioral);
      const sev = feverCrit || (fever && behavioral.length) || behavioral.length >= 3 ? "critical" : "warning";
      alerts.push({ id: cid, type: "health", severity: sev, since: herd.nowTs(cid), message: "Sağlık riski: " + sigs.join(", "), data: { belirtiler: sigs, ateş: +m.temp.toFixed(1) } });
    }

    const milks = herd.milkEvents(cid).map((x) => x.liters);
    if (milks.length >= T.prod_min_milkings) {
      const avg = mean(milks), rel = avg > 0 ? (-slope(milks) * milks.length) / avg : 0;
      if (rel >= T.prod_drop_frac)
        alerts.push({ id: cid, type: "productivity", severity: "warning", since: herd.nowTs(cid),
          message: `Süt verimi son sağımlarda %${Math.round(rel * 100)} düşüyor.`, data: { düşüş_yüzde: Math.round(rel * 100), son_L: +mean(milks.slice(milks.length >> 1)).toFixed(1) } });
    }

    if (ready && low("feed_min")) {
      const r = m.feed_min / med.feed_min;
      alerts.push({ id: cid, type: "feeding", severity: "warning", since: herd.nowTs(cid),
        message: `Yemleme süresi sürü ortalamasının %${Math.round((1 - r) * 100)} altında — yetersiz besleniyor.`, data: { yemleme_dk: m.feed_min, oran: +r.toFixed(2) } });
    }
  }
  return out;
}
