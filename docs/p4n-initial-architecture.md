# Lightweight Geo Storage — 10k POI

## Assumptions (if any fail, redesign)
1. 10k rows, static/low write rate
2. Single writer
3. Radii < ~20 km
4. WGS84 lat/lon degrees

---

## Stack
- `better-sqlite3` — sync, zero IPC
- Single SQLite file, WAL mode
- Spatial: B-Tree + bbox prefilter (R-Tree only if >100k rows or large radii)
- Dedup: `UNIQUE(source_id)` + `INSERT OR IGNORE`

---

## Schema

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;

CREATE TABLE poi (
  id        INTEGER PRIMARY KEY,
  source_id TEXT    UNIQUE NOT NULL,
  lat       REAL    NOT NULL,
  lon       REAL    NOT NULL,
  data      TEXT,
  ts        INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_lat_lon ON poi(lat, lon);
```

> No AUTOINCREMENT (unnecessary overhead). INTEGER ts (smaller/faster than TEXT).

---

## Query Model
- B-Tree: O(log n)
- Bbox scan → k candidates ≪ n
- Haversine refinement: O(k)
- At 10k rows, k < 100 for small radii

---

## Bbox Math

```
dLat = R / 111.32
dLon = R / (111.32 * cos(lat_rad))   ⚠️ clamp cos near ±90°
```

**Fix:** `Math.max(Math.cos(latRad), 0.0001)` — prevents dLon blowup at poles.

---

## Implementation

```js
const DEG    = Math.PI / 180;
const KM_LAT = 111.32;

const db = require('better-sqlite3')('geo.db');

const insert = db.prepare(`
  INSERT OR IGNORE INTO poi (source_id, lat, lon, data)
  VALUES (?, ?, ?, ?)
`);

const boxStmt = db.prepare(`
  SELECT id, lat, lon, data FROM poi
  WHERE lat BETWEEN ? AND ?
    AND lon BETWEEN ? AND ?
`);

function haversine(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * DEG;
  const dLon = (bLon - aLon) * DEG;
  const sLat = Math.sin(dLat / 2);
  const sLon = Math.sin(dLon / 2);
  const c    = Math.cos(aLat * DEG) * Math.cos(bLat * DEG);
  return 6371 * 2 * Math.asin(Math.sqrt(sLat*sLat + c*sLon*sLon));
}

function findNearby(lat, lon, r = 5) {
  const latRad = lat * DEG;
  const cosLat = Math.max(Math.cos(latRad), 0.0001); // ✅ pole fix
  const dLat   = r / KM_LAT;
  const dLon   = r / (KM_LAT * cosLat);

  return boxStmt
    .all(lat - dLat, lat + dLat, lon - dLon, lon + dLon)
    .reduce((acc, p) => {
      const dist = haversine(lat, lon, p.lat, p.lon);
      if (dist <= r) acc.push({ ...p, dist }); // ✅ attach dist, avoid double-compute
      return acc;
    }, [])
    .sort((a, b) => a.dist - b.dist); // ✅ return sorted
}
```

> **Note:** Original discarded computed distance after filtering — wasteful if callers need it for display. Return it attached and sort by default.

---

## Micro-Optimizations (selective)

| Opt | Worth it? | Note |
|-----|-----------|------|
| Precompute `cos(lat)` once | ✅ Yes | Done above |
| Equirectangular vs Haversine | ✅ Yes (<20km) | 3–4× faster, error grows with latitude — fine equatorward, verify at 60°N+ |
| Store lat/lon in radians | ❌ No | Saves ~200µs/10k, breaks tooling/readability |

---

## Corrected Claims

| Claim | Reality |
|-------|---------|
| "Near-zero memory" | SQLite page cache ~2MB default |
| "Constant lookup" | B-Tree is O(log n) |
| "ACID guaranteed" | Depends on journal mode — WAL + NORMAL covers most cases |
| "No crash loss" | Only with proper sync mode |
| 10k rows fits RAM | True on any modern system |

---

## When to Upgrade

| Trigger | Solution |
|---------|----------|
| >100k rows | R-Tree virtual table |
| >500k rows | SpatiaLite |
| High write concurrency | Connection pool + WAL tuning |
| Polygon queries | SpatiaLite or PostGIS |
| Nearest-N at scale | R-Tree or external index |
| Approximate neighbor bucketing | H3 / S2 (different query model — not drop-in) |

> H3/S2 are cell hierarchies, not spatial indexes. Good for bucketing; still need Haversine refinement for exact radius queries.

---

## Verdict

For 10k POI: **bbox + B-Tree + in-process SQLite is optimal.** Anything heavier is premature.