// leaderboard.js

const API_URL = import.meta.env.VITE_LEADERBOARD_API_URL;

// Fetch leaderboard from backend
async function fetchLeaderboard() {
  try {
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error("Failed to fetch leaderboard");
    }

    const result = await response.json();

    // If using Lambda proxy integration
    const data = result.body ? JSON.parse(result.body) : result;

    return data;

  } catch (error) {
    console.error("Error loading leaderboard:", error);
    return { crew: [], saboteur: [] };
  }
}

// Render leaderboard lists
function renderLeaderboard(data) {
  document.querySelectorAll(".leaderboard-list").forEach(list => {
    const role = list.dataset.role;
    const players = data[role] || [];

    list.innerHTML = "";

    players.forEach(player => {
      const li = document.createElement("li");

      li.innerHTML = `
        <span class="name">${player.playerName}</span>
        <span class="stats">
          <span class="stat kills">☠ ${player.damageDone ?? 0}</span>
          <span class="stat fixes">🔧 ${player.fixedHp ?? 0}</span>
          <span class="stat score">${player.score ?? 0}</span>
        </span>
      `;

      list.appendChild(li);
    });
  });
}

// Load real data on page load
document.addEventListener("DOMContentLoaded", async () => {
  const leaderboardData = await fetchLeaderboard();
  renderLeaderboard(leaderboardData);
});