import type { FieldDimensions, PlayerTrackingSample, TeamSide, TrackingFrame } from './types';

export interface MockPlayerState extends PlayerTrackingSample {
  radiusYards: number;
}

const HOME_NAMES = ['Avery', 'Blake', 'Carter', 'Drew', 'Ellis', 'Finley', 'Gray', 'Hayden', 'Indy', 'Jordan', 'Kai'];
const AWAY_NAMES = ['Logan', 'Morgan', 'Nico', 'Oakley', 'Parker', 'Quinn', 'Reese', 'Sawyer', 'Taylor', 'Vale', 'Wren'];

const YARDS_PER_SECOND_TO_MPH = 2.045;

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function makePlayer(index: number, team: TeamSide, dimensions: FieldDimensions): MockPlayerState {
  const isHome = team === 'home';
  const sourceNames = isHome ? HOME_NAMES : AWAY_NAMES;
  const name = sourceNames[index % sourceNames.length];
  const baseX = isHome ? randomRange(20, 52) : randomRange(68, 100);

  return {
    playerId: `${team}-${index + 1}`,
    displayName: `${name} ${index + 1}`,
    team,
    jersey: isHome ? index + 10 : index + 40,
    position: index < 2 ? 'QB' : index < 7 ? 'WR' : 'DB',
    location: {
      x: Math.min(dimensions.lengthYards - 2, Math.max(2, baseX)),
      y: randomRange(4, dimensions.widthYards - 4),
    },
    velocity: {
      x: randomRange(-5.8, 5.8),
      y: randomRange(-4.8, 4.8),
    },
    speedMph: 0,
    radiusYards: 0.95,
  };
}

export function createMockPlayers(dimensions: FieldDimensions): MockPlayerState[] {
  const players: MockPlayerState[] = [];

  for (let i = 0; i < 11; i += 1) {
    players.push(makePlayer(i, 'home', dimensions));
    players.push(makePlayer(i, 'away', dimensions));
  }

  return players;
}

export function stepMockPlayers(players: MockPlayerState[], deltaSeconds: number, dimensions: FieldDimensions): void {
  for (const player of players) {
    player.location.x += player.velocity.x * deltaSeconds;
    player.location.y += player.velocity.y * deltaSeconds;

    if (player.location.x < player.radiusYards || player.location.x > dimensions.lengthYards - player.radiusYards) {
      player.velocity.x *= -1;
      player.location.x = Math.min(
        dimensions.lengthYards - player.radiusYards,
        Math.max(player.radiusYards, player.location.x),
      );
    }

    if (player.location.y < player.radiusYards || player.location.y > dimensions.widthYards - player.radiusYards) {
      player.velocity.y *= -1;
      player.location.y = Math.min(
        dimensions.widthYards - player.radiusYards,
        Math.max(player.radiusYards, player.location.y),
      );
    }

    const speedYardsPerSecond = Math.hypot(player.velocity.x, player.velocity.y);
    player.speedMph = speedYardsPerSecond * YARDS_PER_SECOND_TO_MPH;
  }
}

export function buildTrackingFrame(players: MockPlayerState[], frameId: number): TrackingFrame {
  return {
    meta: {
      gameId: 'mock-game',
      playId: 'mock-play',
      frameId,
      timestampMs: performance.now(),
    },
    players,
  };
}

