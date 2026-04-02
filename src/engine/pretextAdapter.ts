import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext';

export interface TextMeasureResult {
  lines: { text: string; width: number }[];
  width: number;
  height: number;
}

interface TextLayoutCacheItem {
  text: string;
  font: string;
  prepared: ReturnType<typeof prepareWithSegments>;
}

const cache = new Map<string, TextLayoutCacheItem>();

function getPrepared(text: string, font: string): ReturnType<typeof prepareWithSegments> {
  const key = `${font}|${text}`;
  const fromCache = cache.get(key);

  if (fromCache) {
    return fromCache.prepared;
  }

  const prepared = prepareWithSegments(text, font, { whiteSpace: 'pre-wrap' });
  cache.set(key, { text, font, prepared });
  return prepared;
}

export function measureTextBlock(text: string, font: string, maxWidth: number, lineHeight: number): TextMeasureResult {
  const prepared = getPrepared(text, font);
  const result = layoutWithLines(prepared, maxWidth, lineHeight);
  let widest = 0;

  for (const line of result.lines) {
    if (line.width > widest) {
      widest = line.width;
    }
  }

  return {
    lines: result.lines.map((line) => ({ text: line.text, width: line.width })),
    width: widest,
    height: result.height,
  };
}

