import { scaleLinear } from 'd3-scale';
import { polygonArea, polygonCentroid } from 'd3-polygon';
import { fetchPlayData } from '../data/trackingService';
import type { FieldDimensions, PlayData, PlayEntitySample } from '../data/types';
import { placeLabels } from '../physics/labelPlacement';
import { computeTeamConvexHull, computeVoronoiCells, type TeamPoint } from '../physics/mathUtils';
import type { CircleObstacle, Rect } from '../physics/spatialGrid';
import { runtimeBus } from './events';
import { GameLoop } from './gameLoop';
import { getLoopedPlayTimeSeconds, samplePlayAtTime, type InterpolatedFrame } from './interpolator';
import { measureTextBlock, type TextMeasureResult } from './pretextAdapter';
import { usePlayStore } from '../store/usePlayStore';

const FIELD_DIMENSIONS: FieldDimensions = {
  lengthYards: 120,
  widthYards: 53.3,
};

const FONT = '600 13px Inter';
const LINE_HEIGHT = 16;
const PLAYER_RADIUS_PX = 8;
const FOOTBALL_RADIUS_PX = 5;
const YARDS_PER_SECOND_TO_MPH = 2.045;
const HOVER_DISTANCE_YARDS = 1.25;
const VORONOI_TEXT_LINE_HEIGHT = 13;
const SPOTLIGHT_CLICK_RADIUS_YARDS = 1.8;
const GHOST_TRAIL_DURATION_SECONDS = 1.5;
const GHOST_TRAIL_MIN_SAMPLE_DELTA_SECONDS = 1 / 240;
const PEAK_SPEED_LOCK_EPSILON_YARDS_PER_SECOND = 0.03;

interface ProjectedPlayer extends TeamPoint {
  player: PlayEntitySample;
  velocityPxX: number;
  velocityPxY: number;
}

interface CachedLabel {
  text: string;
  measured: TextMeasureResult;
}

interface ActiveFootballEvent {
  id: string;
  text: string;
  expiresAtMs: number;
}

interface SpotlightMatchup {
  offensive: PlayEntitySample;
  defensive: PlayEntitySample;
  separationYards: number;
}

interface TrailSample {
  playTimeSeconds: number;
  x: number;
  y: number;
}

