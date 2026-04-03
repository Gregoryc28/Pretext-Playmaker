import type { PlayData } from './types';
import { derivePlayActionEvents } from './playActionEvents';

const DEFAULT_PLAY_ENDPOINT = '/data/sample_play.json';

export async function fetchPlayData(endpoint: string = DEFAULT_PLAY_ENDPOINT): Promise<PlayData> {
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to fetch play data from ${endpoint}: ${response.status}`);
  }

  const play = (await response.json()) as PlayData;
  if (!play.frames || play.frames.length === 0) {
    throw new Error(`Play data at ${endpoint} contains no frames.`);
  }

  const inferredEvents = derivePlayActionEvents(play);
  const existingEvents = play.events ?? [];
  play.events = [...existingEvents, ...inferredEvents];

  return play;
}

