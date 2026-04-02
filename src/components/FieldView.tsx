import { useEffect, useRef } from 'react';
import { FieldRenderer } from '../engine/fieldRenderer';

export function FieldView(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const renderer = new FieldRenderer(canvas);
    renderer.start();

    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      renderer.stop();
    };
  }, []);

  return <canvas ref={canvasRef} className="field-canvas" />;
}

