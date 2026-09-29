(async () => {
  // --- timing configuration (ms) ---
  const TICK_POLL_INTERVAL = 2000;       // wait when paused before re-ticking
  const GAME_OVER_WAIT = 3000;           // pause after game over before restart attempt
  const RESTART_FAIL_WAIT = 5000;        // extra wait if session restart fails
  const POST_ANSWER_DELAY = 150;         // cooldown after submitting an answer
  const ROW_STALE_CHECK_DELAY = 200;     // extra wait if row hasn't cleared yet
  const INTER_ROW_DELAY = 50;            // final buffer before next iteration
  const ERROR_RECOVERY_WAIT = 500;       // short backoff on submit/tick errors
  const UNEXPECTED_ERROR_WAIT = 2000;    // longer backoff on unexpected failures
  const SESSION_LOST_WAIT = 3000;        // wait before restarting lost session
  const BASE_RETRY_BACKOFF = 300;        // multiplier base for safeFetch retries

  // --- schema & setup (unchanged) ---
  const { z } = await import("https://esm.sh/zod");

  const RowSchema = z.object({
    id: z.number(),
    mode: z.enum(["toBinary", "toDecimal"]),
    target: z.union([z.number(), z.string()]),
    bits: z.array(z.boolean()),
    spawnedAt: z.string().datetime()
  });

  const GameStateSchema = z.object({
    sessionId: z.number(),
    score: z.number(),
    rowsCompleted: z.number(),
    rows: z.array(RowSchema),
    secondsToNext: z.number(),
    gameOver: z.boolean(),
    paused: z.boolean(),
    isPreview: z.boolean(),
    correct: z.boolean().optional(),
    pointsAwarded: z.number().optional()
  });

  const pathMatch = window.location.pathname.match(/\/classes\/(\d+)(?:\/|$)/);
  const classId = pathMatch?.[1];

  if (!classId) {
    console.error("%cNo class ID found in URL", "color: red");
    throw new Error("Navigate to a class page first");
  }

  const baseUrl = `/api/classes/${classId}/games/binary`;

  const safeFetch = async (url, options = {}, retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, options);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        return GameStateSchema.parse(raw);
      } catch (err) {
        console.warn(`%cFetch failed (${i + 1}/${retries}): ${err.message}`, "color: orange");
        if (i === retries - 1) throw err;
        await new Promise(r => setTimeout(r, BASE_RETRY_BACKOFF * (i + 1)));
      }
    }
  };

  console.log("%cStarting session...", "color: cyan");
  let gameState = await safeFetch(`${baseUrl}/sessions`, { method: "POST" });
  console.log(`%cSession ${gameState.sessionId} started | Type window.__STOP_SOLVER = true to stop`, "color: green");

  while (!window.__STOP_SOLVER) {
    try {
      if (gameState.paused) {
        await new Promise(r => setTimeout(r, TICK_POLL_INTERVAL));
        gameState = await safeFetch(`${baseUrl}/sessions/${gameState.sessionId}/tick`, { method: "POST" });
        continue;
      }

      if (gameState.gameOver) {
        console.log("%cGame over detected, waiting for new session or manual stop...", "color: yellow");
        await new Promise(r => setTimeout(r, GAME_OVER_WAIT));
        try {
          gameState = await safeFetch(`${baseUrl}/sessions`, { method: "POST" });
          console.log(`%cNew session ${gameState.sessionId} started`, "color: green");
        } catch {
          console.log("%cFailed to restart, retrying in 5s...", "color: orange");
          await new Promise(r => setTimeout(r, RESTART_FAIL_WAIT));
        }
        continue;
      }

      while (gameState.rows.length > 0 && !window.__STOP_SOLVER) {
        const row = gameState.rows[0];
        const currentRowId = row.id;
        let answer;

        if (row.mode === "toBinary") {
          answer = (Number(row.target) >>> 0).toString(2).padStart(8, "0");
        } else if (row.mode === "toDecimal") {
          const binStr = row.bits.map(b => b ? "1" : "0").join("");
          answer = parseInt(binStr, 2).toString();
        }

        try {
          const ansState = await safeFetch(`${baseUrl}/sessions/${gameState.sessionId}/answers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rowId: row.id, answer })
          });

          if (ansState.correct) {
            console.log(`%c✓ Row ${currentRowId} +${ansState.pointsAwarded} | Score: ${ansState.score}`, "color: green");
          } else {
            console.log(`%c✗ Row ${currentRowId} rejected`, "color: orange");
          }

          gameState = ansState;
        } catch (err) {
          console.error(`%c✗ Failed to submit row ${currentRowId}: ${err.message}`, "color: red");
          await new Promise(r => setTimeout(r, ERROR_RECOVERY_WAIT));
        }

        await new Promise(r => setTimeout(r, POST_ANSWER_DELAY));

        try {
          gameState = await safeFetch(`${baseUrl}/sessions/${gameState.sessionId}/tick`, { method: "POST" });
        } catch (err) {
          console.error(`%c✗ Tick failed: ${err.message}`, "color: red");
          await new Promise(r => setTimeout(r, ERROR_RECOVERY_WAIT));
          continue;
        }

        if (gameState.rows.length > 0 && gameState.rows[0].id === currentRowId) {
          await new Promise(r => setTimeout(r, ROW_STALE_CHECK_DELAY));
          try {
            gameState = await safeFetch(`${baseUrl}/sessions/${gameState.sessionId}/tick`, { method: "POST" });
          } catch {}
        }

        await new Promise(r => setTimeout(r, INTER_ROW_DELAY));
      }

      await new Promise(r => setTimeout(r, INTER_ROW_DELAY));
      try {
        gameState = await safeFetch(`${baseUrl}/sessions/${gameState.sessionId}/tick`, { method: "POST" });
      } catch {}

    } catch (err) {
      console.error(`%cUnexpected error: ${err.message} - recovering...`, "color: red");
      await new Promise(r => setTimeout(r, UNEXPECTED_ERROR_WAIT));
      try {
        gameState = await safeFetch(`${baseUrl}/sessions/${gameState.sessionId}/tick`, { method: "POST" });
      } catch {
        console.log("%cSession lost, attempting restart...", "color: yellow");
        await new Promise(r => setTimeout(r, SESSION_LOST_WAIT));
        try {
          gameState = await safeFetch(`${baseUrl}/sessions`, { method: "POST" });
        } catch {}
      }
    }
  }

  console.log("%cSolver stopped by user", "color: magenta");
})();
