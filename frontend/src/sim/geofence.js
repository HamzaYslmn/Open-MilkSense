// Virtual fence over the pasture (metre offsets from the barn → lat/lng) + point-in-polygon.
export const BASE_LAT = 40.9876, BASE_LNG = 29.1234;
export const M_LAT = 111111, M_LNG = 111111 * Math.cos((BASE_LAT * Math.PI) / 180);

const OFFSETS = [[250, -120], [230, 160], [40, 270], [-210, 200], [-260, -110], [-60, -250]];
// editable polygon — the map lets the user drag the corners. `let` so setFence can swap it;
// importers read it as a live binding (herd.snapshot, inside).
export let FENCE = OFFSETS.map(([n, e]) => [BASE_LAT + n / M_LAT, BASE_LNG + e / M_LNG]);
export function setFence(points) { FENCE = points; }

export function inside(lat, lng) {
  const f = FENCE, x = lng, y = lat;
  let res = false, n = f.length, j = n - 1;
  for (let i = 0; i < n; i++) {
    const [yi, xi] = f[i], [yj, xj] = f[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) res = !res;
    j = i;
  }
  return res;
}
