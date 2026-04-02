# Pretext Playmaker

Boilerplate for a high-frequency sports tracking renderer where React is the shell and the field is rendered on a controlled canvas loop.

## What is included

- `src/engine`: 120Hz fixed-step loop, Pretext text measurement adapter, and canvas field renderer.
- `src/physics`: uniform spatial grid plus collision-aware label placement around moving players.
- `src/data`: TypeScript interfaces for tracking frames, mock player generation, and service integration points.
- `src/components`: React control panel + canvas host component.
- `src/tools/smokeTest.ts`: tiny non-DOM harness that validates label placement behavior over 600 simulation steps.

## Quick start

```bash
npm install
npm run dev
```

## Validation

```bash
npm run typecheck
npm run smoke
npm run build
```

## Notes

- The field loop updates simulation with a fixed 120Hz step; render runs on `requestAnimationFrame`.
- Player labels are measured using `@chenglou/pretext` (`prepareWithSegments` + `layoutWithLines`) and placed around player-circle obstacles each frame.
- `src/data/trackingService.ts` is ready for wiring NFL/CFB providers once API endpoints are selected.

