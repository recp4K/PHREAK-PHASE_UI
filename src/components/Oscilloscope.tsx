import { useRef, useEffect, useCallback } from 'react';

interface OscilloscopeProps {
  trackA: number[];
  trackB: number[];
  markerOffsetMs: number;
  onMarkerChange?: (ms: number) => void;
  width: number;
  height: number;
}

export default function Oscilloscope({
  trackA,
  trackB,
  markerOffsetMs,
  onMarkerChange,
  width,
  height,
}: OscilloscopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markerDragging = useRef(false);
  const markerXRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    const midY = H / 2;

    // Grid lines (1px dotted phosphor)
    ctx.save();
    ctx.setLineDash([2, 6]);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    // Horizontal grid
    for (let i = 0; i <= 4; i++) {
      const y = (i / 4) * H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    // Vertical grid
    for (let i = 0; i <= 8; i++) {
      const x = (i / 8) * W;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.restore();

    // Center line
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(W, midY);
    ctx.stroke();
    ctx.restore();

    const drawWave = (
      data: number[],
      color: string,
      lineWidth: number,
      dashed: boolean,
      glowAlpha: number,
    ) => {
      if (!data.length) return;
      ctx.save();

      if (glowAlpha > 0) {
        ctx.shadowBlur = 6;
        ctx.shadowColor = color.replace(/[\d.]+\)$/, `${glowAlpha})`);
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (dashed) ctx.setLineDash([3, 2]);
      else ctx.setLineDash([]);

      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * W;
        const y = midY - data[i] * (H / 2) * 0.85;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    };

    // Track B — dithered phosphor (slightly dimmer, dashed)
    drawWave(trackB, 'rgba(255,255,255,0.38)', 1.2, true, 0.12);

    // Track A — crisp solid white
    drawWave(trackA, 'rgba(255,255,255,0.88)', 1.5, false, 0.25);

    // Marker line
    const markerX = markerXRef.current;
    if (markerX !== null) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(markerX, 0);
      ctx.lineTo(markerX, H);
      ctx.stroke();
      // Marker label
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `9px JetBrains Mono, monospace`;
      ctx.fillText(`${markerOffsetMs.toFixed(2)}ms`, markerX + 4, 14);
      ctx.restore();
    }

    // Track labels
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillText('A // KICK', 8, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText('B // BASS', 8, 26);
  }, [trackA, trackB, markerOffsetMs]);

  // Scale canvas for DPR
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx?.scale(dpr, dpr);
  }, [width, height]);

  useEffect(() => {
    draw();
  });

  // Initialize marker position
  useEffect(() => {
    markerXRef.current = width / 2;
  }, [width]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (Math.abs(x - (markerXRef.current ?? width / 2)) < 12) {
      markerDragging.current = true;
      (e.target as Element).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!markerDragging.current) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(width, e.clientX - rect.left));
    markerXRef.current = x;
    const ms = ((x / width) * 2 - 1) * 20;
    onMarkerChange?.(ms);
  };

  const handlePointerUp = () => {
    markerDragging.current = false;
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        width,
        height,
        display: 'block',
        cursor: 'col-resize',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
}
