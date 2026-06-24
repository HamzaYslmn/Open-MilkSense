// Tiny SVG charts. The trend uses preserveAspectRatio="none" to fill its box, so strokes get
// vector-effect="non-scaling-stroke" to stay a crisp, thin, uniform width (not stretched).
export function Spark({ series, color = "var(--color-accent)", className = "w-full h-12 mt-1" }) {
  if (!series || series.length < 2) return null;
  const vs = series.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), n = vs.length;
  const W = 100, H = 40, pad = 3;
  const X = (i) => ((i / (n - 1)) * W).toFixed(2);
  const Y = (v) => (hi === lo ? H / 2 : pad + (H - 2 * pad) * (1 - (v - lo) / (hi - lo))).toFixed(2);
  const line = vs.map((v, i) => `${X(i)},${Y(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className}>
      <polygon points={`0,${H} ${line} ${W},${H}`} fill={color} opacity="0.1" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.4"
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// daily bar chart over the last 14 points. `time` = datetime tooltip + raw value (milk);
// default = date-only tooltip + rounded value (steps).
export function Bars({ data, unit = "", time = false }) {
  const last = data.slice(-14);
  if (!last.length) return null;
  const max = Math.max(...last.map((d) => d.v), 1), bw = 100 / last.length;
  return (
    <svg viewBox="0 0 100 52" preserveAspectRatio="none" className="w-full h-16">
      {last.map((d, i) => {
        const h = (d.v / max) * 46, when = new Date(d.ts * 1000);
        return (
          <rect key={i} x={(i * bw + bw * 0.18).toFixed(2)} y={(50 - h).toFixed(1)} width={(bw * 0.64).toFixed(2)} height={h.toFixed(1)}
            fill="var(--color-accent)" opacity={i === last.length - 1 ? 1 : 0.5}>
            <title>{time ? when.toLocaleString("tr-TR") : when.toLocaleDateString("tr-TR")} — {time ? d.v : Math.round(d.v)}{unit ? " " + unit : ""}</title>
          </rect>
        );
      })}
      <line x1="0" y1="50" x2="100" y2="50" stroke="var(--color-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
