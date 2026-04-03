# Pretext Playmaker

**Pretext Playmaker** is a high-performance, collision-aware sports tracking renderer built for real-time play visualization. By orchestrating a controlled canvas loop with a React shell, the project simulates and renders complex tracking data at a steady 120Hz fixed-step loop.

## Overview

This project was developed to push the boundaries of browser-based rendering and real-time physics. It visualizes sports tracking data (such as player movements, paths, and dynamic labels) while gracefully handling real-time spatial constraints and object collisions.

### Overcoming High-Frequency Rendering Hurdles with Pretext

A cornerstone of this architecture is the utilization of the **Pretext** library, developed by Cheng Lou. Traditional browser text layout and measurement (`CanvasRenderingContext2D.measureText` or DOM-based measurements) are notoriously slow and induce heavy layout thrashing. When attempting to calculate dynamic, collision-free placements for dozens of player labels every 16ms, these built-in browser APIs become an impassable bottleneck. 

**Pretext Playmaker is only possible thanks to the Pretext library.** By leveraging `@chenglou/pretext` for ultra-fast, zero-allocation text measurement (`prepareWithSegments` + `layoutWithLines`), the project completely bypasses the browser's native text layout engine. This allowed me to:
- **Execute** frame-perfect text layout calculations within a 120Hz fixed-step physics loop.
- **Implement** a collision-aware spatial grid that recalculates label placement around moving players continuously.
- **Eliminate** garbage collection spikes and dropped frames, maintaining buttery-smooth `requestAnimationFrame` render cycles.

## Key Features & Architecture

- **Architected** a continuous, fixed-step 120Hz game loop independent of the rendering frame rate, ensuring deterministic physics and label placement.
- **Engineered** a custom uniform spatial grid (`src/physics`) for efficient neighborhood querying, enabling constant-time collision detection for dynamic objects.
- **Integrated** the Pretext adapter (`src/engine`) to seamlessly measure and layout text segments at sub-millisecond speeds.
- **Built** a robust React interface (`src/components`) that acts as a declarative shell over the imperative Canvas engine.
- **Designed** a flexible data pipeline (`src/data`) ready to ingest real tracking telemetry (e.g., NFL/CFB data providers).

## Quick Start

```bash
npm install
npm run dev
```

## Validation & Testing

- **Developed** a non-DOM smoke testing harness (`npm run smoke`) that rigorously validates spatial label placement behavior over hundreds of simulation steps.

```bash
npm run typecheck
npm run smoke
npm run build
```
