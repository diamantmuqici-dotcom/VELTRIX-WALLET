import { useId, useMemo, useRef, useState, type ReactNode } from 'react';

export interface Pt {
  t: number;
  v: number;
}

function extent(values: number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    return [min - pad, max + pad];
  }
  return [min, max];
}

function useHover(n: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState<number | null>(null);
  const pick = (clientX: number) => {
    const el = ref.current;
    if (!el || n < 1) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setIdx(Math.round(f * (n - 1)));
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => pick(e.clientX),
    onPointerMove: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' || e.buttons > 0 || idx !== null) pick(e.clientX);
    },
    onPointerLeave: () => setIdx(null),
    onPointerUp: (e: React.PointerEvent) => {
      if (e.pointerType !== 'mouse') setIdx(null);
    },
    onPointerCancel: () => setIdx(null),
  };
  return { ref, idx, handlers };
}

/** Area/line chart with a touch crosshair. */
export function LineChart({
  data,
  height = 180,
  color = 'var(--accent)',
  formatValue,
  formatTime,
  area = true,
  label,
  baseline,
}: {
  data: Pt[];
  height?: number;
  color?: string;
  formatValue: (v: number) => string;
  formatTime: (t: number) => string;
  area?: boolean;
  label: string;
  baseline?: number;
}) {
  const gid = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const W = 360;
  const H = height;
  const { ref, idx, handlers } = useHover(data.length);
  const geo = useMemo(() => {
    const [min, max] = extent(baseline !== undefined ? [...data.map((d) => d.v), baseline] : data.map((d) => d.v));
    const n = Math.max(1, data.length - 1);
    const x = (i: number) => (i / n) * W;
    const y = (v: number) => H - 8 - ((v - min) / (max - min)) * (H - 22);
    const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)} ${y(d.v).toFixed(2)}`).join('');
    return { x, y, line, areaPath: `${line}L${W} ${H}L0 ${H}Z` };
  }, [data, H, baseline]);
  if (data.length < 2) return <div className="chart" style={{ height }} />;
  const hp = idx !== null ? data[idx] : null;
  return (
    <div className="chart" ref={ref} {...handlers} style={{ height }} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: color, stopOpacity: 0.22 }} />
            <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {baseline !== undefined && <line x1="0" x2={W} y1={geo.y(baseline)} y2={geo.y(baseline)} style={{ stroke: 'var(--chart-grid)' }} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
        {area && <path d={geo.areaPath} fill={`url(#${gid})`} />}
        <path d={geo.line} fill="none" style={{ stroke: color }} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hp && idx !== null && (
          <>
            <line x1={geo.x(idx)} x2={geo.x(idx)} y1="0" y2={H} style={{ stroke: 'var(--border-strong)' }} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {hp && idx !== null && (
        <>
          <span
            style={{
              position: 'absolute',
              left: `${(idx / (data.length - 1)) * 100}%`,
              top: geo.y(hp.v) - 5,
              width: 10,
              height: 10,
              marginLeft: -5,
              borderRadius: 5,
              background: color,
              boxShadow: '0 0 0 3px var(--bg)',
              pointerEvents: 'none',
            }}
          />
          <div className="chart-tip" style={{ left: `${Math.min(82, Math.max(18, (idx / (data.length - 1)) * 100))}%`, top: -34 }}>
            {formatValue(hp.v)} · {formatTime(hp.t)}
          </div>
        </>
      )}
    </div>
  );
}

export function Sparkline({ values, width = 72, height = 28, color }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const [min, max] = extent(values);
  const n = values.length - 1;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / n) * width).toFixed(1)} ${(height - 2 - ((v - min) / (max - min)) * (height - 4)).toFixed(1)}`).join('');
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" style={{ stroke: color ?? (up ? 'var(--positive)' : 'var(--negative)') }} strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export interface BarDatum {
  label: string;
  a: number;
  b: number;
}

/** Grouped bars (e.g. income vs spending). */
export function BarChart({
  data,
  height = 160,
  colorA = 'var(--chart-1)',
  colorB = 'var(--chart-5)',
  formatValue,
  labelA,
  labelB,
  label,
}: {
  data: BarDatum[];
  height?: number;
  colorA?: string;
  colorB?: string;
  formatValue: (v: number) => string;
  labelA: string;
  labelB: string;
  label: string;
}) {
  const { ref, idx, handlers } = useHover(data.length);
  const max = Math.max(1, ...data.map((d) => Math.max(d.a, d.b)));
  const W = 360;
  const H = height;
  const slot = W / Math.max(1, data.length);
  const bw = Math.max(2, Math.min(14, slot * 0.3));
  const sel = idx !== null ? data[idx] : null;
  const every = Math.ceil(data.length / 7);
  return (
    <div>
      <div className="chart" ref={ref} {...handlers} style={{ height }} role="img" aria-label={label}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }}>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} style={{ stroke: 'var(--chart-grid)' }} vectorEffect="non-scaling-stroke" />
          ))}
          {data.map((d, i) => {
            const cx = slot * i + slot / 2;
            const ha = (d.a / max) * (H - 6);
            const hb = (d.b / max) * (H - 6);
            const dim = idx !== null && idx !== i ? 0.35 : 1;
            return (
              <g key={i} opacity={dim}>
                <rect x={cx - bw - 1} y={H - ha} width={bw} height={Math.max(ha, d.a > 0 ? 1.5 : 0)} rx={Math.min(3, bw / 2)} style={{ fill: colorA }} />
                <rect x={cx + 1} y={H - hb} width={bw} height={Math.max(hb, d.b > 0 ? 1.5 : 0)} rx={Math.min(3, bw / 2)} style={{ fill: colorB }} />
              </g>
            );
          })}
        </svg>
        {sel && idx !== null && (
          <div className="chart-tip" style={{ left: `${Math.min(80, Math.max(20, ((idx + 0.5) / data.length) * 100))}%`, top: -38 }}>
            {sel.label}: {labelA} {formatValue(sel.a)} · {labelB} {formatValue(sel.b)}
          </div>
        )}
      </div>
      <div className="chart-axis">
        {data.map((d, i) => (
          <span key={i} style={{ flex: 1, textAlign: 'center', visibility: i % every === 0 ? 'visible' : 'hidden' }}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface DonutSlice {
  value: number;
  color: string;
  label: string;
}

export function Donut({ slices, size = 150, thickness = 18, children, label }: { slices: DonutSlice[]; size?: number; thickness?: number; children?: ReactNode; label: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'var(--surface-3)' }} strokeWidth={thickness} />
        {total > 0 &&
          slices.map((s, i) => {
            const len = (s.value / total) * c;
            const gap = slices.length > 1 ? Math.min(3, len * 0.3) : 0;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                style={{ stroke: s.color }}
                strokeWidth={thickness}
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>{children}</div>
    </div>
  );
}

export interface CandleDatum {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export function CandleChart({ data, height = 200, formatValue, formatTime, label }: { data: CandleDatum[]; height?: number; formatValue: (v: number) => string; formatTime: (t: number) => string; label: string }) {
  const { ref, idx, handlers } = useHover(data.length);
  const W = 360;
  const H = height;
  const [min, max] = extent(data.flatMap((d) => [d.h, d.l]));
  const y = (v: number) => H - 6 - ((v - min) / (max - min)) * (H - 14);
  const slot = W / Math.max(1, data.length);
  const bw = Math.max(1.5, slot * 0.62);
  const sel = idx !== null ? data[idx] : null;
  return (
    <div className="chart" ref={ref} {...handlers} style={{ height }} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }}>
        {data.map((d, i) => {
          const cx = slot * i + slot / 2;
          const up = d.c >= d.o;
          const col = up ? 'var(--positive)' : 'var(--negative)';
          const top = y(Math.max(d.o, d.c));
          const bot = y(Math.min(d.o, d.c));
          return (
            <g key={i} opacity={idx !== null && idx !== i ? 0.45 : 1}>
              <line x1={cx} x2={cx} y1={y(d.h)} y2={y(d.l)} style={{ stroke: col }} strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <rect x={cx - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} style={{ fill: col }} />
            </g>
          );
        })}
      </svg>
      {sel && idx !== null && (
        <div className="chart-tip" style={{ left: `${Math.min(78, Math.max(22, ((idx + 0.5) / data.length) * 100))}%`, top: -38 }}>
          {formatTime(sel.t)} · O {formatValue(sel.o)} H {formatValue(sel.h)} L {formatValue(sel.l)} C {formatValue(sel.c)}
        </div>
      )}
    </div>
  );
}
