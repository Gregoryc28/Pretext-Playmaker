import type { PlayData, PlayEntitySample, PlayFrame } from '../data/types';

export interface InterpolatedFrame {
  frameId: number;
  timestampMs: number;
  entities: PlayEntitySample[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(start: number, end: number, alpha: number): number {
  return start + (end - start) * alpha;
}

function lerpDegrees(start: number, end: number, alpha: number): number {
  const delta = ((end - start + 540) % 360) - 180;
  return (start + delta * alpha + 360) % 360;
}

function toEntityMap(frame: PlayFrame): Map<string, PlayEntitySample> {
  return new Map(frame.entities.map((entity) => [entity.entityId, entity]));
}

function getPlayDurationSeconds(play: PlayData): number {
  if (play.frames.length <= 1) {
    return 0;
  }

  const firstTimestamp = play.frames[0].timestampMs;
  const lastTimestamp = play.frames[play.frames.length - 1].timestampMs;
  return Math.max(0, (lastTimestamp - firstTimestamp) / 1000);
}

export function getLoopedPlayTimeSeconds(play: PlayData, playTimeSeconds: number): number {
  const durationSeconds = getPlayDurationSeconds(play);
  if (durationSeconds <= 0) {
    return 0;
  }

  return ((playTimeSeconds % durationSeconds) + durationSeconds) % durationSeconds;
}

export function samplePlayAtTime(play: PlayData, playTimeSeconds: number): InterpolatedFrame {
  if (play.frames.length === 0) {
    throw new Error('Cannot sample a play with zero frames.');
  }

  if (play.frames.length === 1) {
    const onlyFrame = play.frames[0];
    return {
      frameId: onlyFrame.frameId,
      timestampMs: onlyFrame.timestampMs,
      entities: onlyFrame.entities,
    };
  }

  const firstTimestamp = play.frames[0].timestampMs;
  const lastTimestamp = play.frames[play.frames.length - 1].timestampMs;
  const clampedTimestamp = firstTimestamp + clamp(playTimeSeconds * 1000, 0, lastTimestamp - firstTimestamp);

  let rightIndex = 1;
  while (rightIndex < play.frames.length && play.frames[rightIndex].timestampMs < clampedTimestamp) {
    rightIndex += 1;
  }

  if (rightIndex >= play.frames.length) {
    const lastFrame = play.frames[play.frames.length - 1];
    return {
      frameId: lastFrame.frameId,
      timestampMs: lastFrame.timestampMs,
      entities: lastFrame.entities,
    };
  }

  const leftFrame = play.frames[rightIndex - 1];
  const rightFrame = play.frames[rightIndex];

  const spanMs = Math.max(1, rightFrame.timestampMs - leftFrame.timestampMs);
  const alpha = clamp((clampedTimestamp - leftFrame.timestampMs) / spanMs, 0, 1);

  const leftEntities = toEntityMap(leftFrame);
  const rightEntities = toEntityMap(rightFrame);
  const seenIds = new Set<string>();
  const entities: PlayEntitySample[] = [];

  for (const leftEntity of leftFrame.entities) {
    const rightEntity = rightEntities.get(leftEntity.entityId);
    seenIds.add(leftEntity.entityId);

    if (!rightEntity) {
      entities.push(leftEntity);
      continue;
    }

    entities.push({
      entityId: leftEntity.entityId,
      displayName: leftEntity.displayName,
      team: leftEntity.team,
      x: lerp(leftEntity.x, rightEntity.x, alpha),
      y: lerp(leftEntity.y, rightEntity.y, alpha),
      s: lerp(leftEntity.s, rightEntity.s, alpha),
      dir: lerpDegrees(leftEntity.dir, rightEntity.dir, alpha),
    });
  }

  for (const rightEntity of rightFrame.entities) {
    if (!seenIds.has(rightEntity.entityId)) {
      const leftEntity = leftEntities.get(rightEntity.entityId);
      entities.push(leftEntity ?? rightEntity);
    }
  }

  return {
    frameId: Math.round(lerp(leftFrame.frameId, rightFrame.frameId, alpha)),
    timestampMs: Math.round(lerp(leftFrame.timestampMs, rightFrame.timestampMs, alpha)),
    entities,
  };
}

