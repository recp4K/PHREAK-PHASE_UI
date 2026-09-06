import { useState, useEffect, useRef, useCallback } from 'react';
import SmartAlignButton from './SmartAlignButton';
import CyberKnob from './CyberKnob';
import Oscilloscope from './Oscilloscope';
import PhaseWheel from './PhaseWheel';
import WaveformSphere from './WaveformSphere';

// ── JUCE bridge type ───────────────────────────────────────────────────────
declare global {
  interface Window {
    __juce?: {
      postMessage?: (msg: string) => void;
      on?: (event: string, handler: (data: unknown) => void) => void;
    };
  }
}

// ── Types ──────────────────────────────────────────────────────────────────
type AlignState = 'idle' | 'scanning' | 'locked';
type ViewMode = 'simple' | 'advanced';
type TrackMode = 'realtime' | 'timeline';

interface Params {
  crossoverFreq: number;
  subRotate: number;
  subDelay: number;
  subDynAmount: number;
  highRotate: number;
  highDelay: number;
  highDynAmount: number;
  envAttack: number;
  envRelease: number;
  lookaheadMs: number;
  glueDrive: number;
  alignTrackMode: 'Cont' | 'Trans';
}

interface Telemetry {
  correlation: number;
  phaseAngleDeg: number;
  rmsTrackA_dB: number;
  rmsTrackB_dB: number;
  detectedFundamentalHz: number;
  detectedNote: string;
  isLocked: boolean;
}

// ── Note lookup ────────────────────────────────────────────────────────────
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function freqToNote(freq: number): string {
  const semitones = Math.round(12 * Math.log2(freq / 16.352));
  const note = NOTE_NAMES[((semitones % 12) + 12) % 12];
  const octave = Math.floor(semitones / 12);
  return `${note}${octave}`;
}

// ── Waveform generator (simulated) ────────────────────────────────────────
function generateWave(
  t: number,
  phaseOffset: number,
  amp: number,
  samples: number,
): number[] {
  return Array.from({ length: samples }, (_, i) => {
    const x = (i / samples) * Math.PI * 8;
    const env =
      Math.exp(-((i - samples * 0.15) ** 2) / (2 * (samples * 0.12) ** 2)) * 0.6;
    const sus = 0.35 * Math.sin(x * 0.4 + t * 0.8);
    return (
      amp *
      (Math.sin(x + t * 2 + phaseOffset) * 0.5 +
        Math.sin(x * 2.3 + t * 3.1 + phaseOffset) * 0.2 +
        env +
        sus +
        (Math.random() - 0.5) * 0.035)
    );
  });
}

// ── Small reusable UI components ───────────────────────────────────────────

function CyberToggle({
  value,
  onChange,
  label,
  onLabel = 'ON',
  offLabel = 'OFF',
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        fontFamily: 'JetBrains Mono, monospace',
      }}
    >
      <div
        onClick={() => onChange(!value)}
        style={{
          width: 36,
          height: 18,
          borderRadius: 9,
          background: value ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${value ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.14)'}`,
          position: 'relative',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: value ? 18 : 2,
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: value ? '#FFFFFF' : 'rgba(255,255,255,0.35)',
            transition: 'left 0.2s cubic-bezier(0.34,1.56,0.64,1), background 0.2s ease',
          }}
        />
      </div>
      <div
        style={{
          fontSize: 8,
          color: value ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.25)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          textAlign: 'center',
          transition: 'color 0.2s',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 7,
          color: value ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)',
          letterSpacing: '0.06em',
        }}
      >
        {value ? onLabel : offLabel}
      </div>
    </div>
  );
}

