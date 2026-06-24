import { AREA_LABEL, ALERT, ALERT_TYPES, ANA_LABEL, SEV, SEV_TR, behaviorOf, tagStyle, fmtTime, fmtDate, durShort, mean, fmtEvidence } from "../lib/ui.js";
import { Spark, Bars } from "./charts.jsx";

// ---- small building blocks -----------------------------------------------------------
const Card = ({ icon, title, right, children, className = "" }) => (
  <section className={"card p-3.5 fade-in " + className}>
    {title && (
      <div className="flex items-center justify-between mb-3">
        <div className="sec-h"><span className="text-[13px]">{icon}</span>{title}</div>
        {right}
      </div>
    )}
    {children}
  </section>
);
const Stat = ({ label, value, sub, accent }) => (
  <div className="bg-elev border border-line rounded-xl px-3 py-2.5">
    <div className="text-[10px] uppercase tracking-wide text-dim">{label}</div>
    <div className="text-[17px] font-semibold leading-tight mt-1" style={accent ? { color: accent } : undefined}>{value}</div>
    {sub && <div className="text-[10px] text-faint mt-0.5 truncate">{sub}</div>}
  </div>
);
const Hero = ({ label, value, accent }) => (
  <div className="flex-1 text-center">
    <div className="text-[18px] font-bold leading-none" style={accent ? { color: accent } : undefined}>{value}</div>
    <div className="text-[9px] uppercase tracking-wide text-dim mt-1">{label}</div>
  </div>
);
const SubLabel = ({ children }) => <div className="text-[10px] uppercase tracking-wider text-faint mt-3 mb-1.5 first:mt-0">{children}</div>;

function TrendRow({ label, series, unit, color }) {
  if (!series || series.length < 2) return <div className="flex justify-between text-[11px] text-dim py-1.5"><span>{label}</span><span>veri yok</span></div>;
  const vs = series.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs);
  return (
    <div className="py-1">
      <div className="flex justify-between text-[11px]">
        <span className="text-dim">{label}</span>
        <span className="text-faint"><b className="text-ink">{vs[vs.length - 1]}{unit}</b> · ort {mean(vs).toFixed(1)} · {lo}–{hi}</span>
      </div>
      <Spark series={series} color={color} className="w-full h-9 mt-1" />
    </div>
  );
}
function metric(t, d) {
  if (!d) return null;
  if (t === "heat") return { pct: Math.min((d.hareket_kat || 0) / 3, 1), label: `${d.hareket_kat}× normal hareket` };
  if (t === "health") return { pct: Math.min(((d.ateş || 38) - 38) / 3, 1), label: `${d.ateş}°C vücut sıcaklığı` };
  if (t === "productivity") return { pct: Math.min((d.düşüş_yüzde || 0) / 50, 1), label: `%${d.düşüş_yüzde} verim düşüşü` };
  if (t === "feeding") return { pct: Math.min(1 - (d.oran || 0), 1), label: `%${Math.round((1 - (d.oran || 0)) * 100)} daha az yemleme` };
  return null;
}
function milkByDay(milk) {
  const days = {};
  milk.forEach((m) => { const k = new Date(m.ts * 1000).toLocaleDateString("tr-TR"); (days[k] = days[k] || { date: k, total: 0, sessions: [] }); days[k].total += m.v; days[k].sessions.push(m); });
  return Object.values(days).map((d) => ({ date: d.date, total: +d.total.toFixed(1), sessions: [...d.sessions].sort((a, b) => b.ts - a.ts) })).reverse();
}

