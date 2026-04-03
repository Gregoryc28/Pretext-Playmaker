import { create } from 'zustand';
import type { PlayMeta } from '../data/types';

export interface SpotlightMatchupState {
  offensivePlayerId: string;
  defensivePlayerId: string;
  separationYards: number;
}

interface PlayStoreState {
  isPlaying: boolean;
  isDrawMode: boolean;
  playTimeSeconds: number;
  playDurationSeconds: number;
  telestratorResetVersion: number;
  playMeta: PlayMeta | null;
  spotlightMatchup: SpotlightMatchupState | null;
  togglePlayback: () => void;
  toggleDrawMode: () => void;
  setDrawMode: (enabled: boolean) => void;
  resetTelestrator: () => void;
  setPlayTime: (seconds: number) => void;
  setPlayDuration: (seconds: number) => void;
  setPlayMeta: (meta: PlayMeta | null) => void;
  setSpotlightMatchup: (matchup: SpotlightMatchupState | null) => void;
}

function clampToNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export const usePlayStore = create<PlayStoreState>((set, get) => ({
  isPlaying: true,
  isDrawMode: false,
  playTimeSeconds: 0,
  playDurationSeconds: 0,
  telestratorResetVersion: 0,
  playMeta: null,
  spotlightMatchup: null,
  togglePlayback: () => {
    set((state) => ({ isPlaying: !state.isPlaying }));
  },
  toggleDrawMode: () => {
    set((state) => ({ isDrawMode: !state.isDrawMode }));
  },
  setDrawMode: (enabled: boolean) => {
    set({ isDrawMode: enabled });
  },
  resetTelestrator: () => {
    set((state) => ({ telestratorResetVersion: state.telestratorResetVersion + 1 }));
  },
  setPlayTime: (seconds: number) => {
    const duration = get().playDurationSeconds;
    const clampedSeconds = clampToNonNegative(seconds);
    set({ playTimeSeconds: duration > 0 ? Math.min(clampedSeconds, duration) : clampedSeconds });
  },
  setPlayDuration: (seconds: number) => {
    const nextDuration = clampToNonNegative(seconds);
    set((state) => ({
      playDurationSeconds: nextDuration,
      playTimeSeconds: nextDuration > 0 ? Math.min(state.playTimeSeconds, nextDuration) : 0,
    }));
  },
  setPlayMeta: (meta: PlayMeta | null) => {
    set({ playMeta: meta });
  },
  setSpotlightMatchup: (matchup: SpotlightMatchupState | null) => {
    set({ spotlightMatchup: matchup });
  },
}));

