import { usePlayStore } from '../store/usePlayStore';

function formatSeconds(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const minutes = Math.floor(totalMs / 60000);
  const remainingMs = totalMs - minutes * 60000;
  const wholeSeconds = Math.floor(remainingMs / 1000);
  const hundredths = Math.floor((remainingMs % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

export function PlaybackControls(): JSX.Element {
  const isPlaying = usePlayStore((state) => state.isPlaying);
  const isDrawMode = usePlayStore((state) => state.isDrawMode);
  const playTimeSeconds = usePlayStore((state) => state.playTimeSeconds);
  const playDurationSeconds = usePlayStore((state) => state.playDurationSeconds);
  const togglePlayback = usePlayStore((state) => state.togglePlayback);
  const toggleDrawMode = usePlayStore((state) => state.toggleDrawMode);
  const resetTelestrator = usePlayStore((state) => state.resetTelestrator);
  const setPlayTime = usePlayStore((state) => state.setPlayTime);

  const handleScrub: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    usePlayStore.setState({ isPlaying: false });
    setPlayTime(Number(event.target.value));
  };

  return (
    <section>
      <h3>Playback</h3>
      <div className="control-row">
        <button type="button" onClick={togglePlayback}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={toggleDrawMode}>
          {isDrawMode ? 'Draw Mode: On' : 'Draw Mode: Off'}
        </button>
        <button type="button" onClick={resetTelestrator}>
          Clear Drawing
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={playDurationSeconds}
        step={0.01}
        value={playTimeSeconds}
        onChange={handleScrub}
      />
      <p className="status-line">
        {formatSeconds(playTimeSeconds)} / {formatSeconds(playDurationSeconds)}
      </p>
      <p className="status-line">Telestrator: {isDrawMode ? 'Click and drag on field to measure route' : 'Enable Draw Mode to sketch routes'}</p>
    </section>
  );
}

