(async () => {
  const match = window.location.pathname.match(/\/classes\/(\d+)/);
  if (!match) return console.error("no class id found in url");
  const classId = match[1];

  const CONFIG = {
    stateUrl: `https://cofy.uk/api/classes/${classId}/games/battleships`,
    shootUrl: `https://cofy.uk/api/classes/${classId}/games/battleships/shoot`,
    pollInterval: 2000
  };

  // Concentric rings from center outward (pre-sorted by distance)
  // Ring 0: center 4 cells
  // Ring 1: next 8 cells
  // Ring 2: next 12 cells  
  // Remaining rings fill outward to edges
  const RINGS = [
    ["E5","E6","F5","F6"],
    ["D5","G5","E4","F4","E7","F7","D6","G6"],
    ["C5","H5","E3","F3","E8","F8","D4","G4","D7","G7","C6","H6"],
    ["B5","I5","E2","F2","E9","F9","C4","H4","C7","H7","D3","G3","D8","G8","B6","I6"],
    ["A5","J5","E1","F1","E10","F10","B4","I4","B7","I7","C3","H3","C8","H8","A6","J6","B3","I3","B8","I8"],
    ["A4","J4","A7","J7","C2","H2","C9","H9","D2","G2","D9","G9","A3","J3","A8","J8"],
    ["B2","I2","B9","I9","C1","H1","C10","H10","A2","J2","A9","J9"],
    ["A1","J1","A10","J10","B1","I1","B10","I10"]
  ];

  const LETTERS = "ABCDEFGHIJ";
  const coordToIdx = (c) => ({ r: LETTERS.indexOf(c[0]), c: parseInt(c.slice(1), 10) - 1 });
  const idxToCoord = (r, c) => `${LETTERS[r]}${c + 1}`;

  // Fisher-Yates shuffle
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Generate shuffled opening sequence once per session
  // Takes 1 from ring 0, 2 from ring 1, 3 from ring 2, then all remaining
  function generateOpeningSequence() {
    const seq = [];
    const counts = [1, 2, 3]; // shots per ring for first 6
    
    for (let r = 0; r < RINGS.length; r++) {
      const shuffled = shuffle(RINGS[r]);
      const take = r < counts.length ? counts[r] : shuffled.length;
      for (let i = 0; i < take && i < shuffled.length; i++) {
        seq.push(shuffled[i]);
      }
    }
    return seq;
  }

  const OPENING_SEQUENCE = generateOpeningSequence();

  class ShotTracker {
    constructor() {
      this.shots = new Map();
      this.remainingSizes = [5, 4, 3, 3, 2];
    }

    update(newShots) {
      for (const s of newShots) {
        if (!this.shots.has(s.coordinate)) {
          this.shots.set(s.coordinate, { hit: s.hit, confirmedSunk: false });
        }
      }
      this.reconcileSinks();
    }

    reconcileSinks() {
      const visited = new Set();
      const clusters = [];

      for (const [coord, data] of this.shots) {
        if (!data.hit || visited.has(coord)) continue;
        const cluster = [];
        const stack = [coord];

        while (stack.length) {
          const cur = stack.pop();
          if (visited.has(cur)) continue;
          visited.add(cur);
          cluster.push(cur);

          const { r, c } = coordToIdx(cur);
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10) {
              const nCoord = idxToCoord(nr, nc);
              if (this.shots.get(nCoord)?.hit && !visited.has(nCoord)) stack.push(nCoord);
            }
          }
        }
        clusters.push(cluster);
      }

      const unmatched = [...this.remainingSizes].sort((a,b) => b - a);
      for (const cl of clusters.sort((a,b) => b.length - a.length)) {
        const idx = unmatched.indexOf(cl.length);
        if (idx !== -1) {
          unmatched.splice(idx, 1);
          for (const c of cl) this.shots.get(c).confirmedSunk = true;
        }
      }
      this.remainingSizes = unmatched.sort((a,b) => a - b);
    }

    getRemaining() { return this.remainingSizes; }
    getShotArray() { return [...this.shots.entries()].map(([k,v]) => ({ coordinate: k, hit: v.hit })); }
    hasHit() { return [...this.shots.values()].some(s => s.hit); }
  }

  function buildHeatmap(shots, remainingSizes) {
    const grid = Array.from({ length: 10 }, () => Array(10).fill(0));
    const shotSet = new Set(shots.map(s => s.coordinate));
    const minShip = remainingSizes.length ? Math.min(...remainingSizes) : 1;

    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        const coord = idxToCoord(r, c);
        if (shotSet.has(coord)) continue;
        if (minShip > 1 && (r + c) % minShip !== 0) continue;

        let placements = 0;
        for (const size of remainingSizes) {
          if (c + size <= 10) {
            let valid = true;
            for (let k = 0; k < size; k++) if (shotSet.has(idxToCoord(r, c + k))) { valid = false; break; }
            if (valid) placements += 1.4;
          }
          if (r + size <= 10) {
            let valid = true;
            for (let k = 0; k < size; k++) if (shotSet.has(idxToCoord(r + k, c))) { valid = false; break; }
            if (valid) placements += 1.0;
          }
        }

        const isEdgeRow = r === 0 || r === 9;
        const isEdgeCol = c === 0 || c === 9;
        const isNearEdge = r <= 1 || r >= 8 || c <= 1 || c >= 8;
        
        if (isEdgeRow || isEdgeCol) {
          placements *= 1.4;
        } else if (isNearEdge) {
          placements *= 1.2;
        }

        grid[r][c] = placements;
      }
    }
    return grid;
  }

  function getTargetShot(shots) {
    const hits = shots.filter(s => s.hit).map(s => coordToIdx(s.coordinate));
    const shotSet = new Set(shots.map(s => s.coordinate));
    
    for (const h of hits) {
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nr = h.r + dr, nc = h.c + dc;
        if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10) {
          const coord = idxToCoord(nr, nc);
          if (!shotSet.has(coord)) return coord;
        }
      }
    }
    return null;
  }

  function chooseCoordinate(tracker) {
    if (!tracker.hasHit()) {
      const shotCoords = new Set(tracker.getShotArray().map(s => s.coordinate));
      for (const coord of OPENING_SEQUENCE) {
        if (!shotCoords.has(coord)) return coord;
      }
    }

    const target = getTargetShot(tracker.getShotArray());
    if (target) return target;

    const remaining = tracker.getRemaining();
    if (remaining.length === 0) return null;

    const heatmap = buildHeatmap(tracker.getShotArray(), remaining);
    let best = null, maxVal = -1;

    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        if (heatmap[r][c] > maxVal) {
          maxVal = heatmap[r][c];
          best = idxToCoord(r, c);
        }
      }
    }
    return best;
  }

  const tracker = new ShotTracker();
  console.log(`battleships bot started for class ${classId} :3`);
  console.log(`opening sequence: ${OPENING_SEQUENCE.slice(0, 6).join(", ")}...`);

  setInterval(async () => {
    try {
      const res = await fetch(CONFIG.stateUrl, { credentials: "include" });
      if (!res.ok) return;
      const state = await res.json();

      if (state.phase !== "playing") return;
      
      tracker.update(state.myShots);
      const coord = chooseCoordinate(tracker);
      if (!coord) return;

      console.log(`shooting ${coord}`);
      await fetch(CONFIG.shootUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ coordinate: coord })
      });
    } catch (err) { console.error("bot error:", err); }
  }, CONFIG.pollInterval);
})();
