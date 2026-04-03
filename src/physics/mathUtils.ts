import { Delaunay } from 'd3-delaunay';
import { polygonHull } from 'd3-polygon';
import type { TeamSide } from '../data/types';
import type { Rect } from './spatialGrid';

export interface TeamPoint {
  playerId: string;
  team: TeamSide;
  x: number;
  y: number;
}

export interface VoronoiCell<TPoint extends TeamPoint = TeamPoint> {
  point: TPoint;
  polygon: [number, number][];
}

export function getTeamCoordinates<TPoint extends TeamPoint>(points: TPoint[], team: TeamSide): [number, number][] {
  return points.filter((point) => point.team === team).map((point) => [point.x, point.y]);
}

export function computeTeamConvexHull<TPoint extends TeamPoint>(points: TPoint[], team: TeamSide): [number, number][] | null {
  const teamCoordinates = getTeamCoordinates(points, team);
  if (teamCoordinates.length < 3) {
    return null;
  }

  return polygonHull(teamCoordinates) ?? null;
}

export function computeVoronoiCells<TPoint extends TeamPoint>(points: TPoint[], bounds: Rect): VoronoiCell<TPoint>[] {
  if (points.length === 0) {
    return [];
  }

  const delaunay = Delaunay.from(
    points,
    (point) => point.x,
    (point) => point.y,
  );
  const voronoi = delaunay.voronoi([bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height]);
  const cells: VoronoiCell<TPoint>[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const polygon = voronoi.cellPolygon(index);
    if (!polygon) {
      continue;
    }

    const normalizedPolygon = [...polygon]
      .map(([x, y]) => [x, y] as [number, number])
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

    if (normalizedPolygon.length >= 3) {
      cells.push({
        point: points[index],
        polygon: normalizedPolygon,
      });
    }
  }

  return cells;
}

