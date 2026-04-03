import { useEffect, useState } from 'react';
import { runtimeBus } from '../engine/events';
import { PlaybackControls } from './PlaybackControls';
import { usePlayStore } from '../store/usePlayStore';

export function ControlPanel(): JSX.Element {
  const [fps, setFps] = useState(0);
  const playMeta = usePlayStore((state) => state.playMeta);

  useEffect(() => {
    return runtimeBus.on('fps', ({ fps: measuredFps }) => {
      setFps(measuredFps);
    });
  }, []);

  return (
    <section className="control-panel">
      <h2>Pretext Playmaker</h2>
      <p>Mock field with 22 moving players and collision-aware labels rendered on canvas.</p>
      <p>Text layout is measured with Pretext and positioned around moving obstacles each frame.</p>
      <PlaybackControls />
      <h3>Play Metadata</h3>
      <p className="status-line">Game ID: {playMeta?.gameId ?? 'Loading...'}</p>
      <p className="status-line">Play ID: {playMeta?.playId ?? 'Loading...'}</p>
      <p>{playMeta?.description ?? 'No description available.'}</p>
      <p className="status-line">Render FPS: {fps.toFixed(1)}</p>
      <p className="status-line">Target Simulation: 120Hz fixed-step</p>
    </section>
  );
}

