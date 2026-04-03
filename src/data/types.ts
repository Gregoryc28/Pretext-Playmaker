export type TeamSide = 'home' | 'away';
export type TrackingTeam = TeamSide | 'football';

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

export interface PlayEntitySample {
  entityId: string;
  displayName: string;
  team: TrackingTeam;
  x: number;
  y: number;
  s: number;
  dir: number;
}

export interface PlayFrame {
  frameId: number;
  timestampMs: number;
  entities: PlayEntitySample[];
}

export interface PlayMeta {
  gameId: string;
  playId: string;
  frameRateHz: number;
  source: string;
  description?: string;
}

export type PlayActionEventType = 'pass-thrown' | 'pass-complete' | 'pass-incomplete' | 'tackle' | 'generic';

export type PlayActionEventSource = 'dataset' | 'inferred';

export interface PlayActionEvent {
  id: string;
  type: PlayActionEventType;
  source: PlayActionEventSource;
  timestampMs: number;
  label: string;
  durationMs?: number;
}

export interface PlayData {
  meta: PlayMeta;
  frames: PlayFrame[];
  events?: PlayActionEvent[];
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

