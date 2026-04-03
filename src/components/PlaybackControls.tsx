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
  const playTimeSeconds = usePlayStore((state) => state.playTimeSeconds);
  const playDurationSeconds = usePlayStore((state) => state.playDurationSeconds);
  const togglePlayback = usePlayStore((state) => state.togglePlayback);
  const setPlayTime = usePlayStore((state) => state.setPlayTime);

  const handleScrub: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    usePlayStore.setState({ isPlaying: false });
    setPlayTime(Number(event.target.value));
  };

  return (
    <section>
      <h3>Playback</h3>
      <button type="button" onClick={togglePlayback}>
        {isPlaying ? 'Pause' : 'Play'}
      </button>
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
    </section>
  );
}

