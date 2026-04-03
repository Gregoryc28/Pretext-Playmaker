import { create } from 'zustand';
import type { PlayMeta } from '../data/types';

interface PlayStoreState {
  isPlaying: boolean;
  playTimeSeconds: number;
  playDurationSeconds: number;
  playMeta: PlayMeta | null;
  togglePlayback: () => void;
  setPlayTime: (seconds: number) => void;
  setPlayDuration: (seconds: number) => void;
  setPlayMeta: (meta: PlayMeta | null) => void;
}

function clampToNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export const usePlayStore = create<PlayStoreState>((set, get) => ({
  isPlaying: true,
  playTimeSeconds: 0,
  playDurationSeconds: 0,
  playMeta: null,
  togglePlayback: () => {
    set((state) => ({ isPlaying: !state.isPlaying }));
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
}));

