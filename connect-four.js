(async () => {
  const match = window.location.pathname.match(/\/classes\/(\d+)/);
  if (!match) return console.error("no class id found in url");
  const classId = match[1];

  const CONFIG = {
    stateUrl: `https://cofy.uk/api/classes/${classId}/games/connect-four`,
    moveUrl: `https://cofy.uk/api/classes/${classId}/games/connect-four/move`,
    pollInterval: 2000,
    maxDepth: 6
  };

  // precompute 69 winning lines
  const lines = [];
  for(let r=0;r<6;r++) for(let c=0;c<4;c++) lines.push([r*7+c, r*7+c+1, r*7+c+2, r*7+c+3]);
  for(let r=0;r<3;r++) for(let c=0;c<7;c++) lines.push([r*7+c, (r+1)*7+c, (r+2)*7+c, (r+3)*7+c]);
  for(let r=0;r<3;r++) for(let c=0;c<4;c++) lines.push([r*7+c, (r+1)*7+c+1, (r+2)*7+c+2, (r+3)*7+c+3]);
  for(let r=3;r<6;r++) for(let c=0;c<4;c++) lines.push([r*7+c, (r-1)*7+c+1, (r-2)*7+c+2, (r-3)*7+c+3]);

  function checkWin(b, p) {
    for (const l of lines) if (b[l[0]]===p && b[l[1]]===p && b[l[2]]===p && b[l[3]]===p) return true;
    return false;
  }

  function evaluate(b, p, o) {
    let s = 0;
    for (let r=0; r<6; r++) { if (b[r*7+3]===p) s+=3; else if (b[r*7+3]===o) s-=3; }
    for (const l of lines) {
      let pc=0, oc=0;
      for (const i of l) { if (b[i]===p) pc++; else if (b[i]===o) oc++; }
      if (pc>0 && oc===0) s += (pc===3)?50:10;
      else if (oc>0 && pc===0) s -= (oc===3)?40:8;
    }
    return s;
  }

  function getMoves(b) {
    const m = [];
    for (let c=0; c<7; c++) if (b[c]===0) m.push(c);
    return m.sort((a,b) => Math.abs(3-a) - Math.abs(3-b));
  }

  function makeMove(b, c, p) {
    const nb = [...b];
    for (let r=5; r>=0; r--) { const i=r*7+c; if (nb[i]===0) { nb[i]=p; return nb; } }
    return null;
  }

  function minimax(b, d, a, bt, mx, p, o) {
    if (checkWin(b, p)) return 1000000+d;
    if (checkWin(b, o)) return -1000000-d;
    const mv = getMoves(b);
    if (d===0 || mv.length===0) return evaluate(b, p, o);
    if (mx) {
      let v=-Infinity;
      for (const c of mv) { v=Math.max(v, minimax(makeMove(b,c,p), d-1, a, bt, false, p, o)); a=Math.max(a,v); if(bt<=a) break; }
      return v;
    } else {
      let v=Infinity;
      for (const c of mv) { v=Math.min(v, minimax(makeMove(b,c,o), d-1, a, bt, true, p, o)); bt=Math.min(bt,v); if(bt<=a) break; }
      return v;
    }
  }

  function getBestMove(b, p, t) {
    const o = p===1?2:1;
    const mv = getMoves(b);
    const depth = t<10 ? 4 : t<20 ? 5 : CONFIG.maxDepth;
    let bc=mv[0], bs=-Infinity;
    for (const c of mv) {
      const s = minimax(makeMove(b,c,p), depth-1, -Infinity, Infinity, false, p, o);
      if (s>bs) { bs=s; bc=c; }
    }
    return bc;
  }

  console.log(`bot started for class ${classId} :3`);
  
  setInterval(async () => {
    try {
      const res = await fetch(CONFIG.stateUrl, { credentials: "include" });
      if (!res.ok) return;
      const state = await res.json();
      if (state.status !== 'playing' || !state.isMyTurn) return;

      const col = getBestMove(state.board, state.myPlayerNumber, state.secondsUntilDeadline);
      console.log(`playing column ${col}`);
      
      await fetch(CONFIG.moveUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ column: col })
      });
    } catch (err) { console.error("bot error:", err); }
  }, CONFIG.pollInterval);
})();
