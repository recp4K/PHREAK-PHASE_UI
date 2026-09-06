import { useRef, useEffect } from 'react';

interface PhaseWheelProps {
  phaseAngleDeg: number;
  correlation: number;
  size: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function PhaseWheel({
  phaseAngleDeg,
  correlation,
  size,
  collapsed = false,
  onToggleCollapse,
}: PhaseWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<Array<{ angle: number; alpha: number }>>([]);
  const prevAngle = useRef(phaseAngleDeg);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx?.scale(dpr, dpr);
  }, [size]);

  useEffect(() => {
    // Add to trail
    trailRef.current.push({ angle: prevAngle.current, alpha: 0.6 });
    if (trailRef.current.length > 20) trailRef.current.shift();
    trailRef.current = trailRef.current.map((t) => ({ ...t, alpha: t.alpha * 0.75 }));
    prevAngle.current = phaseAngleDeg;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const maxR = size / 2 - 10;

    // Background
    ctx.fillStyle = 'rgba(8,8,12,0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy, maxR + 8, 0, Math.PI * 2);
    ctx.fill();

    // Concentric dashed rings at 0.33, 0.66, 1.0 correlation radii
    [0.33, 0.66, 1.0].forEach((ratio, i) => {
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * ratio, 0, Math.PI * 2);
      ctx.strokeStyle = i === 2 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Cross hairs
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - maxR, cy);
    ctx.lineTo(cx + maxR, cy);
    ctx.moveTo(cx, cy - maxR);
    ctx.lineTo(cx, cy + maxR);
    ctx.stroke();

    // Phosphor trail
    trailRef.current.forEach((t) => {
      if (t.alpha < 0.02) return;
      const rad = ((t.angle - 90) * Math.PI) / 180;
      const tr = maxR * Math.min(1, Math.abs(correlation));
      const tx = cx + tr * Math.cos(rad);
      const ty = cy + tr * Math.sin(rad);
      ctx.beginPath();
      ctx.arc(tx, ty, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${t.alpha * 0.5})`;
      ctx.fill();
    });

    // Needle
    const needleRad = ((phaseAngleDeg - 90) * Math.PI) / 180;
    const nr = maxR * Math.min(1, Math.abs(correlation));
    const nx = cx + nr * Math.cos(needleRad);
    const ny = cy + nr * Math.sin(needleRad);

    // Needle glow
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(255,255,255,0.6)';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Needle tip
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(nx, ny, 3, 0, Math.PI * 2);
    ctx.fill();

    // Center dot
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();

    // Labels
    ctx.font = '7px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.textAlign = 'center';
    ctx.fillText('+90°', cx, cy - maxR - 4);
    ctx.fillText('-90°', cx, cy + maxR + 10);
    ctx.textAlign = 'right';
    ctx.fillText('±180°', cx - maxR - 2, cy + 3);
    ctx.textAlign = 'left';
    ctx.fillText('0°', cx + maxR + 3, cy + 3);

    ctx.restore();
  });

  if (collapsed) {
    return (
      <div
        onClick={onToggleCollapse}
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.2)',
          background: '#0C0C14',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          position: 'relative',
        }}
        title="Expand Phase Wheel"
      >
        {/* Mini indicator */}
        <svg width={36} height={36}>
          <circle cx={18} cy={18} r={14} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={1} strokeDasharray="2 4" />
          {(() => {
            const rad = ((phaseAngleDeg - 90) * Math.PI) / 180;
            return (
              <line
                x1={18}
                y1={18}
                x2={18 + 12 * Math.cos(rad)}
                y2={18 + 12 * Math.sin(rad)}
                stroke="rgba(255,255,255,0.7)"
                strokeWidth={1.5}
              />
            );
          })()}
          <circle cx={18} cy={18} r={2} fill="rgba(255,255,255,0.4)" />
        </svg>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size, display: 'block' }}
      />
      {/* Collapse button */}
      <button
        onClick={onToggleCollapse}
        style={{
          position: 'absolute',
          top: 2,
          right: 2,
          width: 16,
          height: 16,
          background: 'rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 2,
          color: 'rgba(255,255,255,0.4)',
          fontSize: 8,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'JetBrains Mono',
          lineHeight: 1,
        }}
        title="Collapse"
      >
        ▲
      </button>
      {/* Angle readout */}
      <div
        style={{
          position: 'absolute',
          bottom: 4,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 8,
          color: 'rgba(255,255,255,0.45)',
          fontFamily: 'JetBrains Mono, monospace',
          letterSpacing: '0.06em',
        }}
      >
        {phaseAngleDeg >= 0 ? '+' : ''}{phaseAngleDeg.toFixed(1)}°
      </div>
    </div>
  );
}
