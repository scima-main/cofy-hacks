(async () => {
  const match = window.location.pathname.match(/\/classes\/(\d+)/);
  if (!match) return console.error("no class id found in current url");

  const classId = match[1];
  const raw = prompt(`enter raw score for class ${classId} (connect-four):`, "10");
  if (raw === null) return console.log("cancelled");

  const score = Number(raw);
  if (Number.isNaN(score)) return console.error("invalid number");

  try {
    const res = await fetch(`https://cofy.uk/api/classes/${classId}/games/connect-four/scores`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ score }),
      credentials: "include"
    });

    if (!res.ok) throw new Error(`http ${res.status}`);
    console.log(`submitted ${score} to class ${classId}`, await res.json().catch(() => "(no body)"));
  } catch (err) {
    console.error("submission failed:", err);
  }
})();
