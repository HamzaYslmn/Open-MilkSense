import { useEffect, useMemo, useRef, useState } from "react";
import { BUILDINGS, AREA_POS, ALERT, topAlert } from "../lib/ui.js";
import { inside, setFence, BASE_LAT, BASE_LNG, M_LAT, M_LNG } from "../sim/geofence.js";

const MW = 1000, MH = 680;

// Where to draw a cow: a cow inside the fence is shown at its current zone (gently orbiting,
// gliding when it changes zone); a stray outside the fence keeps its real GPS spot.
function cowLatLng(c, simTime) {
  if (!inside(c.lat, c.lng)) return [c.lat, c.lng];
  const ap = AREA_POS[c.area] || [0, 0], ph = c.id * 1.7;
  const n = ap[0] + Math.sin(simTime / 420 + ph) * 13 + ((c.id % 3) - 1) * 9;
  const e = ap[1] + Math.cos(simTime / 420 + ph) * 13 + (((c.id * 5) % 3) - 1) * 9;
  return [BASE_LAT + n / M_LAT, BASE_LNG + e / M_LNG];
}

// Static backdrop (field, trees, buildings) + the projection. Bounds are framed from the
// fence ONCE (memoised on base, not fence) so dragging a corner never re-frames the map.
function buildStatic(fence, base) {
  let n = -1e9, s = 1e9, e = -1e9, w = 1e9;
  fence.forEach(([la, ln]) => { n = Math.max(n, la); s = Math.min(s, la); e = Math.max(e, ln); w = Math.min(w, ln); });
  const pa = (n - s) * 0.6, po = (e - w) * 0.6, b = { n: n + pa, s: s - pa, e: e + po, w: w - po };
  const project = (lat, lng) => [((lng - b.w) / (b.e - b.w)) * MW, ((b.n - lat) / (b.n - b.s)) * MH];
  const unproject = (x, y) => [b.n - (y / MH) * (b.n - b.s), b.w + (x / MW) * (b.e - b.w)];
  let seed = 20260101; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let trees = ""; for (let i = 0; i < 80; i++) trees += `<text x="${(rnd() * MW) | 0}" y="${(rnd() * MH) | 0}" font-size="${13 + rnd() * 11 | 0}" opacity="0.6">🌲</text>`;
  const [blat, blng] = base, latM = 111111, lngM = 111111 * Math.cos((blat * Math.PI) / 180), b2ll = (nm, em) => [blat + nm / latM, blng + em / lngM];
  let bld = "";
  for (const bldg of BUILDINGS) {
    const [x1, y1] = project(...b2ll(bldg.n + bldg.h / 2, bldg.e - bldg.w / 2)), [x2, y2] = project(...b2ll(bldg.n - bldg.h / 2, bldg.e + bldg.w / 2));
    const x = Math.min(x1, x2), y = Math.min(y1, y2), w2 = Math.abs(x2 - x1), h2 = Math.abs(y2 - y1);
    bld += `<g><rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w2.toFixed(0)}" height="${h2.toFixed(0)}" rx="4" fill="#3a3022" stroke="#6e5a3e" stroke-width="1.5"/>`
      + `<text x="${(x + w2 / 2).toFixed(0)}" y="${(y + h2 / 2 + 4).toFixed(0)}" font-size="11" fill="#d8c39c" font-weight="600" text-anchor="middle">${bldg.label}</text></g>`;
  }
  return { project, unproject, html: `<rect width="${MW}" height="${MH}" fill="#1a2a20"/>${trees}${bld}` };
}

