export interface CircleObstacle {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function keyFor(cellX: number, cellY: number): string {
  return `${cellX}:${cellY}`;
}

export class SpatialGrid {
  private readonly buckets = new Map<string, CircleObstacle[]>();

  constructor(private readonly cellSize: number) {}

  clear(): void {
    this.buckets.clear();
  }

  rebuild(circles: CircleObstacle[]): void {
    this.clear();

    for (const circle of circles) {
      const minX = Math.floor((circle.x - circle.radius) / this.cellSize);
      const maxX = Math.floor((circle.x + circle.radius) / this.cellSize);
      const minY = Math.floor((circle.y - circle.radius) / this.cellSize);
      const maxY = Math.floor((circle.y + circle.radius) / this.cellSize);

      for (let cx = minX; cx <= maxX; cx += 1) {
        for (let cy = minY; cy <= maxY; cy += 1) {
          const key = keyFor(cx, cy);
          const bucket = this.buckets.get(key);
          if (bucket) {
            bucket.push(circle);
          } else {
            this.buckets.set(key, [circle]);
          }
        }
      }
    }
  }

  queryRect(rect: Rect): CircleObstacle[] {
    const minX = Math.floor(rect.x / this.cellSize);
    const maxX = Math.floor((rect.x + rect.width) / this.cellSize);
    const minY = Math.floor(rect.y / this.cellSize);
    const maxY = Math.floor((rect.y + rect.height) / this.cellSize);
    const hits = new Map<string, CircleObstacle>();

    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cy = minY; cy <= maxY; cy += 1) {
        const bucket = this.buckets.get(keyFor(cx, cy));
        if (!bucket) {
          continue;
        }

        for (const obstacle of bucket) {
          hits.set(obstacle.id, obstacle);
        }
      }
    }

    return [...hits.values()];
  }
}

