import { useState } from "react";
import { AREA_LABEL, ALERT, SEV, behaviorOf, topAlert, tagStyle } from "../lib/ui.js";

export default function AnimalList({ cows, selectedId, onSelect }) {
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const flagged = cows.filter((c) => c.alerts.length).length;
  const list = [...cows]
    .filter((c) => !onlyAlerts || c.alerts.length)
    .sort((a, b) => {
      const ta = topAlert(a), tb = topAlert(b);
      return (ta ? SEV[ta.severity] : 9) - (tb ? SEV[tb.severity] : 9) || a.id - b.id;
    });

  return (
    <aside className="card p-2.5 flex flex-col gap-2 min-h-0">
      <div className="flex items-center justify-between px-1">
        <h2 className="sec-h">🐄 Hayvanlar</h2>
        <button onClick={() => setOnlyAlerts((v) => !v)}
          className={"text-[10px] font-semibold rounded-full px-2.5 py-1 border transition-colors " +
            (onlyAlerts ? "bg-fence/20 border-fence/50 text-fence" : "bg-elev border-line text-dim hover:border-accent")}>
          {onlyAlerts ? `Uyarılar · ${flagged}` : `Tümü · ${cows.length}`}
        </button>
      </div>

      <div className="flex flex-col gap-1.5 overflow-auto pr-0.5">
        {list.length === 0 && <div className="text-dim text-[13px] text-center py-6">Gösterilecek hayvan yok</div>}
        {list.map((c) => {
          const a = topAlert(c), out = c.alerts.some((al) => al.type === "fence");
          const beh = behaviorOf(c), color = a ? ALERT[a.type].color : "var(--color-line2)";
          const avatarColor = a ? ALERT[a.type].color : "var(--color-accent)";
          const sel = selectedId === c.id;
          return (
            <button key={c.id} onClick={() => onSelect(c.id)}
              className={"flex items-center gap-2.5 rounded-xl pl-2.5 pr-2 py-2 text-left border transition-colors " +
                (sel ? "bg-accent/12 border-accent" : "bg-elev border-line2 hover:border-accent/60")}
              style={{ borderLeft: `3px solid ${color}` }}>
              <div className="w-9 h-9 rounded-lg grid place-items-center text-lg shrink-0 border"
                style={{ background: avatarColor + "24", borderColor: avatarColor + "5e" }}>🐄</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-[13px] truncate">{c.name}</span>
                  <span className="text-dim font-normal text-[11px]">#{c.id}</span>
                </div>
                <div className="text-[11px] text-dim truncate">
                  {beh.icon} {out ? <span className="text-health">Çit dışında</span> : beh.label} · {c.hr || "–"} bpm · {c.temp ?? "–"}°
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 max-w-[92px]">
                {c.alerts.length
                  ? c.alerts.slice(0, 2).map((al) => <span key={al.type} className="text-[9px] font-bold uppercase rounded px-1.5 py-px border" style={tagStyle(ALERT[al.type].color)}>{ALERT[al.type].label}</span>)
                  : <span className="text-[10px] text-accent font-semibold">● İYİ</span>}
                {c.buzzer && <span className="text-[11px]">🔔</span>}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
