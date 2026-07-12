import { useEffect, useRef, useState } from 'react';

interface Props {
  onSubmit: (input: { scratched: true }) => void;
  disabled: boolean;
}

const WIDTH = 260;
const HEIGHT = 150;
const REVEAL_THRESHOLD = 0.4; // fraction of the canvas cleared before auto-submitting

// One-thumb tactile game: an old map fragment covered in "dirt" - the
// player rubs it away with a finger. Once enough of the canvas is cleared,
// this submits automatically; the server has already decided the outcome.
export default function ScratchOff({ onSubmit, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scratching = useRef(false);
  const submitted = useRef(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gradient.addColorStop(0, '#8a6a4a');
    gradient.addColorStop(1, '#6b4f36');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = 'rgba(244,241,234,0.85)';
    ctx.font = 'italic 13px Georgia, serif';
    ctx.fillText('rub away the dirt', 62, HEIGHT / 2);
  }, []);

  function scratchAt(x: number, y: number) {
    const canvas = canvasRef.current;
    if (!canvas || disabled || submitted.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  function checkProgress() {
    const canvas = canvasRef.current;
    if (!canvas || submitted.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { data } = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    let cleared = 0;
    for (let i = 3; i < data.length; i += 4 * 20) { // sample every 20th pixel's alpha
      if (data[i] === 0) cleared++;
    }
    const sampled = Math.ceil(data.length / (4 * 20));
    const fraction = cleared / sampled;
    setProgress(fraction);
    if (fraction >= REVEAL_THRESHOLD) {
      submitted.current = true;
      onSubmit({ scratched: true });
    }
  }

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: 'var(--muted)' }}>
        Rub away the dirt with your finger
      </p>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ borderRadius: 'var(--r-md)', border: '1px solid var(--border)', touchAction: 'none', cursor: disabled ? 'default' : 'pointer' }}
        onPointerDown={(e) => { scratching.current = true; const p = pointFromEvent(e); scratchAt(p.x, p.y); checkProgress(); }}
        onPointerMove={(e) => { if (!scratching.current) return; const p = pointFromEvent(e); scratchAt(p.x, p.y); checkProgress(); }}
        onPointerUp={() => { scratching.current = false; }}
        onPointerLeave={() => { scratching.current = false; }}
      />
      <p style={{ margin: '10px 0 0', fontSize: '0.72rem', color: 'var(--muted)' }}>{Math.min(100, Math.round((progress / REVEAL_THRESHOLD) * 100))}% cleared</p>
    </div>
  );
}