interface PeakVelocityMarker {
  x: number;
  y: number;
  speedMph: number;
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export class FieldRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly loop: GameLoop;
  private readonly labels = new Map<string, CachedLabel>();
  private playData: PlayData | null = null;
  private currentFrame: InterpolatedFrame | null = null;
  private playTimeSeconds = 0;
  private playDurationSeconds = 0;
  private hoveredPlayerId: string | null = null;
  private mousePositionPx: { x: number; y: number } | null = null;
  private readonly lastSpeedByPlayer = new Map<string, number>();
  private readonly accelerationByPlayer = new Map<string, number>();
  private readonly trailHistoryByPlayer = new Map<string, TrailSample[]>();
  private readonly peakSpeedTargetByPlayer = new Map<string, number>();
  private readonly peakVelocityMarkerByPlayer = new Map<string, PeakVelocityMarker>();
  private readonly activeFootballEvents: ActiveFootballEvent[] = [];
  private spotlightPlayerId: string | null = null;
  private spotlightDefenderId: string | null = null;
  private fpsFrameCount = 0;
  private fpsWindowStart = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to create 2D context');
    }

    this.canvas = canvas;
    this.context = context;
    this.loop = new GameLoop(120, {
      update: this.update,
      render: this.render,
    });
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
    this.canvas.addEventListener('click', this.handleCanvasClick);
    void this.loadPlayData();
    this.resize();
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  destroy(): void {
    this.stop();
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    this.canvas.removeEventListener('click', this.handleCanvasClick);
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(640, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(360, Math.floor(this.canvas.clientHeight * dpr));

    this.canvas.width = width;
    this.canvas.height = height;
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.scale(dpr, dpr);
  }

  private update = (fixedDeltaSeconds: number): void => {
    if (!this.playData) {
      return;
    }

    const { isPlaying, playTimeSeconds: storeTimeSeconds } = usePlayStore.getState();

    const previousPlayTimeSeconds = this.playTimeSeconds;

    if (isPlaying) {
      this.playTimeSeconds = getLoopedPlayTimeSeconds(this.playData, this.playTimeSeconds + fixedDeltaSeconds);
      usePlayStore.setState({ playTimeSeconds: this.playTimeSeconds });
    } else {
      this.playTimeSeconds = Math.max(0, Math.min(storeTimeSeconds, this.playDurationSeconds));
    }

    this.triggerCrossedPlayEvents(previousPlayTimeSeconds, this.playTimeSeconds);
    this.pruneExpiredFootballEvents();
    this.currentFrame = samplePlayAtTime(this.playData, this.playTimeSeconds);

    const didSeekOrWrap = this.didPlaybackJump(previousPlayTimeSeconds, this.playTimeSeconds, isPlaying);
    if (didSeekOrWrap) {
      this.clearTrailHistory();
    }

    if (this.currentFrame) {
      this.updateTrails(this.currentFrame, this.playTimeSeconds);
      this.updatePeakVelocityMarkers(this.currentFrame);
    }

    this.updateDerivedMotionMetrics(this.currentFrame, fixedDeltaSeconds);
    this.updateHoveredPlayer(this.currentFrame);
    this.updateSpotlightDefender(this.currentFrame);
    this.publishSpotlightMatchup(this.currentFrame);
  };

  private handleMouseMove = (event: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.mousePositionPx = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  private handleMouseLeave = (): void => {
    this.mousePositionPx = null;
    this.hoveredPlayerId = null;
  };

  private handleCanvasClick = (event: MouseEvent): void => {
    const frame = this.currentFrame;
    if (!frame) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const mousePxX = event.clientX - rect.left;
    const mousePxY = event.clientY - rect.top;
    const { xScale, yScale } = this.getFieldLayout();
    const mouseFieldX = xScale.invert(mousePxX);
    const mouseFieldY = yScale.invert(mousePxY);

    let selectedOffensive: PlayEntitySample | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const entity of frame.entities) {
      if (!this.isOffensivePlayer(entity)) {
        continue;
      }

      const distanceYards = Math.hypot(entity.x - mouseFieldX, entity.y - mouseFieldY);
      if (distanceYards <= SPOTLIGHT_CLICK_RADIUS_YARDS && distanceYards < bestDistance) {
        selectedOffensive = entity;
        bestDistance = distanceYards;
      }
    }

    if (!selectedOffensive) {
      this.spotlightPlayerId = null;
      this.spotlightDefenderId = null;
      usePlayStore.getState().setSpotlightMatchup(null);
      return;
    }

    if (this.spotlightPlayerId === selectedOffensive.entityId) {
      this.spotlightPlayerId = null;
      this.spotlightDefenderId = null;
      usePlayStore.getState().setSpotlightMatchup(null);
      return;
    }

    this.spotlightPlayerId = selectedOffensive.entityId;
  };

  private updateDerivedMotionMetrics(frame: InterpolatedFrame, fixedDeltaSeconds: number): void {
    for (const entity of frame.entities) {
      if (entity.team === 'football') {
        continue;
      }

      const previousSpeed = this.lastSpeedByPlayer.get(entity.entityId) ?? entity.s;
      const accelYardsPerSecondSq = fixedDeltaSeconds > 0 ? (entity.s - previousSpeed) / fixedDeltaSeconds : 0;
      this.accelerationByPlayer.set(entity.entityId, accelYardsPerSecondSq * YARDS_PER_SECOND_TO_MPH);
      this.lastSpeedByPlayer.set(entity.entityId, entity.s);
    }
  }

  private updateHoveredPlayer(frame: InterpolatedFrame): void {
    const mouse = this.mousePositionPx;
    if (!mouse) {
      this.hoveredPlayerId = null;
      return;
    }

    const { xScale, yScale } = this.getFieldLayout();
    const mouseFieldX = xScale.invert(mouse.x);
    const mouseFieldY = yScale.invert(mouse.y);

    let bestPlayerId: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const entity of frame.entities) {
      if (entity.team === 'football') {
        continue;
      }

      const distanceYards = Math.hypot(entity.x - mouseFieldX, entity.y - mouseFieldY);
      if (distanceYards <= HOVER_DISTANCE_YARDS && distanceYards < bestDistance) {
        bestDistance = distanceYards;
        bestPlayerId = entity.entityId;
      }
    }

    this.hoveredPlayerId = bestPlayerId;
  }

  private updateSpotlightDefender(frame: InterpolatedFrame): void {
    if (!this.spotlightPlayerId) {
      this.spotlightDefenderId = null;
      return;
    }

    const offensive = frame.entities.find((entity) => entity.entityId === this.spotlightPlayerId && this.isOffensivePlayer(entity));
    if (!offensive) {
      this.spotlightPlayerId = null;
      this.spotlightDefenderId = null;
      return;
    }

    const defensive = this.findNearestDefender(frame, offensive);
    this.spotlightDefenderId = defensive?.entityId ?? null;
  }

  private publishSpotlightMatchup(frame: InterpolatedFrame): void {
    const matchup = this.getSpotlightMatchup(frame);
    const { spotlightMatchup } = usePlayStore.getState();

    if (!matchup) {
      if (spotlightMatchup) {
        usePlayStore.getState().setSpotlightMatchup(null);
      }
      return;
    }

    const nextSeparation = Number(matchup.separationYards.toFixed(1));
    if (
      spotlightMatchup &&
      spotlightMatchup.offensivePlayerId === matchup.offensive.entityId &&
      spotlightMatchup.defensivePlayerId === matchup.defensive.entityId &&
      spotlightMatchup.separationYards === nextSeparation
    ) {
      return;
    }

    usePlayStore.getState().setSpotlightMatchup({
      offensivePlayerId: matchup.offensive.entityId,
      defensivePlayerId: matchup.defensive.entityId,
      separationYards: nextSeparation,
    });
  }

  private render = (): void => {
    const ctx = this.context;
    const { width, height, fieldRect, xScale, yScale } = this.getFieldLayout();

    ctx.clearRect(0, 0, width, height);
    this.drawField(ctx, fieldRect, xScale);

    const frame = this.currentFrame;
    if (!frame) {
      ctx.fillStyle = '#e8f0ff';
      ctx.font = '600 16px Inter';
      ctx.fillText('Loading play data...', fieldRect.x + 16, fieldRect.y + 28);
      return;
    }

    const projectedPlayers: ProjectedPlayer[] = [];
    const footballs: Array<{ entity: PlayEntitySample; x: number; y: number }> = [];
    const footballEntity = frame.entities.find((entity) => entity.team === 'football') ?? null;
    const spotlightMatchup = this.getSpotlightMatchup(frame);
    const obstacles: CircleObstacle[] = [];
    const labelRequests = [] as {
      playerId: string;
      playerX: number;
      playerY: number;
      playerRadius: number;
      width: number;
      height: number;
    }[];

    for (const player of frame.entities) {
      const px = xScale(player.x);
      const py = yScale(player.y);

      if (player.team === 'football') {
        footballs.push({ entity: player, x: px, y: py });
        continue;
      }

      const headingRadians = (player.dir * Math.PI) / 180;
      const velocityYardsX = player.s * Math.sin(headingRadians);
      const velocityYardsY = player.s * Math.cos(headingRadians);
      const projectedPx = xScale(player.x + velocityYardsX);
      const projectedPy = yScale(player.y + velocityYardsY);
      const isHoveredPlayer = this.hoveredPlayerId === player.entityId;
      const text = isHoveredPlayer
        ? this.buildHoveredLabelText(player, footballEntity)
        : `${player.displayName}\n${(player.s * YARDS_PER_SECOND_TO_MPH).toFixed(1)} mph`;
      const measured = measureTextBlock(text, FONT, isHoveredPlayer ? 220 : 136, LINE_HEIGHT);
      this.labels.set(player.entityId, { text, measured });

      projectedPlayers.push({
        player,
        playerId: player.entityId,
        team: player.team,
        x: px,
        y: py,
        velocityPxX: projectedPx - px,
        velocityPxY: projectedPy - py,
      });

      obstacles.push({
        id: player.entityId,
        x: px,
        y: py,
        radius: PLAYER_RADIUS_PX,
      });

      labelRequests.push({
        playerId: player.entityId,
        playerX: px,
        playerY: py,
        playerRadius: PLAYER_RADIUS_PX,
        width: measured.width + 12,
        height: measured.height + 8,
      });
    }

    const placements = placeLabels(labelRequests, obstacles, fieldRect, 4);

    this.drawPitchControl(ctx, projectedPlayers, fieldRect, xScale, yScale);
    this.drawDefensiveShell(ctx, projectedPlayers);
    this.drawGhostTrails(ctx, frame, xScale, yScale, spotlightMatchup);

    if (spotlightMatchup) {
      ctx.fillStyle = 'rgba(8, 16, 37, 0.2)';
      ctx.fillRect(fieldRect.x, fieldRect.y, fieldRect.width, fieldRect.height);
    }

    for (const projectedPlayer of projectedPlayers) {
      const isSpotlightPair =
        spotlightMatchup &&
        (projectedPlayer.player.entityId === spotlightMatchup.offensive.entityId || projectedPlayer.player.entityId === spotlightMatchup.defensive.entityId);
      this.drawEntity(ctx, projectedPlayer.player, projectedPlayer.x, projectedPlayer.y, isSpotlightPair ? 1 : spotlightMatchup ? 0.35 : 1, Boolean(isSpotlightPair));
    }

    for (const football of footballs) {
      this.drawEntity(ctx, football.entity, football.x, football.y, spotlightMatchup ? 0.65 : 1);
    }

    const footballAnchor = footballs[0];
    if (footballAnchor) {
      this.drawActiveFootballEvents(ctx, footballAnchor.x, footballAnchor.y);
    }

    if (spotlightMatchup) {
      this.drawSpotlightTether(ctx, spotlightMatchup, xScale, yScale);
    }

    for (const projectedPlayer of projectedPlayers) {
      const isSpotlightPair =
        spotlightMatchup &&
        (projectedPlayer.player.entityId === spotlightMatchup.offensive.entityId || projectedPlayer.player.entityId === spotlightMatchup.defensive.entityId);
      this.drawVelocityVector(ctx, projectedPlayer, isSpotlightPair ? 1 : spotlightMatchup ? 0.25 : 1);
    }

    this.drawPeakVelocityMarkers(ctx, frame, xScale, yScale, spotlightMatchup);

    for (const projectedPlayer of projectedPlayers) {
      const player = projectedPlayer.player;
      const placement = placements.get(player.entityId);
      const label = this.labels.get(player.entityId);

      if (!placement || !placement.visible || !label) {
        continue;
      }

      const isSpotlightLabel =
        spotlightMatchup &&
        (player.entityId === spotlightMatchup.offensive.entityId || player.entityId === spotlightMatchup.defensive.entityId);

      ctx.save();
      if (spotlightMatchup && !isSpotlightLabel) {
        ctx.globalAlpha = 0.35;
      }

      ctx.strokeStyle = 'rgba(219, 233, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(placement.anchorX, placement.anchorY);
      ctx.lineTo(placement.x, placement.y + placement.height / 2);
      ctx.stroke();

      drawRoundedRect(ctx, placement.x, placement.y, placement.width, placement.height, 6);
      ctx.fillStyle = 'rgba(8, 16, 37, 0.87)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(148, 188, 255, 0.45)';
      ctx.stroke();

      ctx.font = FONT;
      ctx.fillStyle = '#e8f0ff';
      let lineY = placement.y + 16;
      for (const line of label.measured.lines) {
        ctx.fillText(line.text, placement.x + 6, lineY);
        lineY += LINE_HEIGHT;
      }

      ctx.restore();
    }

    this.fpsFrameCount += 1;
    const now = performance.now();
    if (now - this.fpsWindowStart >= 500) {
      const fps = (this.fpsFrameCount / (now - this.fpsWindowStart)) * 1000;
      runtimeBus.emit('fps', { fps });
      this.fpsWindowStart = now;
      this.fpsFrameCount = 0;
    }
  };

  private drawField(ctx: CanvasRenderingContext2D, fieldRect: Rect, xScale: (value: number) => number): void {
    ctx.fillStyle = '#1d7f48';
    ctx.fillRect(fieldRect.x, fieldRect.y, fieldRect.width, fieldRect.height);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(fieldRect.x, fieldRect.y, fieldRect.width, fieldRect.height);

    ctx.lineWidth = 1;
    for (let yards = 10; yards <= 110; yards += 10) {
      const x = xScale(yards);
      ctx.beginPath();
      ctx.moveTo(x, fieldRect.y);
      ctx.lineTo(x, fieldRect.y + fieldRect.height);
      ctx.stroke();
    }

    const midfieldX = xScale(60);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(midfieldX, fieldRect.y);
    ctx.lineTo(midfieldX, fieldRect.y + fieldRect.height);
    ctx.stroke();
  }

  private getFieldLayout(): {
    width: number;
    height: number;
    fieldRect: Rect;
    xScale: ReturnType<typeof scaleLinear<number, number>>;
    yScale: ReturnType<typeof scaleLinear<number, number>>;
  } {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const fieldRect: Rect = { x: 24, y: 24, width: width - 48, height: height - 48 };
    const xScale = scaleLinear<number, number>().domain([0, FIELD_DIMENSIONS.lengthYards]).range([fieldRect.x, fieldRect.x + fieldRect.width]);
    const yScale = scaleLinear<number, number>().domain([0, FIELD_DIMENSIONS.widthYards]).range([fieldRect.y, fieldRect.y + fieldRect.height]);
    return { width, height, fieldRect, xScale, yScale };
  }

  private buildHoveredLabelText(player: PlayEntitySample, footballEntity: PlayEntitySample | null): string {
    const speedMph = player.s * YARDS_PER_SECOND_TO_MPH;
    const accelerationMphPerSecond = this.accelerationByPlayer.get(player.entityId) ?? 0;
    const distanceToFootballYards = footballEntity ? Math.hypot(player.x - footballEntity.x, player.y - footballEntity.y) : 0;
    const routeType = this.classifyRouteType(player.dir, player.s);
    const expectedPoints = ((player.x - 60) / 20 + 1.8).toFixed(2);

    return [
      player.displayName,
      `Speed: ${speedMph.toFixed(1)} mph`,
      `Acceleration: ${accelerationMphPerSecond.toFixed(2)} mph/s`,
      `Distance to Football: ${distanceToFootballYards.toFixed(1)} yds`,
      `Route Type: ${routeType}`,
      `Expected Points: ${expectedPoints}`,
    ].join('\n');
  }

  private classifyRouteType(directionDegrees: number, speedYardsPerSecond: number): string {
    if (speedYardsPerSecond < 0.8) {
      return 'Settle';
    }

    const normalized = ((directionDegrees % 360) + 360) % 360;
    if (normalized < 45 || normalized >= 315) {
      return 'Go';
    }

    if (normalized < 135) {
      return 'Out';
    }

    if (normalized < 225) {
      return 'Comeback';
    }

    return 'In';
  }

  private isOffensivePlayer(entity: PlayEntitySample): boolean {
    return entity.team === 'home';
  }

  private isDefensivePlayer(entity: PlayEntitySample): boolean {
    return entity.team === 'away';
  }

  private findNearestDefender(frame: InterpolatedFrame, offensive: PlayEntitySample): PlayEntitySample | null {
    let bestDefender: PlayEntitySample | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const entity of frame.entities) {
      if (!this.isDefensivePlayer(entity)) {
        continue;
      }

      const distanceYards = Math.hypot(entity.x - offensive.x, entity.y - offensive.y);
      if (distanceYards < bestDistance) {
        bestDistance = distanceYards;
        bestDefender = entity;
      }
    }

    return bestDefender;
  }

  private getSpotlightMatchup(frame: InterpolatedFrame): SpotlightMatchup | null {
    if (!this.spotlightPlayerId || !this.spotlightDefenderId) {
      return null;
    }

    const offensive = frame.entities.find((entity) => entity.entityId === this.spotlightPlayerId && this.isOffensivePlayer(entity));
    const defensive = frame.entities.find((entity) => entity.entityId === this.spotlightDefenderId && this.isDefensivePlayer(entity));
    if (!offensive || !defensive) {
      return null;
    }

    return {
      offensive,
      defensive,
      separationYards: Math.hypot(offensive.x - defensive.x, offensive.y - defensive.y),
    };
  }

  private drawSpotlightTether(
    ctx: CanvasRenderingContext2D,
    matchup: SpotlightMatchup,
    xScale: ReturnType<typeof scaleLinear<number, number>>,
    yScale: ReturnType<typeof scaleLinear<number, number>>,
  ): void {
    const startX = xScale(matchup.offensive.x);
    const startY = yScale(matchup.offensive.y);
    const endX = xScale(matchup.defensive.x);
    const endY = yScale(matchup.defensive.y);
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(123, 201, 255, 0.9)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(146, 214, 255, 0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.restore();

    const separationLabel = `${matchup.separationYards.toFixed(1)} yds`;
    const measured = measureTextBlock(separationLabel, '700 12px Inter', 120, 14);
    const boxWidth = measured.width + 14;
    const boxHeight = measured.height + 8;
    const boxX = midX - boxWidth / 2;
    const boxY = midY - boxHeight / 2;

    drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 6);
    ctx.fillStyle = 'rgba(10, 24, 52, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(140, 206, 255, 0.95)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = '700 12px Inter';
    ctx.fillStyle = '#e8f0ff';
    ctx.fillText(separationLabel, boxX + 7, boxY + 14);
  }

  private triggerCrossedPlayEvents(previousTimeSeconds: number, currentTimeSeconds: number): void {
    if (!this.playData || !this.playData.events || this.playData.events.length === 0) {
      return;
    }

    const durationMs = this.playDurationSeconds * 1000;
    const previousTimeMs = previousTimeSeconds * 1000;
    const currentTimeMs = currentTimeSeconds * 1000;
    for (const event of this.playData.events) {
      if (!this.didCrossTimestamp(previousTimeMs, currentTimeMs, event.timestampMs, durationMs)) {
        continue;
      }

      const now = performance.now();
      const existing = this.activeFootballEvents.find((activeEvent) => activeEvent.id === event.id);
      if (existing) {
        existing.expiresAtMs = now + (event.durationMs ?? 1500);
        existing.text = event.label;
        continue;
      }

      this.activeFootballEvents.push({
        id: event.id,
        text: event.label,
        expiresAtMs: now + (event.durationMs ?? 1500),
      });
    }
  }

  private didCrossTimestamp(previousMs: number, currentMs: number, targetMs: number, durationMs: number): boolean {
    if (durationMs <= 0) {
      return currentMs >= targetMs && previousMs < targetMs;
    }

    const normalizedTarget = ((targetMs % durationMs) + durationMs) % durationMs;
    const normalizedPrevious = ((previousMs % durationMs) + durationMs) % durationMs;
    const normalizedCurrent = ((currentMs % durationMs) + durationMs) % durationMs;

    if (normalizedPrevious <= normalizedCurrent) {
      return normalizedTarget > normalizedPrevious && normalizedTarget <= normalizedCurrent;
    }

    return normalizedTarget > normalizedPrevious || normalizedTarget <= normalizedCurrent;
  }

  private pruneExpiredFootballEvents(): void {
    const now = performance.now();
    for (let index = this.activeFootballEvents.length - 1; index >= 0; index -= 1) {
      if (this.activeFootballEvents[index].expiresAtMs <= now) {
        this.activeFootballEvents.splice(index, 1);
      }
    }
  }

  private drawActiveFootballEvents(ctx: CanvasRenderingContext2D, footballX: number, footballY: number): void {
    for (let index = 0; index < this.activeFootballEvents.length; index += 1) {
      const event = this.activeFootballEvents[index];
      const measured = measureTextBlock(event.text, '600 12px Inter', 200, 14);
      const boxWidth = measured.width + 12;
      const boxHeight = measured.height + 8;
      const boxX = footballX + 14;
      const boxY = footballY - boxHeight - 10 - index * (boxHeight + 6);

      drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 6);
      ctx.fillStyle = 'rgba(14, 24, 54, 0.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(110, 176, 255, 0.65)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = '600 12px Inter';
      ctx.fillStyle = '#e8f0ff';
      let lineY = boxY + 14;
      for (const line of measured.lines) {
        ctx.fillText(line.text, boxX + 6, lineY);
        lineY += 14;
      }
    }
  }

  private drawPitchControl(
    ctx: CanvasRenderingContext2D,
    players: ProjectedPlayer[],
    fieldRect: Rect,
    xScale: ReturnType<typeof scaleLinear<number, number>>,
    yScale: ReturnType<typeof scaleLinear<number, number>>,
  ): void {
    const cells = computeVoronoiCells(players, fieldRect);

    for (const cell of cells) {
      if (cell.polygon.length < 3) {
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(cell.polygon[0][0], cell.polygon[0][1]);
      for (let pointIndex = 1; pointIndex < cell.polygon.length; pointIndex += 1) {
        ctx.lineTo(cell.polygon[pointIndex][0], cell.polygon[pointIndex][1]);
      }
      ctx.closePath();
      ctx.fillStyle = cell.point.team === 'home' ? 'rgba(79, 179, 255, 0.08)' : 'rgba(255, 127, 139, 0.08)';
      ctx.fill();
      ctx.strokeStyle = cell.point.team === 'home' ? 'rgba(79, 179, 255, 0.14)' : 'rgba(255, 127, 139, 0.14)';
      ctx.lineWidth = 1;
      ctx.stroke();

      this.drawVoronoiCellTypography(ctx, cell.polygon, xScale, yScale);
    }
  }

  private drawVoronoiCellTypography(
    ctx: CanvasRenderingContext2D,
    polygon: [number, number][],
    xScale: ReturnType<typeof scaleLinear<number, number>>,
    yScale: ReturnType<typeof scaleLinear<number, number>>,
  ): void {
    const centroid = polygonCentroid(polygon);
    if (!Number.isFinite(centroid[0]) || !Number.isFinite(centroid[1])) {
      return;
    }

    const polygonInYards = polygon.map(([x, y]) => [xScale.invert(x), yScale.invert(y)] as [number, number]);
    const cellAreaSquareYards = Math.abs(polygonArea(polygonInYards));
    if (cellAreaSquareYards < 8) {
      return;
    }

    const label = `Open Space\n${cellAreaSquareYards.toFixed(1)} sq yds`;
    const fontSize = Math.max(10, Math.min(14, 10 + cellAreaSquareYards * 0.07));
    const textBlock = measureTextBlock(label, `600 ${fontSize}px Inter`, 96, VORONOI_TEXT_LINE_HEIGHT);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(polygon[0][0], polygon[0][1]);
    for (let pointIndex = 1; pointIndex < polygon.length; pointIndex += 1) {
      ctx.lineTo(polygon[pointIndex][0], polygon[pointIndex][1]);
    }
    ctx.closePath();
    ctx.clip();

    const textX = centroid[0] - textBlock.width / 2;
    const textY = centroid[1] - textBlock.height / 2;
    ctx.font = `600 ${fontSize}px Inter`;
    ctx.fillStyle = 'rgba(235, 244, 255, 0.9)';
    let lineY = textY + VORONOI_TEXT_LINE_HEIGHT;
    for (const line of textBlock.lines) {
      const lineX = textX + (textBlock.width - line.width) / 2;
      ctx.fillText(line.text, lineX, lineY);
      lineY += VORONOI_TEXT_LINE_HEIGHT;
    }
    ctx.restore();
  }

  private drawDefensiveShell(ctx: CanvasRenderingContext2D, players: ProjectedPlayer[]): void {
    const hull = computeTeamConvexHull(players, 'away');
    if (!hull || hull.length < 3) {
      return;
    }

    ctx.beginPath();
    ctx.moveTo(hull[0][0], hull[0][1]);
    for (let index = 1; index < hull.length; index += 1) {
      ctx.lineTo(hull[index][0], hull[index][1]);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 70, 88, 0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 97, 114, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private drawGhostTrails(
    ctx: CanvasRenderingContext2D,
    frame: InterpolatedFrame,
    xScale: ReturnType<typeof scaleLinear<number, number>>,
    yScale: ReturnType<typeof scaleLinear<number, number>>,
    spotlightMatchup: SpotlightMatchup | null,
  ): void {
    const now = this.playTimeSeconds;

    for (const entity of frame.entities) {
      if (entity.team === 'football') {
        continue;
      }

      const samples = this.trailHistoryByPlayer.get(entity.entityId);
      if (!samples || samples.length < 2) {
        continue;
      }

      const inSpotlight =
        spotlightMatchup && (entity.entityId === spotlightMatchup.offensive.entityId || entity.entityId === spotlightMatchup.defensive.entityId);
      const dimFactor = spotlightMatchup && !inSpotlight ? 0.3 : 1;
      const trailColor = entity.team === 'home' ? '112, 194, 255' : '255, 163, 172';

      for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1];
        const current = samples[index];
        const age = Math.max(0, now - current.playTimeSeconds);
        const normalizedAge = Math.max(0, 1 - age / GHOST_TRAIL_DURATION_SECONDS);
        const alpha = normalizedAge * 0.45 * dimFactor;
        if (alpha < 0.02) {
          continue;
        }

        ctx.beginPath();
        ctx.moveTo(xScale(previous.x), yScale(previous.y));
        ctx.lineTo(xScale(current.x), yScale(current.y));
        ctx.strokeStyle = `rgba(${trailColor}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  private drawPeakVelocityMarkers(
    ctx: CanvasRenderingContext2D,
    frame: InterpolatedFrame,
    xScale: ReturnType<typeof scaleLinear<number, number>>,
    yScale: ReturnType<typeof scaleLinear<number, number>>,
    spotlightMatchup: SpotlightMatchup | null,
  ): void {
    for (const entity of frame.entities) {
      if (entity.team === 'football') {
        continue;
      }

      const marker = this.peakVelocityMarkerByPlayer.get(entity.entityId);
      if (!marker) {
        continue;
      }

      const inSpotlight =
        spotlightMatchup && (entity.entityId === spotlightMatchup.offensive.entityId || entity.entityId === spotlightMatchup.defensive.entityId);

      ctx.save();
      if (spotlightMatchup && !inSpotlight) {
        ctx.globalAlpha = 0.35;
      }

      const pinX = xScale(marker.x);
      const pinY = yScale(marker.y);
      const pinColor = entity.team === 'home' ? 'rgba(132, 209, 255, 0.95)' : 'rgba(255, 171, 181, 0.95)';

      ctx.beginPath();
      ctx.arc(pinX, pinY, 3, 0, Math.PI * 2);
      ctx.fillStyle = pinColor;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(pinX, pinY - 2);
      ctx.lineTo(pinX, pinY - 18);
      ctx.strokeStyle = pinColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const text = `Max: ${marker.speedMph.toFixed(1)} mph`;
      const measured = measureTextBlock(text, '700 11px Inter', 132, 13);
      const boxWidth = measured.width + 10;
      const boxHeight = measured.height + 6;
      const boxX = pinX - boxWidth / 2;
      const boxY = pinY - 22 - boxHeight;

      drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 5);
      ctx.fillStyle = 'rgba(8, 16, 37, 0.9)';
      ctx.fill();
      ctx.strokeStyle = pinColor;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = '700 11px Inter';
      ctx.fillStyle = '#e8f0ff';
      let lineY = boxY + 12;
      for (const line of measured.lines) {
        ctx.fillText(line.text, boxX + 5, lineY);
        lineY += 13;
      }

      ctx.restore();
    }
  }

  private drawEntity(
    ctx: CanvasRenderingContext2D,
    entity: PlayEntitySample,
    x: number,
    y: number,
    opacity: number = 1,
    highlight: boolean = false,
  ): void {
    const radius = entity.team === 'football' ? FOOTBALL_RADIUS_PX : PLAYER_RADIUS_PX;
    const fillStyle = entity.team === 'home' ? '#4fb3ff' : entity.team === 'away' ? '#ff7f8b' : '#b4844d';

    ctx.save();
    ctx.globalAlpha = opacity;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.strokeStyle = '#0b1020';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (highlight && entity.team !== 'football') {
      ctx.beginPath();
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(173, 226, 255, 0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawVelocityVector(ctx: CanvasRenderingContext2D, projectedPlayer: ProjectedPlayer, opacity: number = 1): void {
    const startX = projectedPlayer.x;
    const startY = projectedPlayer.y;
    const endX = projectedPlayer.x + projectedPlayer.velocityPxX;
    const endY = projectedPlayer.y + projectedPlayer.velocityPxY;
    const vectorLength = Math.hypot(projectedPlayer.velocityPxX, projectedPlayer.velocityPxY);

    if (vectorLength < 1) {
      return;
    }

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = projectedPlayer.team === 'home' ? 'rgba(180, 224, 255, 0.85)' : 'rgba(255, 210, 215, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    const arrowSize = Math.max(5, Math.min(8, vectorLength * 0.2));
    const angle = Math.atan2(projectedPlayer.velocityPxY, projectedPlayer.velocityPxX);

    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - arrowSize * Math.cos(angle - Math.PI / 7), endY - arrowSize * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(endX - arrowSize * Math.cos(angle + Math.PI / 7), endY - arrowSize * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fillStyle = projectedPlayer.team === 'home' ? 'rgba(180, 224, 255, 0.9)' : 'rgba(255, 210, 215, 0.9)';
    ctx.fill();
    ctx.restore();
  }

  private didPlaybackJump(previousTimeSeconds: number, currentTimeSeconds: number, isPlaying: boolean): boolean {
    if (isPlaying) {
      return currentTimeSeconds < previousTimeSeconds;
    }

    return Math.abs(currentTimeSeconds - previousTimeSeconds) > GHOST_TRAIL_MIN_SAMPLE_DELTA_SECONDS;
  }

  private updateTrails(frame: InterpolatedFrame, playTimeSeconds: number): void {
    const activePlayerIds = new Set<string>();

    for (const entity of frame.entities) {
      if (entity.team === 'football') {
        continue;
      }

      activePlayerIds.add(entity.entityId);
      const samples = this.trailHistoryByPlayer.get(entity.entityId) ?? [];
      const lastSample = samples[samples.length - 1];

      if (!lastSample || Math.abs(playTimeSeconds - lastSample.playTimeSeconds) > GHOST_TRAIL_MIN_SAMPLE_DELTA_SECONDS) {
        samples.push({ playTimeSeconds, x: entity.x, y: entity.y });
      }

      const minimumTime = playTimeSeconds - GHOST_TRAIL_DURATION_SECONDS;
      while (samples.length > 0 && samples[0].playTimeSeconds < minimumTime) {
        samples.shift();
      }

      this.trailHistoryByPlayer.set(entity.entityId, samples);
    }

    for (const playerId of this.trailHistoryByPlayer.keys()) {
      if (!activePlayerIds.has(playerId)) {
        this.trailHistoryByPlayer.delete(playerId);
      }
    }
  }

  private clearTrailHistory(): void {
    this.trailHistoryByPlayer.clear();
  }

  private updatePeakVelocityMarkers(frame: InterpolatedFrame): void {
    for (const entity of frame.entities) {
      if (entity.team === 'football') {
        continue;
      }

      if (this.peakVelocityMarkerByPlayer.has(entity.entityId)) {
        continue;
      }

      const targetPeakSpeed = this.peakSpeedTargetByPlayer.get(entity.entityId);
      if (targetPeakSpeed === undefined) {
        continue;
      }

      if (entity.s + PEAK_SPEED_LOCK_EPSILON_YARDS_PER_SECOND >= targetPeakSpeed) {
        this.peakVelocityMarkerByPlayer.set(entity.entityId, {
          x: entity.x,
          y: entity.y,
          speedMph: entity.s * YARDS_PER_SECOND_TO_MPH,
        });
      }
    }
  }

  private buildPeakSpeedTargets(playData: PlayData): void {
    this.peakSpeedTargetByPlayer.clear();

    for (const frame of playData.frames) {
      for (const entity of frame.entities) {
        if (entity.team === 'football') {
          continue;
        }

        const currentPeak = this.peakSpeedTargetByPlayer.get(entity.entityId) ?? Number.NEGATIVE_INFINITY;
        if (entity.s > currentPeak) {
          this.peakSpeedTargetByPlayer.set(entity.entityId, entity.s);
        }
      }
    }
  }

  private async loadPlayData(): Promise<void> {
    try {
      this.playData = await fetchPlayData();
      const firstTimestamp = this.playData.frames[0].timestampMs;
      const lastTimestamp = this.playData.frames[this.playData.frames.length - 1].timestampMs;
      this.playDurationSeconds = Math.max(0, (lastTimestamp - firstTimestamp) / 1000);
      this.playTimeSeconds = 0;

      usePlayStore.getState().setPlayDuration(this.playDurationSeconds);
      usePlayStore.getState().setPlayMeta(this.playData.meta);
      usePlayStore.setState({ playTimeSeconds: 0 });
      usePlayStore.getState().setSpotlightMatchup(null);
      this.activeFootballEvents.length = 0;
      this.spotlightPlayerId = null;
      this.spotlightDefenderId = null;
      this.clearTrailHistory();
      this.peakVelocityMarkerByPlayer.clear();
      this.buildPeakSpeedTargets(this.playData);

      this.currentFrame = samplePlayAtTime(this.playData, 0);
      if (this.currentFrame) {
        this.updateTrails(this.currentFrame, 0);
        this.updatePeakVelocityMarkers(this.currentFrame);
      }
    } catch (error) {
      console.error('Failed to load sample play data.', error);
    }
  }
}

