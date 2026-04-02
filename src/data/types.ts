export type TeamSide = 'home' | 'away';

export interface Vector2 {
  x: number;
  y: number;
}

export interface TrackingMeta {
  gameId: string;
  playId: string;
  frameId: number;
  timestampMs: number;
}

export interface PlayerTrackingSample {
  playerId: string;
  displayName: string;
  team: TeamSide;
  jersey: number;
  position: string;
  location: Vector2;
  velocity: Vector2;
  speedMph: number;
}

export interface TrackingFrame {
  meta: TrackingMeta;
  players: PlayerTrackingSample[];
}

export interface FieldDimensions {
  lengthYards: number;
  widthYards: number;
}

export interface DataSourceConfig {
  provider: 'nflfastR' | 'cfbfastR' | 'nextGenStats' | 'mock';
  endpoint: string;
  apiKey?: string;
}

