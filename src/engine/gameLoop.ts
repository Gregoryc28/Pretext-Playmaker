export interface GameLoopCallbacks {
  update: (fixedDeltaSeconds: number) => void;
  render: (timeSeconds: number, alpha: number) => void;
}

export class GameLoop {
  private readonly fixedStep: number;
  private readonly callbacks: GameLoopCallbacks;
  private frameHandle: number | null = null;
  private lastTimeMs = 0;
  private accumulator = 0;

  constructor(targetHz: number, callbacks: GameLoopCallbacks) {
    this.fixedStep = 1 / targetHz;
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.frameHandle !== null) {
      return;
    }

    this.lastTimeMs = performance.now();
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private tick = (timeMs: number): void => {
    const deltaSeconds = Math.min(0.1, (timeMs - this.lastTimeMs) / 1000);
    this.lastTimeMs = timeMs;
    this.accumulator += deltaSeconds;

    while (this.accumulator >= this.fixedStep) {
      this.callbacks.update(this.fixedStep);
      this.accumulator -= this.fixedStep;
    }

    this.callbacks.render(timeMs / 1000, this.accumulator / this.fixedStep);
    this.frameHandle = requestAnimationFrame(this.tick);
  };
}

