import type { PlayActionEvent, PlayData, PlayEntitySample, PlayFrame } from './types';

interface FootballSample {
  frame: PlayFrame;
  football: PlayEntitySample;
}

const THROW_ACCELERATION_THRESHOLD = 2.0;
const FOOTBALL_ENTITY_ID = 'football';

function getFootballSamples(play: PlayData): FootballSample[] {
  const samples: FootballSample[] = [];
  for (const frame of play.frames) {
    const football = frame.entities.find((entity) => entity.entityId === FOOTBALL_ENTITY_ID || entity.team === 'football');
    if (football) {
      samples.push({ frame, football });
    }
  }
  return samples;
}

function findThrowSampleIndex(samples: FootballSample[]): number {
  let bestIndex = -1;
  let bestDelta = THROW_ACCELERATION_THRESHOLD;

  for (let index = 1; index < samples.length; index += 1) {
    const delta = samples[index].football.s - samples[index - 1].football.s;
    if (delta > bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function findArrivalSampleIndex(samples: FootballSample[], throwIndex: number): number {
  if (throwIndex < 0 || throwIndex >= samples.length - 1) {
    return Math.max(throwIndex, 0);
  }

  for (let index = throwIndex + 1; index < samples.length; index += 1) {
    const previous = samples[index - 1].football.s;
    const current = samples[index].football.s;
    if (previous >= 3 && current <= 1.5) {
      return index;
    }
  }

  return Math.min(samples.length - 1, throwIndex + 10);
}

function makeRelativeTimestampMs(play: PlayData, timestampMs: number): number {
  const playStartMs = play.frames[0]?.timestampMs ?? 0;
  return Math.max(0, timestampMs - playStartMs);
}

export function derivePlayActionEvents(play: PlayData): PlayActionEvent[] {
  const description = (play.meta.description ?? '').toLowerCase();
  const samples = getFootballSamples(play);
  if (samples.length < 2) {
    return [];
  }

  const inferredEvents: PlayActionEvent[] = [];
  const throwIndex = findThrowSampleIndex(samples);

  if (description.includes('pass') && throwIndex >= 0) {
    const arrivalIndex = findArrivalSampleIndex(samples, throwIndex);
    const throwSample = samples[throwIndex].football;
    const arrivalSample = samples[arrivalIndex].football;
    const airYards = Math.abs(arrivalSample.x - throwSample.x);

    inferredEvents.push({
      id: `inferred-pass-thrown-${samples[throwIndex].frame.frameId}`,
      type: 'pass-thrown',
      source: 'inferred',
      timestampMs: makeRelativeTimestampMs(play, samples[throwIndex].frame.timestampMs),
      label: `Pass Thrown: ${airYards.toFixed(0)} Air Yds`,
      durationMs: 1500,
    });

    if (description.includes('incomplete')) {
      inferredEvents.push({
        id: `inferred-pass-incomplete-${samples[arrivalIndex].frame.frameId}`,
        type: 'pass-incomplete',
        source: 'inferred',
        timestampMs: makeRelativeTimestampMs(play, samples[arrivalIndex].frame.timestampMs),
        label: 'Pass Incomplete',
        durationMs: 1200,
      });
    }
  }

  return inferredEvents;
}

