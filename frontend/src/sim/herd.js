// In-browser herd store: holds per-cow histories, advances the simulation, runs analytics
// + the virtual fence, and exposes snapshots/details for the UI. Replaces the old backend.
import { Cow, generate, seedPreviousMilk, NAMES, NO_EPC, LIVE_START, START_DAY, TIME_ACCEL, NUM_COWS, AREA_BEHAVIOR } from "./model.js";
import * as analytics from "./analytics.js";
import { FENCE, BASE_LAT, BASE_LNG, inside } from "./geofence.js";

const WINDOW = analytics.WINDOW;
const CAP = { report: 300, nfc: 300, milk: 64 };

export class Herd {
  constructor() {
    this.cows = Array.from({ length: NUM_COWS }, (_, i) => new Cow(i + 1));
    this.byId = Object.fromEntries(this.cows.map((c) => [c.id, c]));
    this.reportsH = {}; this.nfcH = {}; this.milkH = {}; this.latest = {}; this.alertsStore = {};
    this.dayStep = {};            // cow -> { dayNumber: total steps } (rolling daily totals)
    this.fenceBuzzed = new Set();
    this.simNow = LIVE_START;
    this.ingestAll(seedPreviousMilk(this.cows));
    this.ingestAll(generate(this.cows, LIVE_START));
    for (const c of this.cows) {  // seed the prior week of daily steps so the average is meaningful
      const o = (this.dayStep[c.id] = this.dayStep[c.id] || {});
      for (let d = 6; d >= 1; d--) o[START_DAY - d] = Math.round(c.activity * 2500 * (0.9 + Math.random() * 0.2));
    }
  }
  _push(store, cid, item, cap) { const a = store[cid] || (store[cid] = []); a.push(item); if (a.length > cap) a.shift(); }
  ingest(m) {
    const cid = m.id, ts = m.ts, st = this.latest[cid] || (this.latest[cid] = { id: cid });
    st.ts = Math.max(st.ts || 0, ts);
    if (m.type === "nfc") { st.area = m.area; st.area_since = ts; this._push(this.nfcH, cid, { area: m.area, ts }, CAP.nfc); }
    else if (m.type === "milk") this._push(this.milkH, cid, { liters: m.liters, ts }, CAP.milk);
    else {
      for (const k of ["lat", "lng", "sats", "batt", "hr", "temp", "steps", "sound", "acev", "rssi", "snr"]) if (k in m) st[k] = m[k];
      if (m.epc && m.epc !== NO_EPC) { st.epc = m.epc; st.epc_ts = ts; }  // sticky: keep the last gate read
      this._push(this.reportsH, cid, { ts, hr: m.hr, temp: m.temp, steps: m.steps, batt: m.batt, sound: m.sound, acev: m.acev }, CAP.report);
      if (ts >= LIVE_START) {     // accumulate live steps into per-day totals
        const day = Math.floor(ts / 86400), o = (this.dayStep[cid] = this.dayStep[cid] || {});
        o[day] = (o[day] || 0) + (m.steps || 0);
        const keys = Object.keys(o); if (keys.length > 20) delete o[Math.min(...keys.map(Number))];
      }
    }
  }
  ingestAll(msgs) { for (const m of msgs) this.ingest(m); }
  tick(wallDt) { this.simNow += wallDt * TIME_ACCEL; this.ingestAll(generate(this.cows, this.simNow)); }
  buzz(id, on) { if (this.byId[id]) this.byId[id].buzzer = on; }

