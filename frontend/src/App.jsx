import { useState } from "react";
import { useHerd } from "./sim/useHerd.js";
import MapView from "./components/Map.jsx";
import AnimalList from "./components/AnimalList.jsx";
import CowDetail from "./components/CowDetail.jsx";

export default function App() {
  const { snap, buzz, detail } = useHerd();
  const [sel, setSel] = useState(null);
  const det = sel != null ? detail(sel) : null;
  const flagged = snap.cows.filter((c) => c.alerts.length).length;
  const clock = new Date(snap.simTime * 1000).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-3 px-4 py-2.5 bg-panel/90 backdrop-blur border-b border-line">
        <div className="w-9 h-9 rounded-xl grid place-items-center text-xl grad-accent shadow-lg shadow-accent/20">🐄</div>
        <div className="leading-tight">
          <h1 className="text-[15px] font-bold m-0">MilkSense</h1>
          <div className="text-[11px] text-dim -mt-0.5">Sürü Takibi</div>
        </div>
        <span className="chip ml-1">🕐 {clock}</span>

        <div className="flex-1" />

        <span className="chip"><span className="live-dot w-2 h-2 rounded-full bg-accent" /> canlı</span>
        <span className="chip"><b className="text-ink">{snap.cows.length}</b> inek · <b className={flagged ? "text-fence" : "text-ink"}>{flagged}</b> uyarı</span>
      </header>

      <main className="grid grid-cols-[1fr_352px] gap-3 p-3 flex-1 min-h-0">
        <MapView cows={snap.cows} fence={snap.fence} base={snap.base} simTime={snap.simTime} selectedId={sel} onSelect={setSel} />
        <AnimalList cows={snap.cows} selectedId={sel} onSelect={setSel} />
      </main>

      {det && <CowDetail detail={det} buzz={buzz} onClose={() => setSel(null)} />}
    </div>
  );
}
