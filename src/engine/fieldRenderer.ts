import { scaleLinear } from 'd3-scale';
import { createMockPlayers, stepMockPlayers, type MockPlayerState } from '../data/mockTracking';
import type { FieldDimensions } from '../data/types';
import { placeLabels } from '../physics/labelPlacement';
import type { CircleObstacle, Rect } from '../physics/spatialGrid';
import { runtimeBus } from './events';
import { GameLoop } from './gameLoop';
import { measureTextBlock, type TextMeasureResult } from './pretextAdapter';

const FIELD_DIMENSIONS: FieldDimensions = {
  lengthYards: 120,
  widthYards: 53.3,
};

const FONT = '600 13px Inter';
const LINE_HEIGHT = 16;

interface CachedLabel {
  text: string;
  measured: TextMeasureResult;
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
  private readonly players = createMockPlayers(FIELD_DIMENSIONS);
  private frameCounter = 0;
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
    this.resize();
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
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
    stepMockPlayers(this.players, fixedDeltaSeconds, FIELD_DIMENSIONS);
    this.frameCounter += 1;
  };

  private render = (): void => {
    const ctx = this.context;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const fieldRect: Rect = { x: 24, y: 24, width: width - 48, height: height - 48 };

    const xScale = scaleLinear().domain([0, FIELD_DIMENSIONS.lengthYards]).range([fieldRect.x, fieldRect.x + fieldRect.width]);
    const yScale = scaleLinear().domain([0, FIELD_DIMENSIONS.widthYards]).range([fieldRect.y, fieldRect.y + fieldRect.height]);

    const obstacles: CircleObstacle[] = [];
    const labelRequests = [] as {
      playerId: string;
      playerX: number;
      playerY: number;
      playerRadius: number;
      width: number;
      height: number;
    }[];

    for (const player of this.players) {
      const px = xScale(player.location.x);
      const py = yScale(player.location.y);
      const radiusPx = 8;
      const text = `${player.displayName}\n${player.speedMph.toFixed(1)} mph`;
      const measured = measureTextBlock(text, FONT, 136, LINE_HEIGHT);
      this.labels.set(player.playerId, { text, measured });

      obstacles.push({
        id: player.playerId,
        x: px,
        y: py,
        radius: radiusPx,
      });

      labelRequests.push({
        playerId: player.playerId,
        playerX: px,
        playerY: py,
        playerRadius: radiusPx,
        width: measured.width + 12,
        height: measured.height + 8,
      });
    }

    const placements = placeLabels(labelRequests, obstacles, fieldRect, 4);

    ctx.clearRect(0, 0, width, height);
    this.drawField(ctx, fieldRect, xScale);

    for (const player of this.players) {
      this.drawPlayer(ctx, player, xScale, yScale);
      const placement = placements.get(player.playerId);
      const label = this.labels.get(player.playerId);

      if (!placement || !placement.visible || !label) {
        continue;
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

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    player: MockPlayerState,
    xScale: (value: number) => number,
    yScale: (value: number) => number,
  ): void {
    const x = xScale(player.location.x);
    const y = yScale(player.location.y);

    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = player.team === 'home' ? '#4fb3ff' : '#ff7f8b';
    ctx.fill();
    ctx.strokeStyle = '#0b1020';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