// ---- panel ---------------------------------------------------------------------------
export default function CowDetail({ detail, buzz, onClose }) {
  if (!detail) return null;
  const c = detail.cow, h = detail.history;
  const out = c.alerts.some((a) => a.type === "fence");
  const beh = behaviorOf(c);
  const rfid = c.epc ? "…" + c.epc.slice(-6) : "yok";  // herd only stores real gate reads, never the empty sentinel

  const dailySteps = detail.dailySteps || [];
  const avgDaily = mean(dailySteps.map((d) => d.steps));
  const todayStart = Math.floor((c.ts || 0) / 86400) * 86400;
  let cum = 0;
  const cumSeries = (h.steps || []).filter((p) => p.ts >= todayStart).map((p) => ({ ts: p.ts, v: (cum += p.v || 0) }));
  const todayTotal = cum;
  const milk = h.milk || [], days = milkByDay(milk), last = milk[milk.length - 1];
  const avg7 = mean(days.slice(0, 7).map((d) => d.total));

  const byType = {}; c.alerts.forEach((a) => (byType[a.type] = a));
  const active = ALERT_TYPES.filter((t) => byType[t]).sort((x, y) => SEV[byType[x].severity] - SEV[byType[y].severity]);
  const okTypes = ALERT_TYPES.filter((t) => !byType[t]);
  const top = active.length ? byType[active[0]] : null;
  const statusColor = top ? ALERT[top.type].color : "var(--color-accent)";
  const statusText = out ? "Çit dışında" : top ? ANA_LABEL[top.type] : "Sağlıklı";
  const path = (detail.path || []).map((p, i, arr) => ({ area: p.area, ts: p.ts, dur: (i < arr.length - 1 ? arr[i + 1].ts : c.ts) - p.ts })).reverse();

  return (
    <>
      <aside className="panel-in fixed top-0 right-0 w-[500px] max-w-[96vw] h-full bg-panel border-l border-line z-20 flex flex-col shadow-2xl">

        {/* sticky header */}
        <header className="px-4 pt-4 pb-3 border-b border-line bg-panel/95 backdrop-blur">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl grid place-items-center text-2xl shrink-0 border"
              style={{ background: statusColor + "1f", borderColor: statusColor + "66" }}>🐄</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold m-0 truncate">{c.name}</h2>
                <span className="text-dim text-sm">#{c.id}</span>
                <span className="text-[10px] font-bold uppercase rounded-full px-2.5 py-0.5 ml-auto border" style={tagStyle(statusColor)}>{statusText}</span>
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="chip" style={{ borderColor: statusColor + "55" }}>{beh.icon} {beh.label}</span>
                <span className="chip">📍 {out ? "⚠ Çit dışında" : AREA_LABEL[c.area] || "—"}</span>
                <span className="chip"><span className="live-dot w-1.5 h-1.5 rounded-full bg-accent" /> {fmtTime(c.ts)}</span>
              </div>
            </div>
            <button className="text-dim text-2xl leading-none hover:text-ink -mt-1" onClick={onClose}>×</button>
          </div>
          <div className="flex gap-2 mt-3 bg-elev border border-line rounded-xl py-2 px-1">
            <Hero label="Nabız" value={(c.hr || 0)} accent="var(--color-heat)" />
            <div className="w-px bg-line" />
            <Hero label="Sıcaklık" value={(c.temp ?? "—") + "°"} accent={c.temp >= 39.5 ? "var(--color-health)" : undefined} />
            <div className="w-px bg-line" />
            <Hero label="Süt bugün" value={(c.milk_today ?? "—") + "L"} accent="var(--color-accent)" />
            <div className="w-px bg-line" />
            <Hero label="Adım bugün" value={Math.round(todayTotal).toLocaleString("tr-TR")} />
          </div>
        </header>

        {/* scrolling body */}
        <div className="flex-1 overflow-auto p-3.5 flex flex-col gap-3">

          {/* analyses first — the actionable part */}
          <Card icon="🧠" title="Analizler" right={<span className="text-[10px] font-semibold" style={{ color: statusColor }}>{active.length ? `${active.length} uyarı` : "tümü normal"}</span>}>
            {active.length === 0 && <div className="flex items-center gap-2 text-sm text-accent bg-accent/10 border border-accent/25 rounded-xl px-3 py-2.5">✓ Bu hayvanda aktif uyarı yok.</div>}
            <div className="flex flex-col gap-2">
              {active.map((t) => {
                const a = byType[t], meta = ALERT[t], m = metric(t, a.data);
                return (
                  <div key={t} className="bg-elev border border-line rounded-xl p-3" style={{ borderLeft: `4px solid ${meta.color}` }}>
                    <div className="flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-lg grid place-items-center text-base border shrink-0" style={{ borderColor: meta.color, background: meta.color + "1a" }}>{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{ANA_LABEL[t]}</div>
                        {m && <div className="text-dim text-[11px]">{m.label}</div>}
                      </div>
                      <span className="text-[9px] font-bold uppercase rounded px-1.5 py-0.5 border" style={tagStyle(meta.color)}>{SEV_TR[a.severity]}</span>
                    </div>
                    <div className="text-xs mt-2 text-ink/90">{a.message}</div>
                    {m && <div className="h-1.5 rounded-full bg-line overflow-hidden mt-2"><div className="h-full rounded-full" style={{ width: `${Math.round(m.pct * 100)}%`, background: meta.color }} /></div>}
                    {a.data && <div className="text-faint text-[10px] mt-1.5 break-words">{fmtEvidence(a.data)}</div>}
                  </div>
                );
              })}
            </div>
            {okTypes.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 mt-2.5">
                {okTypes.map((t) => (
                  <div key={t} className="flex items-center gap-1.5 text-[11px] text-dim bg-elev border border-line rounded-lg px-2 py-1.5">
                    <span>{ALERT[t].icon}</span><span className="flex-1 truncate">{ANA_LABEL[t]}</span><span className="text-accent font-semibold">✓</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* live sensors, grouped by what they tell you */}
          <Card icon="📡" title="Canlı sensörler" right={<span className="text-[10px] text-faint">veri %{((c.coverage ?? 0) * 100) | 0}</span>}>
            <SubLabel>Sağlık & ses</SubLabel>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Nabız" value={(c.hr || 0) + " bpm"} accent="var(--color-heat)" />
              <Stat label="Sıcaklık" value={(c.temp ?? "—") + " °C"} accent={c.temp >= 39.5 ? "var(--color-health)" : undefined} />
              <Stat label="Ses düzeyi" value={(c.sound ?? "—") + " dB"} />
              <Stat label="Akustik olay" value={c.acev ?? "—"} sub="öksürük/böğürme (5dk)" />
            </div>
            <SubLabel>Hareket & konum</SubLabel>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Adım (5 dk)" value={c.steps ?? "—"} />
              <Stat label="Mevcut bölge" value={AREA_LABEL[c.area] || "—"} sub={c.area_since ? durShort(c.ts - c.area_since) + " içinde" : ""} />
              <Stat label="RFID etiketi" value={rfid} sub="geçit okuması" />
              <Stat label="GPS" value={(c.lat?.toFixed?.(4) ?? "—")} sub={c.lng?.toFixed?.(4) ?? ""} />
            </div>
            <SubLabel>Cihaz & radyo</SubLabel>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Batarya" value={(c.batt ?? "—") + " %"} accent={c.batt < 20 ? "var(--color-health)" : undefined} />
              <Stat label="Uydu" value={c.sats ?? "—"} />
              <Stat label="LoRa RSSI" value={(c.rssi ?? "—") + " dBm"} />
              <Stat label="LoRa SNR" value={(c.snr ?? "—") + " dB"} />
            </div>
          </Card>

          {/* milking */}
          <Card icon="🥛" title="Sağım geçmişi">
            {milk.length ? (
              <>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <Stat label="Son 24s" value={(c.milk_today ?? "—") + " L"} accent="var(--color-accent)" />
                  <Stat label="7 gün ort." value={avg7.toFixed(1) + " L"} />
                  <Stat label="Son sağım" value={last ? last.v + " L" : "—"} sub={last ? fmtTime(last.ts) : ""} />
                </div>
                <Bars data={milk} unit="L" time />
                <div className="text-[11px] text-faint mt-1 mb-2">{milk.length} sağım · {fmtDate(milk[0].ts)} → {fmtDate(last.ts)}</div>
                <div className="max-h-48 overflow-auto bg-elev border border-line rounded-xl p-2.5">
                  {days.map((d) => (
                    <div key={d.date} className="mb-2 last:mb-0">
                      <div className="flex justify-between text-[11px] border-b border-line pb-1 mb-1"><span className="font-semibold">{d.date}</span><span className="text-accent font-semibold">{d.total} L</span></div>
                      {d.sessions.map((s) => <div key={s.ts} className="flex justify-between text-xs py-0.5 text-dim"><span>🥛 {fmtTime(s.ts)}</span><span className="text-ink">{s.v} L</span></div>)}
                    </div>
                  ))}
                </div>
              </>
            ) : <div className="text-dim text-xs">Sağım kaydı yok</div>}
          </Card>

          {/* 24h behaviour + live today-steps */}
          <Card icon="📊" title="Davranış — son 24 saat">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Hareket" value={(c.steps_24h ?? "—") + " adım"} />
              <Stat label="Yemleme" value={(c.feed_min ?? "—") + " dk"} />
              <Stat label="Geviş" value={(c.rumin_min ?? "—") + " dk"} />
              <Stat label="Dinlenme" value={(c.rest_min ?? "—") + " dk"} />
            </div>
            {dailySteps.length > 0 && (
              <div className="mt-3 bg-elev border border-line rounded-xl p-3">
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] uppercase tracking-wide text-dim">Adım — bugün <span className="live-dot inline-block w-1.5 h-1.5 rounded-full bg-accent align-middle ml-0.5" /> canlı</span>
                  <b className="text-lg">{Math.round(todayTotal).toLocaleString("tr-TR")} <span className="text-xs text-dim font-normal">adım</span></b>
                </div>
                {cumSeries.length > 1 && <Spark series={cumSeries} color="var(--color-accent)" className="w-full h-9 mt-1" />}
                <div className="flex justify-between text-[10px] text-faint mt-1 mb-1">
                  <span>7 günlük ort.: <b className="text-ink">{Math.round(avgDaily).toLocaleString("tr-TR")}</b> adım</span><span>{dailySteps.length} gün</span>
                </div>
                <Bars data={dailySteps.map((d) => ({ ts: d.day * 86400, v: d.steps }))} unit="adım" />
              </div>
            )}
          </Card>

          {/* trends */}
          <Card icon="📈" title="Eğilimler">
            <TrendRow label="Nabız" series={h.hr} unit=" bpm" color="var(--color-heat)" />
            <TrendRow label="Sıcaklık" series={h.temp} unit=" °C" color="var(--color-health)" />
            <TrendRow label="Ses düzeyi" series={h.sound} unit=" dB" color="var(--color-feeding)" />
          </Card>

          {/* path */}
          {path.length > 0 && (
            <Card icon="🧭" title="Son güzergah (NFC bölgeleri)">
              <div className="ml-1 border-l-2 border-line">
                {path.map((r, i) => (
                  <div key={i} className="relative flex items-baseline gap-2 pl-4 py-1 text-xs">
                    <span className={"absolute -left-[5px] top-2 w-2 h-2 rounded-full border-2 border-panel " + (i === 0 ? "bg-accent" : "bg-line2")} />
                    <span className={"font-semibold " + (i === 0 ? "text-accent" : "text-ink")}>{AREA_LABEL[r.area] || r.area}</span>
                    <span className="ml-auto text-faint whitespace-nowrap">{fmtTime(r.ts)} · {i === 0 ? "şimdi" : durShort(r.dur)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* raw packet — the exact fields the ESP32 tag transmits */}
          <Card icon="🧬" title="Ham sensör verisi" right={<span className="text-[10px] text-faint">son LoRa paketi</span>}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px] bg-elev border border-line rounded-xl p-3">
              {[
                ["id", c.id], ["ts", c.ts], ["lat", c.lat], ["lng", c.lng],
                ["sats", c.sats], ["batt", c.batt], ["hr", c.hr], ["steps", c.steps],
                ["temp", c.temp], ["sound", c.sound], ["acev", c.acev],
                ["rssi", c.rssi], ["snr", c.snr], ["zone", c.area],
                ["epc", c.epc || "0".repeat(24), true],
              ].map(([k, v, wide]) => (
                <div key={k} className={"flex justify-between gap-2 " + (wide ? "col-span-2" : "")}>
                  <span className="text-faint">{k}</span>
                  <span className="text-ink break-all text-right">{v ?? "—"}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* sticky footer */}
        <footer className="p-3 border-t border-line bg-panel">
          <button onClick={() => buzz(c.id, !c.buzzer)}
            className={"w-full py-2.5 rounded-xl border font-semibold transition-colors " + (c.buzzer ? "grad-accent text-[#11141b] border-transparent shadow-lg shadow-accent/25" : "bg-elev text-ink border-line2 hover:border-accent")}>
            {c.buzzer ? "🔔 Buzzer AÇIK — durdurmak için dokun" : "🔕 Buzzer'ı çal"}
          </button>
        </footer>
      </aside>
    </>
  );
}
