import type { CardNetwork } from '../../domain/types';

/** VELTRIX logo mark: an original geometric "V" made of two facets. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="18" fill="var(--surface-inverse)" />
      <path d="M17 19h8.5L32 37.5 38.5 19H47L35.6 46h-7.2z" fill="var(--bg)" />
      <path d="M38.5 19H47l-4 9.5h-8.3z" fill="var(--accent)" />
    </svg>
  );
}

export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <span className="wordmark" aria-label="VELTRIX">
      <LogoMark size={size * 1.9} />
      <span style={{ fontSize: size, fontWeight: 800, letterSpacing: '0.24em' }} aria-hidden="true">
        VELTRIX
      </span>
    </span>
  );
}

/**
 * Original, generic "network" marks for demo cards. None of them resembles a
 * real payment network logo. Drawn in the card's ink color.
 */
export function NetworkMark({ network, ink, x, y, w }: { network: CardNetwork; ink: string; x: number; y: number; w: number }) {
  const h = w * 0.62;
  switch (network) {
    case 'vx':
      return (
        <g transform={`translate(${x} ${y})`} aria-label="VX network style (fictional)">
          <path d={`M0 0 L${w * 0.22} 0 L${w * 0.38} ${h * 0.62} L${w * 0.54} 0 L${w * 0.76} 0 L${w * 0.48} ${h} L${w * 0.28} ${h} Z`} fill={ink} opacity="0.92" />
          <path d={`M${w * 0.62} ${h} L${w * 0.82} ${h * 0.25} L${w} ${h * 0.25} L${w * 0.8} ${h} Z`} fill={ink} opacity="0.5" />
        </g>
      );
    case 'orbit':
      return (
        <g transform={`translate(${x} ${y})`} aria-label="Orbit network style (fictional)">
          <circle cx={w * 0.5} cy={h * 0.5} r={h * 0.3} fill={ink} opacity="0.9" />
          <ellipse cx={w * 0.5} cy={h * 0.5} rx={w * 0.5} ry={h * 0.2} fill="none" stroke={ink} strokeWidth={h * 0.07} opacity="0.65" transform={`rotate(-18 ${w * 0.5} ${h * 0.5})`} />
        </g>
      );
    case 'nexa':
      return (
        <g transform={`translate(${x} ${y})`} aria-label="Nexa network style (fictional)">
          {[0, 1, 2].map((i) => (
            <rect key={i} x={w * (0.08 + i * 0.3)} y={h * (0.55 - i * 0.22)} width={w * 0.24} height={h * (0.45 + i * 0.22)} rx={w * 0.04} fill={ink} opacity={0.45 + i * 0.22} />
          ))}
        </g>
      );
    default:
      return (
        <text x={x + w} y={y + h * 0.72} textAnchor="end" fill={ink} fontSize={h * 0.42} fontWeight={800} letterSpacing="3" opacity="0.85">
          DEMO
        </text>
      );
  }
}

export const NETWORK_NAME: Record<CardNetwork, string> = {
  vx: 'VX (fictional)',
  orbit: 'Orbit (fictional)',
  nexa: 'Nexa (fictional)',
  neutral: 'Neutral',
};