export default function Map({ cows, fence, base, selectedId, onSelect, simTime }) {
  const [vb, setVb] = useState({ x: 0, y: 0, w: MW, h: MH });
  const [pts, setPts] = useState(fence);            // editable fence corners (lat/lng), owned here
  const drag = useRef(null), vdrag = useRef(null), moved = useRef(false), svgRef = useRef(null);
  // ponytail: bounds framed from the initial fence only — memo on `base`, not `fence`, so editing corners never re-frames
  const { project, unproject, html } = useMemo(() => buildStatic(fence, base), [base]);  // eslint-disable-line react-hooks/exhaustive-deps
  const reset = () => setVb({ x: 0, y: 0, w: MW, h: MH });

  // client px -> SVG user units (respects viewBox + preserveAspectRatio letterboxing)
  const toUser = (ev) => {
    const svg = svgRef.current, p = svg.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    const u = p.matrixTransform(svg.getScreenCTM().inverse());
    return [u.x, u.y];
  };

  useEffect(() => {
    const svg = svgRef.current;
    const onWheel = (ev) => {
      ev.preventDefault();
      const r = svg.getBoundingClientRect();
      const px = (ev.clientX - r.left) / r.width, py = (ev.clientY - r.top) / r.height;
      setVb((v) => {
        const cx = v.x + px * v.w, cy = v.y + py * v.h;
        const nw = Math.max(140, Math.min(MW * 1.3, v.w * (ev.deltaY < 0 ? 0.85 : 1.18))), nh = nw * (MH / MW);
        return { x: cx - px * nw, y: cy - py * nh, w: nw, h: nh };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const startVertex = (ev, i) => { ev.stopPropagation(); vdrag.current = i; };  // grab a corner; don't start a pan
  const onDown = (ev) => { drag.current = { x: ev.clientX, y: ev.clientY }; moved.current = false; };
  const onMove = (ev) => {
    if (vdrag.current != null) {                    // dragging a fence corner
      const [ux, uy] = toUser(ev), next = pts.slice();
      next[vdrag.current] = unproject(ux, uy);
      setPts(next); setFence(next);                 // live: inside()/strays react immediately
      return;
    }
    if (!drag.current) return;
    const r = svgRef.current.getBoundingClientRect(), dx = ev.clientX - drag.current.x, dy = ev.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true;
    setVb((v) => ({ ...v, x: v.x - (dx * v.w) / r.width, y: v.y - (dy * v.h) / r.height }));
    drag.current = { x: ev.clientX, y: ev.clientY };
  };
  const onUp = () => {
    if (vdrag.current != null) { vdrag.current = null; return; }
    if (drag.current) { drag.current = null; if (moved.current) setTimeout(() => (moved.current = false), 30); }
  };
  const click = (id) => { if (!moved.current) onSelect(id); };

  const poly = pts.map((p) => project(p[0], p[1]).map((v) => v.toFixed(0)).join(",")).join(" ");

  return (
    <section className="relative card p-2 flex flex-col gap-2 min-h-0 overflow-hidden">
      <button className="absolute top-3.5 right-3.5 chip z-[2] hover:border-accent hover:text-ink" onClick={reset}>⤢ görünümü sıfırla</button>
      <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
        className="w-full flex-1 min-h-0 rounded-lg block cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onDoubleClick={reset}>
        <g dangerouslySetInnerHTML={{ __html: html }} />

        {/* editable virtual fence — drag the corner handles to reshape it */}
        <polygon points={poly} fill="rgba(52,211,153,0.12)" stroke="var(--color-accent)" strokeWidth="3" strokeDasharray="11 8" />
        {pts.map((p, i) => {
          const [x, y] = project(p[0], p[1]);
          return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="10" fill="var(--color-accent)" stroke="#0e1b14" strokeWidth="2.5"
            className="cursor-move" onPointerDown={(ev) => startVertex(ev, i)} />;
        })}

        {cows.filter((c) => c.lat != null).map((c) => {
          const [lat, lng] = cowLatLng(c, simTime);
          const [x, y] = project(lat, lng).map((v) => +v.toFixed(1));
          const out = (c.alerts || []).some((a) => a.type === "fence");
          const a = topAlert(c);
          return (
            <g key={c.id} className="cow-marker cursor-pointer" style={{ transform: `translate(${x}px,${y}px)` }} onClick={() => click(c.id)}>
              {selectedId === c.id && <circle cx="0" cy="-6" r="20" fill="none" stroke="var(--color-accent)" strokeWidth="2.5" />}
              {c.buzzer
                ? <circle className="ring-pulse" cx="0" cy="-6" r="15" fill="none" stroke={out ? "var(--color-health)" : "var(--color-fence)"} strokeWidth="2.5" />
                : a && <circle cx="0" cy="-6" r="14" fill="none" stroke={ALERT[a.type].color} strokeWidth="1.5" opacity="0.65" />}
              <text x="0" y="0" fontSize="21" textAnchor="middle">🐄</text>
              <text x="0" y="14" fontSize="9.5" textAnchor="middle" fontWeight="700" fill={out ? "var(--color-health)" : "#e3f6ec"}
                stroke="#0e1b14" strokeWidth="0.8" paintOrder="stroke">{c.id}</text>
              {c.buzzer && <text x="13" y="-11" fontSize="14">🔔</text>}
            </g>
          );
        })}
      </svg>
      <div className="flex gap-2 flex-wrap px-1">
        <span className="chip">🐄 çit içinde</span>
        <span className="chip text-health" style={{ borderColor: "var(--color-health)" }}>🐄 çit dışında → 🔔</span>
        <span className="chip">▭ binalar</span><span className="chip">🌲 orman</span>
        <span className="chip">– – sanal çit · ● köşeleri sürükle</span>
        <span className="chip">🔍 tekerlek · ✋ sürükle</span>
      </div>
    </section>
  );
}
