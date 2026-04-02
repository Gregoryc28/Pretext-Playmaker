import { createMockPlayers, stepMockPlayers } from '../data/mockTracking';
import { placeLabels } from '../physics/labelPlacement';

const dimensions = { lengthYards: 120, widthYards: 53.3 };
const players = createMockPlayers(dimensions);
let visibleCount = 0;
let total = 0;

for (let i = 0; i < 600; i += 1) {
  stepMockPlayers(players, 1 / 120, dimensions);

  const obstacles = players.map((p) => ({
    id: p.playerId,
    x: p.location.x,
    y: p.location.y,
    radius: 0.9,
  }));

  const requests = players.map((p) => ({
    playerId: p.playerId,
    playerX: p.location.x,
    playerY: p.location.y,
    playerRadius: 0.9,
    width: 9,
    height: 2,
  }));

  const placements = placeLabels(requests, obstacles, {
    x: 0,
    y: 0,
    width: dimensions.lengthYards,
    height: dimensions.widthYards,
  });

  for (const placement of placements.values()) {
    total += 1;
    if (placement.visible) {
      visibleCount += 1;
    }
  }
}

const visibleRatio = (visibleCount / total) * 100;
console.log(`Smoke test completed. Visible label ratio: ${visibleRatio.toFixed(2)}%`);

