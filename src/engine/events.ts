import { EventBus } from './eventBus';

export interface RuntimeEvents {
  fps: { fps: number };
}

export const runtimeBus = new EventBus<RuntimeEvents>();

