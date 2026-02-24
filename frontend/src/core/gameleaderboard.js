// leaderboard.js

// Placeholder leaderboard data (UI testing only)
const mockLeaderboard = {
  crew: [
    { playerName: "Nova", score: 1240, kills: 1, fixes: 6 },
    { playerName: "Orion", score: 1185, kills: 0, fixes: 5 },
    { playerName: "Echo", score: 1110, kills: 2, fixes: 4 },
    { playerName: "Atlas", score: 1050, kills: 1, fixes: 3 },
    { playerName: "Luna", score: 980, kills: 0, fixes: 3 }
  ],
  saboteur: [
    { playerName: "Viper", score: 1320, kills: 7, fixes: 0 },
    { playerName: "Rogue", score: 1210, kills: 6, fixes: 0 },
    { playerName: "Phantom", score: 1135, kills: 5, fixes: 1 },
    { playerName: "Shade", score: 1075, kills: 4, fixes: 0 },
    { playerName: "Nyx", score: 990, kills: 3, fixes: 0 }
  ]
};

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
          <span class="stat kills">☠ ${player.kills}</span>
          <span class="stat fixes">🔧 ${player.fixes}</span>
          <span class="stat score">${player.score}</span>
        </span>
      `;

      list.appendChild(li);
    });
  });
}
// Initial render (placeholder data)
document.addEventListener("DOMContentLoaded", () => {
  renderLeaderboard(mockLeaderboard);
});