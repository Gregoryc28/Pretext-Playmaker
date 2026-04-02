import type { DataSourceConfig, TrackingFrame } from './types';

export interface TrackingService {
  getFrame(frameId: number): Promise<TrackingFrame>;
}

export function createTrackingService(config: DataSourceConfig): TrackingService {
  if (config.provider === 'mock') {
    throw new Error('Mock provider is generated locally by mockTracking.ts, not fetched via HTTP.');
  }

  return {
    async getFrame(frameId: number): Promise<TrackingFrame> {
      const response = await fetch(`${config.endpoint}?frame=${frameId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch tracking frame: ${response.status}`);
      }
      return (await response.json()) as TrackingFrame;
    },
  };
}

