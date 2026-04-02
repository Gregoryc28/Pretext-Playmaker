import { CircleObstacle, Rect, SpatialGrid } from './spatialGrid';

export interface LabelRequest {
  playerId: string;
  playerX: number;
  playerY: number;
  playerRadius: number;
  width: number;
  height: number;
}

export interface LabelPlacement {
  playerId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  visible: boolean;
}

const CANDIDATE_ANGLES = [330, 15, 60, 105, 150, 195, 240, 285];

function intersectsCircle(rect: Rect, circle: CircleObstacle, padding: number): boolean {
  const nearestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.width));
  const nearestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.height));
  const dx = circle.x - nearestX;
  const dy = circle.y - nearestY;
  return dx * dx + dy * dy < (circle.radius + padding) * (circle.radius + padding);
}

function intersectsRect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function insideBounds(rect: Rect, bounds: Rect): boolean {
  return (
    rect.x >= bounds.x &&
    rect.y >= bounds.y &&
    rect.x + rect.width <= bounds.x + bounds.width &&
    rect.y + rect.height <= bounds.y + bounds.height
  );
}

export function placeLabels(
  requests: LabelRequest[],
  obstacles: CircleObstacle[],
  bounds: Rect,
  obstaclePadding = 4,
): Map<string, LabelPlacement> {
  const placements = new Map<string, LabelPlacement>();
  const usedRects: Rect[] = [];
  const obstacleGrid = new SpatialGrid(56);

  obstacleGrid.rebuild(obstacles);

  // Preserve local order so labels look stable frame-to-frame.
  for (const request of requests) {
    const orbit = request.playerRadius + 12;
    let winner: LabelPlacement | null = null;

    for (const angleDeg of CANDIDATE_ANGLES) {
      const angle = (angleDeg * Math.PI) / 180;
      const anchorX = request.playerX + Math.cos(angle) * orbit;
      const anchorY = request.playerY + Math.sin(angle) * orbit;
      const toRight = Math.cos(angle) >= 0;

      const candidateRect: Rect = {
        x: toRight ? anchorX + 6 : anchorX - request.width - 6,
        y: anchorY - request.height / 2,
        width: request.width,
        height: request.height,
      };

      if (!insideBounds(candidateRect, bounds)) {
        continue;
      }

      const obstacleHits = obstacleGrid.queryRect(candidateRect);
      const blockedByPlayer = obstacleHits.some((obstacle) => intersectsCircle(candidateRect, obstacle, obstaclePadding));
      if (blockedByPlayer) {
        continue;
      }

      const blockedByLabel = usedRects.some((usedRect) => intersectsRect(candidateRect, usedRect));
      if (blockedByLabel) {
        continue;
      }

      winner = {
        playerId: request.playerId,
        x: candidateRect.x,
        y: candidateRect.y,
        width: candidateRect.width,
        height: candidateRect.height,
        anchorX,
        anchorY,
        visible: true,
      };
      usedRects.push(candidateRect);
      break;
    }

    placements.set(
      request.playerId,
      winner ?? {
        playerId: request.playerId,
        x: request.playerX + request.playerRadius + 10,
        y: request.playerY - request.height / 2,
        width: request.width,
        height: request.height,
        anchorX: request.playerX,
        anchorY: request.playerY,
        visible: false,
      },
    );
  }

  return placements;
}