function CorrelationArc({ correlation }: { correlation: number }) {
  const W = 250;
  const H = 72;
  const cx = W / 2;
  const cy = H - 10;
  const r = 50;

  // angle: π at correlation=-1, 0 at correlation=+1
  const angle = Math.PI - ((correlation + 1) / 2) * Math.PI;
  const nx = cx + r * Math.cos(angle);
  const ny = cy - r * Math.sin(angle);

  const corrPct = (correlation * 100).toFixed(1);
  const corrColor =
    correlation > 0.5
      ? 'rgba(255,255,255,0.9)'
      : correlation > 0
        ? 'rgba(255,255,255,0.6)'
        : 'rgba(255,255,255,0.3)';

  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      {/* Track arc */}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth="1.5"
        strokeDasharray="2.5 5"
      />
      {/* Value arc */}
      {Math.abs(correlation + 1) > 0.015 && (
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${correlation > 0 ? 1 : 0} 1 ${nx} ${ny}`}
          fill="none"
          stroke="rgba(255,255,255,0.45)"
          strokeWidth="1.5"
        />
      )}
      {/* Needle */}
      <line
        x1={cx}
        y1={cy}
        x2={nx}
        y2={ny}
        stroke="rgba(255,255,255,0.65)"
        strokeWidth="1.2"
      />
      <circle
        cx={nx}
        cy={ny}
        r="3.5"
        fill={corrColor}
        style={{ filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.45))' }}
      />
      <circle cx={cx} cy={cy} r="2" fill="rgba(255,255,255,0.22)" />
      {/* Labels */}
      <text
        x={cx - r - 2}
        y={cy + 11}
        fill="rgba(255,255,255,0.28)"
        fontSize="7.5"
        fontFamily="JetBrains Mono"
        textAnchor="middle"
      >
        -1.0
      </text>
      <text
        x={cx}
        y={cy - r - 4}
        fill="rgba(255,255,255,0.28)"
        fontSize="7.5"
        fontFamily="JetBrains Mono"
        textAnchor="middle"
      >
        0.0
      </text>
      <text
        x={cx + r + 2}
        y={cy + 11}
        fill="rgba(255,255,255,0.28)"
        fontSize="7.5"
        fontFamily="JetBrains Mono"
        textAnchor="middle"
      >
        +1.0
      </text>
      <text
        x={cx}
        y={cy + 22}
        fill={corrColor}
        fontSize="9.5"
        fontFamily="JetBrains Mono"
        textAnchor="middle"
        fontWeight="500"
      >
        CORR {correlation >= 0 ? '+' : ''}
        {corrPct}%
      </text>
    </svg>
  );
}

function VuMeter({
  label,
  db,
  color = 'rgba(255,255,255,0.7)',
}: {
  label?: string;
  db: number;
  color?: string;
}) {
  const bars = 8;
  const level = Math.max(0, Math.min(1, (db + 60) / 60));
  const litBars = Math.round(level * bars);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      {label && (
        <div
          style={{
            fontSize: 7.5,
            color: 'rgba(255,255,255,0.3)',
            letterSpacing: '0.1em',
            fontFamily: 'JetBrains Mono',
          }}
        >
          {label}
        </div>
      )}
      <div style={{ display: 'flex', gap: 1.5, alignItems: 'flex-end', height: 18 }}>
        {Array.from({ length: bars }, (_, i) => {
          const lit = i < litBars;
          const barH = 4 + (i / (bars - 1)) * 10;
          return (
            <div
              key={i}
              style={{
                width: 3,
                height: barH,
                background: lit ? color : 'rgba(255,255,255,0.07)',
                transition: 'background 0.05s ease',
                alignSelf: 'flex-end',
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          fontSize: 6.5,
          color: 'rgba(255,255,255,0.28)',
          fontFamily: 'JetBrains Mono',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {db.toFixed(1)}dB
      </div>
    </div>
  );
}

function SegToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        border: '1px solid rgba(255,255,255,0.14)',
        overflow: 'hidden',
        fontFamily: 'JetBrains Mono, monospace',
      }}
    >
      {options.map((opt, i) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            padding: '3px 9px',
            fontSize: 8,
            letterSpacing: '0.1em',
            background:
              value === opt.value ? 'rgba(255,255,255,0.16)' : 'transparent',
            color:
              value === opt.value
                ? 'rgba(255,255,255,0.9)'
                : 'rgba(255,255,255,0.3)',
            border: 'none',
            borderLeft:
              i > 0 ? '1px solid rgba(255,255,255,0.12)' : 'none',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            fontFamily: 'inherit',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── SYS Terminal slide-out ─────────────────────────────────────────────────
const TERMINAL_LINES = [
  { text: '$ PHREAKPHASE V2.0.4 — SYS // ARCHIVE', d: 0 },
  { text: '$ ────────────────────────────────────────────', d: 40 },
  { text: '', d: 80 },
  { text: '// PROBLEM STATEMENT', d: 120 },
  { text: 'When Kick (Track A) and Sub-Bass (Track B) share', d: 160 },
  { text: 'a summing bus, phase misalignment causes destructive', d: 200 },
  { text: 'cancellation — your low-end sounds thin & anemic.', d: 240 },
  { text: '', d: 280 },
  { text: '// THE FIX — ALL-PASS TPT FILTER', d: 320 },
  { text: 'A Linkwitz-Riley 4th-order crossover splits each', d: 360 },
  { text: 'track at CROSSOVER_FREQ (40–300Hz) into Sub + High.', d: 400 },
  { text: 'Independent TPT all-pass filters rotate phase by', d: 440 },
  { text: 'SUB_ROTATE / HIGH_ROTATE (±180°) — time-bending', d: 480 },
  { text: 'WITHOUT amplitude loss.', d: 520 },
  { text: '', d: 560 },
  { text: '// SMART ALIGN — GCC-PHAT ALGORITHM', d: 600 },
  { text: 'Cross-correlates A & B in the frequency domain,', d: 640 },
  { text: 'finds the lag maximising Pearson ρ, then auto-sets', d: 680 },
  { text: 'SUB_DELAY and SUB_ROTATE.', d: 720 },
  { text: '', d: 760 },
  { text: '// DYNAMIC UNMASKING', d: 800 },
  { text: 'Sidechain envelope (Attack / Release) drives a', d: 840 },
  { text: 'dynamic EQ cut carved into the conflicting band.', d: 880 },
  { text: 'Higher DYN_CUT = deeper carve on transient peaks.', d: 920 },
  { text: '', d: 960 },
  { text: '// FREAK GLUE ENGINE', d: 1000 },
  { text: 'Post-alignment saturation on the summed output.', d: 1040 },
  { text: 'GLUE_DRIVE (0–100%) adds harmonic density.', d: 1080 },
  { text: '', d: 1120 },
  { text: '// ROUTING — FL STUDIO', d: 1160 },
  { text: '1. Load on Mixer channel (4-in / 2-out)', d: 1200 },
  { text: '2. Kick send → Input 1+2 / Bass → Input 3+4', d: 1240 },
  { text: '3. Enable PDC (latency compensation)', d: 1280 },
  { text: '', d: 1320 },
  { text: '// ROUTING — ABLETON', d: 1360 },
  { text: '1. Insert on Audio track (External In)', d: 1400 },
  { text: '2. Use Max4Live for 4-ch bus routing', d: 1440 },
  { text: '3. Ensure LOOKAHEAD_MS reported to DAW for PDC', d: 1480 },
  { text: '', d: 1520 },
  { text: '$ END OF ARCHIVE // SYS READY_', d: 1560 },
];

function SysTerminal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 390,
        background: 'rgba(5,5,9,0.97)',
        borderLeft: '1px solid rgba(255,255,255,0.09)',
        zIndex: 100,
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.44s cubic-bezier(0.16, 1, 0.3, 1)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* CRT scanlines */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.16) 3px, rgba(0,0,0,0.16) 4px)',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      />
      {/* Header */}
      <div
        style={{
          padding: '11px 16px 9px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'relative',
          zIndex: 3,
          flexShrink: 0,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 9,
              color: 'rgba(255,255,255,0.6)',
              letterSpacing: '0.2em',
              fontFamily: 'JetBrains Mono',
            }}
          >
            // SYS // ARCHIVE
          </div>
          <div
            style={{
              fontSize: 7.5,
              color: 'rgba(255,255,255,0.22)',
              letterSpacing: '0.1em',
              fontFamily: 'JetBrains Mono',
              marginTop: 3,
            }}
          >
            PHREAKPHASE DOCUMENTATION v2.0.4
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.35)',
            fontSize: 8.5,
            padding: '3px 9px',
            cursor: 'pointer',
            fontFamily: 'JetBrains Mono',
            letterSpacing: '0.1em',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.75)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.35)')}
        >
          [ × ]
        </button>
      </div>
      {/* Content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px 20px',
          position: 'relative',
          zIndex: 3,
        }}
      >
        {TERMINAL_LINES.map((line, i) => (
          <div
            key={i}
            style={{
              fontSize: 8.5,
              color: line.text.startsWith('//')
                ? 'rgba(255,255,255,0.7)'
                : line.text.startsWith('$')
                  ? 'rgba(255,255,255,0.88)'
                  : 'rgba(255,255,255,0.38)',
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '0.04em',
              lineHeight: 1.75,
              minHeight: '0.9em',
              animation: isOpen
                ? `term-line-in 0.28s ease ${line.d}ms both`
                : undefined,
            }}
          >
            {line.text || ' '}
          </div>
        ))}
        <div
          style={{
            fontSize: 9,
            color: 'rgba(255,255,255,0.45)',
            fontFamily: 'JetBrains Mono',
            animation: 'cursor-blink 1.1s step-end infinite',
          }}
        >
          █
        </div>
      </div>
    </div>
  );
}

// ── ControlPanel (4-band deck) ─────────────────────────────────────────────
interface ControlPanelProps {
  params: Params;
  setParam: <K extends keyof Params>(key: K, val: Params[K]) => void;
}

function ControlPanel({ params, setParam }: ControlPanelProps) {
  const [splitEnabled, setSplitEnabled] = useState(true);
  const [subLatch, setSubLatch] = useState(false);
  const [highLatch, setHighLatch] = useState(false);
  const [deltaListen, setDeltaListen] = useState(false);

  const note = freqToNote(params.crossoverFreq);

  const panels = [
    {
      num: '01',
      title: 'CROSSOVER',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
          <CyberKnob
            label="FREQ"
            value={params.crossoverFreq}
            min={40}
            max={300}
            defaultValue={90}
            unit="Hz"
            size={54}
            decimals={1}
            onChange={(v) => setParam('crossoverFreq', v)}
            paramId="CROSSOVER_FREQ"
          />
          <div
            style={{
              fontSize: 8.5,
              color: 'rgba(255,255,255,0.5)',
              fontFamily: 'JetBrains Mono',
              letterSpacing: '0.04em',
              textAlign: 'center',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              padding: '2px 8px',
              whiteSpace: 'nowrap',
            }}
          >
            [ {note} — {params.crossoverFreq.toFixed(1)}Hz ]
          </div>
          <CyberToggle
            value={splitEnabled}
            onChange={setSplitEnabled}
            label="SPLIT"
            onLabel="ACTIVE"
            offLabel="BYPASS"
          />
        </div>
      ),
    },
    {
      num: '02',
      title: 'SUB BAND',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <CyberKnob
              label="ROTATE"
              value={params.subRotate}
              min={-180}
              max={180}
              defaultValue={0}
              unit="°"
              size={44}
              decimals={1}
              onChange={(v) => setParam('subRotate', v)}
              paramId="SUB_ROTATE"
              bipolar
            />
            <CyberKnob
              label="DELAY"
              value={params.subDelay}
              min={-20}
              max={20}
              defaultValue={0}
              unit="ms"
              size={44}
              decimals={2}
              onChange={(v) => setParam('subDelay', v)}
              paramId="SUB_DELAY"
              bipolar
            />
          </div>
          <CyberKnob
            label="DYN CUT"
            value={params.subDynAmount}
            min={0}
            max={100}
            defaultValue={0}
            unit="%"
            size={40}
            decimals={1}
            onChange={(v) => setParam('subDynAmount', v)}
            paramId="SUB_DYN_AMOUNT"
          />
          <CyberToggle
            value={subLatch}
            onChange={setSubLatch}
            label="PHASE LATCH"
            onLabel="LOCKED"
            offLabel="FREE"
          />
        </div>
      ),
    },
    {
      num: '03',
      title: 'HIGH BAND',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <CyberKnob
              label="ROTATE"
              value={params.highRotate}
              min={-180}
              max={180}
              defaultValue={0}
              unit="°"
              size={44}
              decimals={1}
              onChange={(v) => setParam('highRotate', v)}
              paramId="HIGH_ROTATE"
              bipolar
            />
            <CyberKnob
              label="DELAY"
              value={params.highDelay}
              min={-20}
              max={20}
              defaultValue={0}
              unit="ms"
              size={44}
              decimals={2}
              onChange={(v) => setParam('highDelay', v)}
              paramId="HIGH_DELAY"
              bipolar
            />
          </div>
          <CyberKnob
            label="DYN CUT"
            value={params.highDynAmount}
            min={0}
            max={100}
            defaultValue={0}
            unit="%"
            size={40}
            decimals={1}
            onChange={(v) => setParam('highDynAmount', v)}
            paramId="HIGH_DYN_AMOUNT"
          />
          <CyberToggle
            value={highLatch}
            onChange={setHighLatch}
            label="PHASE LATCH"
            onLabel="LOCKED"
            offLabel="FREE"
          />
        </div>
      ),
    },
    {
      num: '04',
      title: 'DYNAMICS & GLUE',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <CyberKnob
              label="ATTACK"
              value={params.envAttack}
              min={0.1}
              max={50}
              defaultValue={2}
              unit="ms"
              size={44}
              decimals={1}
              onChange={(v) => setParam('envAttack', v)}
              paramId="ENV_ATTACK"
            />
            <CyberKnob
              label="RELEASE"
              value={params.envRelease}
              min={10}
              max={500}
              defaultValue={120}
              unit="ms"
              size={44}
              decimals={0}
              onChange={(v) => setParam('envRelease', v)}
              paramId="ENV_RELEASE"
            />
          </div>
          <CyberKnob
            label="FREAK GLUE"
            value={params.glueDrive}
            min={0}
            max={100}
            defaultValue={0}
            unit="%"
            size={44}
            decimals={1}
            onChange={(v) => setParam('glueDrive', v)}
            paramId="GLUE_DRIVE"
          />
          <CyberToggle
            value={deltaListen}
            onChange={setDeltaListen}
            label="Δ LISTEN"
            onLabel="DELTA"
            offLabel="FULL"
          />
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {panels.map((panel, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.07)' : 'none',
            display: 'flex',
            flexDirection: 'column',
            padding: '0 14px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              padding: '9px 0 7px',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              marginBottom: 10,
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: 7.5,
                color: 'rgba(255,255,255,0.22)',
                fontFamily: 'JetBrains Mono',
                letterSpacing: '0.08em',
              }}
            >
              {panel.num} //
            </span>
            <span
              style={{
                fontSize: 8.5,
                color: 'rgba(255,255,255,0.55)',
                fontFamily: 'JetBrains Mono',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}
            >
              {panel.title}
            </span>
          </div>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {panel.content}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Compact align trigger (advanced mode strip) ────────────────────────────
function CompactAlignBtn({
  state,
  onTrigger,
  correlation,
}: {
  state: AlignState;
  onTrigger: () => void;
  correlation: number;
}) {
  const corrPct = Math.round(Math.abs(correlation) * 100);
  const label =
    state === 'idle'
      ? '[ SMART ALIGN ]'
      : state === 'scanning'
        ? '[ // SCANNING... ]'
        : `[ ● LOCKED +${corrPct}% ]`;

  return (
    <button
      onClick={onTrigger}
      style={{
        background:
          state === 'locked'
            ? 'rgba(255,255,255,0.1)'
            : state === 'scanning'
              ? 'rgba(255,255,255,0.04)'
              : 'rgba(255,255,255,0.03)',
        border: `1px solid ${
          state === 'locked'
            ? 'rgba(255,255,255,0.4)'
            : state === 'scanning'
              ? 'rgba(255,255,255,0.25)'
              : 'rgba(255,255,255,0.16)'
        }`,
        color:
          state === 'locked'
            ? 'rgba(255,255,255,0.92)'
            : state === 'scanning'
              ? 'rgba(255,255,255,0.6)'
              : 'rgba(255,255,255,0.45)',
        fontSize: 8.5,
        padding: '6px 14px',
        cursor: 'pointer',
        fontFamily: 'JetBrains Mono, monospace',
        letterSpacing: '0.12em',
        transition: 'all 0.2s ease',
        whiteSpace: 'nowrap',
        animation:
          state === 'scanning' ? 'hex-flicker 0.4s linear infinite' : undefined,
      }}
      onMouseEnter={(e) => {
        if (state === 'idle') e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)';
      }}
      onMouseLeave={(e) => {
        if (state === 'idle') e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)';
      }}
    >
      {label}
    </button>
  );
}

// ── Main PhreakPhase ───────────────────────────────────────────────────────
const PRESETS = ['808 LOW SLIP', 'TRAP SUB ALIGN', 'DnB PUNCH LOCK', 'HIP HOP THUMP', 'CUSTOM'];

export default function PhreakPhase() {
  // ── Params ───────────────────────────────────────────────────────────────
  const [params, setParams] = useState<Params>({
    crossoverFreq: 90,
    subRotate: 0,
    subDelay: 0,
    subDynAmount: 0,
    highRotate: 0,
    highDelay: 0,
    highDynAmount: 0,
    envAttack: 2.0,
    envRelease: 120.0,
    lookaheadMs: 5.0,
    glueDrive: 0,
    alignTrackMode: 'Trans',
  });

  const setParam = useCallback(<K extends keyof Params>(key: K, val: Params[K]) => {
    setParams((p) => ({ ...p, [key]: val }));
    window.__juce?.postMessage?.(
      JSON.stringify({ action: 'setParam', param: key, value: val }),
    );
  }, []);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [view, setView] = useState<ViewMode>('simple');
  const [trackMode, setTrackMode] = useState<TrackMode>('realtime');
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [alignState, setAlignState] = useState<AlignState>('idle');
  const [phaseWheelCollapsed, setPhaseWheelCollapsed] = useState(false);
  const [preset, setPreset] = useState(0);
  const [markerOffsetMs, setMarkerOffsetMs] = useState(0);

  // ── Live telemetry (simulated, replaced by C++ events in prod) ───────────
  const [telemetry, setTelemetry] = useState<Telemetry>({
    correlation: 0.42,
    phaseAngleDeg: 23,
    rmsTrackA_dB: -18.4,
    rmsTrackB_dB: -22.1,
    detectedFundamentalHz: 55.0,
    detectedNote: 'A1',
    isLocked: false,
  });

  const [waveformA, setWaveformA] = useState<number[]>([]);
  const [waveformB, setWaveformB] = useState<number[]>([]);
  const rafRef = useRef<number>(0);

  // Simulated 60fps waveform + telemetry updates
  useEffect(() => {
    const animate = (now: number) => {
      const t = now / 1000;
      const phaseOff =
        (params.subRotate / 180) * Math.PI +
        (params.subDelay / 20) * Math.PI * 0.5;
      setWaveformA(generateWave(t, 0, 0.75, 256));
      setWaveformB(generateWave(t, phaseOff, 0.6, 256));

      setTelemetry((prev) => ({
        ...prev,
        correlation: Math.max(
          -1,
          Math.min(1, 0.38 + 0.48 * Math.sin(t * 0.28) + (Math.random() - 0.5) * 0.04),
        ),
        phaseAngleDeg:
          params.subRotate +
          18 * Math.sin(t * 0.45) +
          (Math.random() - 0.5) * 1.8,
        rmsTrackA_dB:
          -18 + 5 * Math.sin(t * 2.1) + (Math.random() - 0.5) * 1.2,
        rmsTrackB_dB:
          -22 + 4 * Math.sin(t * 1.7 + 1) + (Math.random() - 0.5) * 1.0,
      }));

      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [params.subRotate, params.subDelay]);

  // Listen for C++ events in real plugin
  useEffect(() => {
    window.__juce?.on?.('telemetry', (data) => {
      setTelemetry(data as Telemetry);
    });
    window.__juce?.on?.('waveform', (data: unknown) => {
      const d = data as { trackA: number[]; trackB: number[]; markerOffsetMs: number };
      setWaveformA(d.trackA);
      setWaveformB(d.trackB);
      setMarkerOffsetMs(d.markerOffsetMs);
    });
  }, []);

  // Smart align trigger
  const handleSmartAlign = useCallback(() => {
    if (alignState === 'idle') {
      setAlignState('scanning');
      window.__juce?.postMessage?.(JSON.stringify({ action: 'smartAlign' }));
      // Simulate auto-complete (replaced by C++ `alignResult` event in prod)
      setTimeout(() => {
        setAlignState('locked');
        setParams((p) => ({
          ...p,
          subDelay: parseFloat((-1.2 + (Math.random() - 0.5) * 0.5).toFixed(2)),
          subRotate: parseFloat((12 + (Math.random() - 0.5) * 10).toFixed(1)),
        }));
      }, 2000);
    } else if (alignState === 'locked') {
      setAlignState('idle');
    }
  }, [alignState]);

  // Layout dimensions (fixed 1120 × 650)
  const W = 1120;
  const HEADER_H = 52;
  const HERO_H = 340;
  const DECK_H = 228;
  const STATUS_H = 30;

  return (
    <div
      style={{
        width: W,
        height: HEADER_H + HERO_H + DECK_H + STATUS_H,
        background: '#08080C',
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily: 'JetBrains Mono, monospace',
        color: '#F2F2F7',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ── HEADER ───────────────────────────────────────────────────────── */}
      <header
        style={{
          height: HEADER_H,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(255,255,255,0.012)',
          flexShrink: 0,
        }}
      >
        {/* Row 1 */}
        <div
          style={{
            height: 26,
            display: 'flex',
            alignItems: 'center',
            padding: '0 14px',
            gap: 14,
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.12em' }}>
              A // KICK
            </span>
            <VuMeter db={telemetry.rmsTrackA_dB} />
          </div>
          <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.1)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.32)', letterSpacing: '0.12em' }}>
              B // BASS
            </span>
            <VuMeter db={telemetry.rmsTrackB_dB} color="rgba(255,255,255,0.42)" />
          </div>
          <div style={{ flex: 1 }} />
          {/* Title */}
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: '0.38em',
              color: 'rgba(255,255,255,0.92)',
              textTransform: 'uppercase',
            }}
          >
            PHREAKPHASE
          </span>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.22)', letterSpacing: '0.1em' }}>
              MODE
            </span>
            <SegToggle
              options={[
                { label: 'REAL-TIME', value: 'realtime' as TrackMode },
                { label: 'TIMELINE', value: 'timeline' as TrackMode },
              ]}
              value={trackMode}
              onChange={setTrackMode}
            />
          </div>
        </div>

        {/* Row 2 */}
        <div
          style={{
            height: 26,
            display: 'flex',
            alignItems: 'center',
            padding: '0 14px',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.22)', letterSpacing: '0.1em' }}>
              PRESET
            </span>
            <select
              value={preset}
              onChange={(e) => setPreset(Number(e.target.value))}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.11)',
                color: 'rgba(255,255,255,0.65)',
                fontSize: 8,
                padding: '1px 6px',
                fontFamily: 'JetBrains Mono, monospace',
                letterSpacing: '0.06em',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {PRESETS.map((p, i) => (
                <option key={i} value={i} style={{ background: '#0C0C14' }}>
                  [ {p} ]
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.18)', letterSpacing: '0.1em' }}>
            // V2.0.4
          </span>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.22)', letterSpacing: '0.1em' }}>
              VIEW
            </span>
            <SegToggle
              options={[
                { label: 'SIMPLE', value: 'simple' as ViewMode },
                { label: 'ADVANCED', value: 'advanced' as ViewMode },
              ]}
              value={view}
              onChange={setView}
            />
          </div>
          <button
            onClick={() => setTerminalOpen(!terminalOpen)}
            style={{
              background: terminalOpen ? 'rgba(255,255,255,0.11)' : 'transparent',
              border: `1px solid ${terminalOpen ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.14)'}`,
              color: terminalOpen ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)',
              fontSize: 8,
              padding: '2px 9px',
              cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '0.1em',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (!terminalOpen) e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
            }}
            onMouseLeave={(e) => {
              if (!terminalOpen) e.currentTarget.style.color = 'rgba(255,255,255,0.35)';
            }}
          >
            [ ? / SYS ]
          </button>
        </div>
      </header>

      {/* ── HERO (340px) ─────────────────────────────────────────────────── */}
      <main
        style={{
          height: HERO_H,
          flexShrink: 0,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Dither dot backdrop */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(rgba(255,255,255,0.042) 1px, transparent 1px)',
            backgroundSize: '3px 3px',
            pointerEvents: 'none',
          }}
        />

        {view === 'simple' ? (
          /* ── SIMPLE MODE ── */
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1 }}>
            {/* Status strip */}
            <div
              style={{
                height: 26,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 20px',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                flexShrink: 0,
              }}
            >
              <div style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>
                {alignState === 'locked'
                  ? '// GCC-PHAT LOCK //'
                  : alignState === 'scanning'
                    ? '// SCANNING — GCC-PHAT //'
                    : '// AWAITING ALIGNMENT //'}
              </div>
              <div style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.08em' }}>
                FUND: {telemetry.detectedNote} — {telemetry.detectedFundamentalHz.toFixed(1)}Hz
              </div>
              <div style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>
                XOVER: {freqToNote(params.crossoverFreq)} / {params.crossoverFreq.toFixed(0)}Hz &nbsp;|&nbsp; PDC:{' '}
                {params.lookaheadMs.toFixed(1)}ms
              </div>
            </div>

            {/* Center: waveform sphere + SmartAlign + knobs */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 40,
                padding: '0 32px',
                position: 'relative',
              }}
            >
              {/* Left knob group */}
              <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.18)', letterSpacing: '0.18em' }}>
                    [ SUB ]
                  </div>
                  <CyberKnob
                    label="ROTATE"
                    value={params.subRotate}
                    min={-180}
                    max={180}
                    defaultValue={0}
                    unit="°"
                    size={70}
                    decimals={1}
                    onChange={(v) => setParam('subRotate', v)}
                    paramId="SUB_ROTATE"
                    bipolar
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.18)', letterSpacing: '0.18em' }}>
                    [ DELAY ]
                  </div>
                  <CyberKnob
                    label="OFFSET"
                    value={params.subDelay}
                    min={-20}
                    max={20}
                    defaultValue={0}
                    unit="ms"
                    size={70}
                    decimals={2}
                    onChange={(v) => setParam('subDelay', v)}
                    paramId="SUB_DELAY"
                    bipolar
                  />
                </div>
              </div>

              {/* Waveform sphere + SmartAlign overlay */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <WaveformSphere
                  waveformA={waveformA}
                  waveformB={waveformB}
                  size={290}
                  opacity={0.22}
                />
                {/* SmartAlign button centered over sphere */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <SmartAlignButton
                    state={alignState}
                    onTrigger={handleSmartAlign}
                    correlation={telemetry.correlation}
                    improvementPct={34.5}
                  />
                </div>
              </div>

              {/* Right knob group */}
              <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.18)', letterSpacing: '0.18em' }}>
                    [ GLUE ]
                  </div>
                  <CyberKnob
                    label="DRIVE"
                    value={params.glueDrive}
                    min={0}
                    max={100}
                    defaultValue={0}
                    unit="%"
                    size={70}
                    decimals={1}
                    onChange={(v) => setParam('glueDrive', v)}
                    paramId="GLUE_DRIVE"
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.18)', letterSpacing: '0.18em' }}>
                    [ XOVER ]
                  </div>
                  <CyberKnob
                    label="FREQ"
                    value={params.crossoverFreq}
                    min={40}
                    max={300}
                    defaultValue={90}
                    unit="Hz"
                    size={70}
                    decimals={0}
                    onChange={(v) => setParam('crossoverFreq', v)}
                    paramId="CROSSOVER_FREQ"
                  />
                </div>
              </div>
            </div>

            {/* Correlation + phase readout strip */}
            <div
              style={{
                height: 88,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderTop: '1px solid rgba(255,255,255,0.05)',
                gap: 52,
                flexShrink: 0,
              }}
            >
              <CorrelationArc correlation={telemetry.correlation} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 170 }}>
                <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.22)', letterSpacing: '0.14em' }}>
                  INSTANTANEOUS PHASE
                </div>
                <div
                  style={{
                    fontSize: 18,
                    color: 'rgba(255,255,255,0.88)',
                    letterSpacing: '0.04em',
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  [{' '}
                  <span
                    style={{
                      color: '#fff',
                      textShadow: '0 0 12px rgba(255,255,255,0.4)',
                    }}
                  >
                    {telemetry.phaseAngleDeg >= 0 ? '+' : ''}
                    {telemetry.phaseAngleDeg.toFixed(1)}°
                  </span>{' '}
                  ]
                </div>
                <div
                  style={{
                    fontSize: 7.5,
                    color: 'rgba(255,255,255,0.2)',
                    letterSpacing: '0.07em',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  ROT: {params.subRotate >= 0 ? '+' : ''}
                  {params.subRotate.toFixed(1)}° &nbsp;|&nbsp; DLY:{' '}
                  {params.subDelay >= 0 ? '+' : ''}
                  {params.subDelay.toFixed(2)}ms
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── ADVANCED MODE ── */
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              zIndex: 1,
            }}
          >
            {/* Oscilloscope — flex:1 fills 340 - 118 = 222px */}
            <div
              style={{
                flex: 1,
                position: 'relative',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                overflow: 'hidden',
              }}
            >
              <Oscilloscope
                trackA={waveformA}
                trackB={waveformB}
                markerOffsetMs={markerOffsetMs}
                onMarkerChange={setMarkerOffsetMs}
                width={W}
                height={222}
              />
              {/* Phase wheel overlay */}
              <div style={{ position: 'absolute', top: 10, right: 14, zIndex: 10 }}>
                <PhaseWheel
                  phaseAngleDeg={telemetry.phaseAngleDeg}
                  correlation={telemetry.correlation}
                  size={phaseWheelCollapsed ? 48 : 148}
                  collapsed={phaseWheelCollapsed}
                  onToggleCollapse={() => setPhaseWheelCollapsed((v) => !v)}
                />
              </div>
            </div>

            {/* Bottom strip — fixed 118px */}
            <div
              style={{
                height: 118,
                display: 'flex',
                alignItems: 'center',
                padding: '0 18px',
                gap: 0,
                flexShrink: 0,
              }}
            >
              {/* Correlation arc */}
              <div style={{ marginRight: 16 }}>
                <CorrelationArc correlation={telemetry.correlation} />
              </div>

              <div
                style={{
                  width: 1,
                  height: 72,
                  background: 'rgba(255,255,255,0.07)',
                  marginRight: 18,
                  flexShrink: 0,
                }}
              />

              {/* Telemetry readouts */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3.5,
                  minWidth: 190,
                  marginRight: 22,
                }}
              >
                <div
                  style={{
                    fontSize: 7,
                    color: 'rgba(255,255,255,0.22)',
                    letterSpacing: '0.14em',
                    marginBottom: 2,
                  }}
                >
                  // TELEMETRY
                </div>
                {(
                  [
                    ['PHASE', `${telemetry.phaseAngleDeg >= 0 ? '+' : ''}${telemetry.phaseAngleDeg.toFixed(1)}°`],
                    ['FUND', `${telemetry.detectedNote} — ${telemetry.detectedFundamentalHz.toFixed(1)}Hz`],
                    ['A RMS', `${telemetry.rmsTrackA_dB.toFixed(1)}dB`],
                    ['B RMS', `${telemetry.rmsTrackB_dB.toFixed(1)}dB`],
                    ['MARKER', `${markerOffsetMs >= 0 ? '+' : ''}${markerOffsetMs.toFixed(2)}ms`],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 8 }}>
                    <span
                      style={{
                        fontSize: 7.5,
                        color: 'rgba(255,255,255,0.22)',
                        letterSpacing: '0.08em',
                        minWidth: 50,
                      }}
                    >
                      {k}
                    </span>
                    <span
                      style={{
                        fontSize: 7.5,
                        color: 'rgba(255,255,255,0.62)',
                        letterSpacing: '0.06em',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {v}
                    </span>
                  </div>
                ))}
              </div>

              <div
                style={{
                  width: 1,
                  height: 72,
                  background: 'rgba(255,255,255,0.07)',
                  marginRight: 22,
                  flexShrink: 0,
                }}
              />

              {/* Compact align button */}
              <CompactAlignBtn
                state={alignState}
                onTrigger={handleSmartAlign}
                correlation={telemetry.correlation}
              />

              <div style={{ flex: 1 }} />

              {/* Tracking mode + lookahead */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: 7,
                }}
              >
                <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.22)', letterSpacing: '0.12em' }}>
                  // TRACKING MODE
                </div>
                <SegToggle
                  options={[
                    { label: 'CONTINUOUS', value: 'Cont' as const },
                    { label: 'TRANSIENT', value: 'Trans' as const },
                  ]}
                  value={params.alignTrackMode}
                  onChange={(v) => setParam('alignTrackMode', v)}
                />
                <div
                  style={{
                    fontSize: 7,
                    color: 'rgba(255,255,255,0.18)',
                    letterSpacing: '0.08em',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  PDC LOOKAHEAD: {params.lookaheadMs.toFixed(1)}ms
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── CONTROL DECK (228px) ─────────────────────────────────────────── */}
      <section
        style={{
          height: DECK_H,
          flexShrink: 0,
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          background: 'rgba(255,255,255,0.008)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Dither backdrop */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)',
            backgroundSize: '4px 4px',
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative', zIndex: 1, height: '100%' }}>
          <ControlPanel params={params} setParam={setParam} />
        </div>
      </section>

      {/* ── STATUS BAR (30px) ────────────────────────────────────────────── */}
      <footer
        style={{
          height: STATUS_H,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          padding: '0 14px',
          gap: 14,
          background: 'rgba(0,0,0,0.35)',
        }}
      >
        <span
          style={{
            fontSize: 7,
            color: 'rgba(255,255,255,0.18)',
            letterSpacing: '0.1em',
          }}
        >
          // PHREAKPHASE V2.0.4 — JUCE 7/8 WEBVIEW
        </span>
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 7,
            color: 'rgba(255,255,255,0.14)',
            letterSpacing: '0.08em',
          }}
        >
          SR: 44.1kHz &nbsp;|&nbsp; BUF: 512 smp &nbsp;|&nbsp;
        </span>
        <span
          style={{
            fontSize: 7,
            letterSpacing: '0.1em',
            color:
              alignState === 'locked'
                ? 'rgba(255,255,255,0.7)'
                : alignState === 'scanning'
                  ? 'rgba(255,255,255,0.45)'
                  : 'rgba(255,255,255,0.18)',
            transition: 'color 0.35s ease',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {alignState === 'locked'
            ? '● ALIGNED'
            : alignState === 'scanning'
              ? '◌ SCANNING...'
              : '○ STANDBY'}
        </span>
        <div
          style={{
            width: 1,
            height: 12,
            background: 'rgba(255,255,255,0.08)',
          }}
        />
        <span
          style={{
            fontSize: 7,
            color: 'rgba(255,255,255,0.14)',
            letterSpacing: '0.08em',
          }}
        >
          PDC: {params.lookaheadMs.toFixed(1)}ms
        </span>
      </footer>

      {/* ── SYS TERMINAL ─────────────────────────────────────────────────── */}
      <SysTerminal isOpen={terminalOpen} onClose={() => setTerminalOpen(false)} />
    </div>
  );
}