  // --- accessors used by analytics ---
  cowIds() { return Object.keys(this.latest).map(Number).sort((a, b) => a - b); }
  nowTs(cid) { return (this.latest[cid] && this.latest[cid].ts) || this.simNow; }
  reports(cid, since) { return (this.reportsH[cid] || []).filter((r) => since == null || r.ts >= since); }
  nfcEvents(cid) { return this.nfcH[cid] || []; }
  milkEvents(cid) { return this.milkH[cid] || []; }
  dailySteps(cid) {
    const o = this.dayStep[cid] || {};
    return Object.keys(o).map(Number).sort((a, b) => a - b).slice(-14).map((day) => ({ day, steps: Math.round(o[day]) }));
  }
  zoneMinutes(cid, since, until) {
    const ev = this.nfcEvents(cid); if (!ev.length) return {};
    until = until || this.nowTs(cid) || ev[ev.length - 1].ts;
    const mins = {};
    for (let i = 0; i < ev.length; i++) {
      let start = ev[i].ts, end = i + 1 < ev.length ? ev[i + 1].ts : until;
      if (since != null) start = Math.max(start, since);
      end = Math.min(end, until);
      if (end > start) mins[ev[i].area] = (mins[ev[i].area] || 0) + (end - start) / 60;
    }
    return mins;
  }
  behavior(cid) {
    const t = this.nowTs(cid);
    if (!t) return { feed_min: 0, rumin_min: 0, rest_min: 0, milk_today: 0, steps_24h: 0, coverage: 0 };
    const since = t - WINDOW, z = this.zoneMinutes(cid, since, t), rest = z.bedding || 0;
    const milk = this.milkEvents(cid).filter((m) => m.ts >= since).reduce((s, m) => s + m.liters, 0);
    const reps = this.reports(cid, since);
    const steps = reps.reduce((s, r) => s + (r.steps || 0), 0);
    const acev = reps.reduce((s, r) => s + (r.acev || 0), 0);
    const ev = this.nfcEvents(cid);
    const coverage = ev.length ? Math.min(1, (t - Math.max(since, ev[0].ts)) / WINDOW) : 0;
    return { feed_min: +(z.feeding || 0).toFixed(1), rumin_min: +(rest * 0.7).toFixed(1), rest_min: +rest.toFixed(1),
      milk_today: +milk.toFixed(1), steps_24h: Math.round(steps), acev_24h: acev, coverage: +coverage.toFixed(2) };
  }

  cowState(cid) {
    const st = this.latest[cid]; if (!st) return null;
    const cow = this.byId[cid];
    // current activity: restless if in heat, otherwise the zone's behaviour
    const activity = cow && cow.anomaly === "heat" ? "restless" : (AREA_BEHAVIOR[st.area] || "unknown");
    return { ...st, name: NAMES[(cid - 1) % NAMES.length], buzzer: !!(cow && cow.buzzer), activity,
      ...this.behavior(cid), alerts: Object.values(this.alertsStore[cid] || {}) };
  }
  detail(cid) {
    const cow = this.cowState(cid); if (!cow) return null;
    const reps = this.reportsH[cid] || [];
    return {
      cow,
      history: {
        hr: reps.filter((r) => r.hr != null).map((r) => ({ ts: r.ts, v: r.hr })),
        temp: reps.filter((r) => r.temp != null).map((r) => ({ ts: r.ts, v: r.temp })),
        steps: reps.map((r) => ({ ts: r.ts, v: r.steps || 0 })),
        sound: reps.filter((r) => r.sound != null).map((r) => ({ ts: r.ts, v: r.sound })),
        milk: (this.milkH[cid] || []).map((m) => ({ ts: m.ts, v: m.liters })),
      },
      path: (this.nfcH[cid] || []).slice(-15).map((e) => ({ area: e.area, ts: e.ts })),
      dailySteps: this.dailySteps(cid),
      alerts: cow.alerts,
    };
  }

  evaluate() {
    const res = analytics.evaluateAll(this);
    for (const cid of this.cowIds()) {
      const st = this.latest[cid];
      if (!st || st.lat == null) continue;
      if (!inside(st.lat, st.lng)) {
        (res[cid] = res[cid] || []).push({ id: cid, type: "fence", severity: "critical", since: this.nowTs(cid),
          message: "Sanal çit dışında — buzzer çalıyor.", data: { lat: st.lat, lng: st.lng } });
        if (!this.fenceBuzzed.has(cid)) { this.fenceBuzzed.add(cid); this.byId[cid].buzzer = true; }
      } else if (this.fenceBuzzed.has(cid)) { this.fenceBuzzed.delete(cid); this.byId[cid].buzzer = false; }
    }
    for (const cid of this.cowIds()) {
      const prev = this.alertsStore[cid] || {}, next = {};
      for (const a of res[cid] || []) { if (prev[a.type]) a.since = prev[a.type].since; next[a.type] = a; }
      this.alertsStore[cid] = next;
    }
  }
  snapshot() {
    this.evaluate();
    return { cows: this.cowIds().map((c) => this.cowState(c)), fence: FENCE, base: [BASE_LAT, BASE_LNG], simTime: this.simNow };
  }
}
