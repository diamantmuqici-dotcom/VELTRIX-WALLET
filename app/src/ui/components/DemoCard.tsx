import { useId, type ReactElement } from 'react';
import type { Card, CardPattern } from '../../domain/types';
import { cardGradient } from '../cardStyles';
import { NetworkMark } from './Brand';

/** Frost layer colors for the "frozen" state (part of the card material system). */
const FROST = { light: '#ffffff', dark: '#0a0e16' };
const CHIP = {
  gold: ['#f6e3a1', '#d4b062', '#a8843c'],
  silver: ['#f1f3f6', '#c5cbd4', '#8f97a3'],
};

const W = 856;
const H = 540;

function patternPaths(pattern: CardPattern, ink: string, accent: string, uid: string): ReactElement | null {
  switch (pattern) {
    case 'lines': {
      const d: string[] = [];
      for (let x = -540; x < W + 540; x += 24) d.push(`M${x} 0 L${x + 540} ${H}`);
      return <path d={d.join(' ')} stroke={ink} strokeWidth="1.2" opacity="0.07" />;
    }
    case 'waves': {
      const paths = [];
      for (let i = 0; i < 9; i++) {
        const y = 90 + i * 46;
        paths.push(<path key={i} d={`M-20 ${y} C 180 ${y - 60}, 360 ${y + 60}, 560 ${y} S 900 ${y - 50}, 900 ${y}`} fill="none" stroke={ink} strokeWidth="1.4" opacity={0.05 + (i % 3) * 0.02} />);
      }
      return <g>{paths}</g>;
    }
    case 'grid': {
      const d: string[] = [];
      for (let x = 0; x <= W; x += 34) d.push(`M${x} 0 V${H}`);
      for (let y = 0; y <= H; y += 34) d.push(`M0 ${y} H${W}`);
      return <path d={d.join(' ')} stroke={ink} strokeWidth="1" opacity="0.05" />;
    }
    case 'topo': {
      const rings = [];
      for (let i = 1; i <= 12; i++) rings.push(<ellipse key={i} cx={720} cy={90} rx={i * 52} ry={i * 34} fill="none" stroke={ink} strokeWidth="1.3" opacity="0.06" />);
      return <g>{rings}</g>;
    }
    case 'dots': {
      const dots = [];
      for (let x = 430; x < W; x += 26) for (let y = 14; y < H; y += 26) dots.push(<circle key={`${x}-${y}`} cx={x} cy={y} r={2.1} fill={ink} opacity={0.04 + ((x - 430) / 430) * 0.1} />);
      return <g>{dots}</g>;
    }
    case 'mesh':
      return (
        <g>
          <radialGradient id={`${uid}m1`} cx="0.85" cy="0.1" r="0.6">
            <stop offset="0" stopColor={accent} stopOpacity="0.42" />
            <stop offset="1" stopColor={accent} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}m2`} cx="0.1" cy="1" r="0.7">
            <stop offset="0" stopColor={accent} stopOpacity="0.25" />
            <stop offset="1" stopColor={accent} stopOpacity="0" />
          </radialGradient>
          <rect width={W} height={H} fill={`url(#${uid}m1)`} />
          <rect width={W} height={H} fill={`url(#${uid}m2)`} />
        </g>
      );
    default:
      return null;
  }
}

export function DemoCard({ card, animate, className, label }: { card: Card; animate?: boolean; className?: string; label?: string }) {
  const raw = useId();
  const uid = `c${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
  const m = cardGradient(card);
  const chip = CHIP[m.chip];
  const kindLabel = card.kind === 'credit' ? 'CREDIT' : card.kind === 'prepaid' ? 'PREPAID' : 'DEBIT';
  const issuer = (card.issuerName || 'VELTRIX').toUpperCase().slice(0, 22);
  const holder = (card.holderName || '').toUpperCase().slice(0, 26);
  const frozen = card.status === 'frozen';
  const desc = `${label ?? card.nickname}: fictional ${kindLabel.toLowerCase()} demo card ending ${card.displayDigits}${frozen ? ', frozen' : ''}. Not a real payment card.`;
  return (
    <div className={`card-wrap${className ? ` ${className}` : ''}`}>
      <div className="card-ratio">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={desc}>
          <defs>
            <clipPath id={`${uid}clip`}>
              <rect width={W} height={H} rx="40" />
            </clipPath>
            <linearGradient id={`${uid}bg`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={m.from} />
              <stop offset="0.55" stopColor={m.via} />
              <stop offset="1" stopColor={m.to} />
            </linearGradient>
            <radialGradient id={`${uid}hl`} cx="0.12" cy="0" r="0.9">
              <stop offset="0" stopColor={FROST.light} stopOpacity={m.light ? 0.5 : 0.16} />
              <stop offset="0.6" stopColor={FROST.light} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}sheen`} x1="0" y1="0" x2="1" y2="0.35">
              <stop offset="0.3" stopColor={FROST.light} stopOpacity="0" />
              <stop offset="0.5" stopColor={FROST.light} stopOpacity={m.light ? 0.28 : 0.1} />
              <stop offset="0.7" stopColor={FROST.light} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}chip`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={chip[0]} />
              <stop offset="0.5" stopColor={chip[1]} />
              <stop offset="1" stopColor={chip[2]} />
            </linearGradient>
          </defs>
          <g clipPath={`url(#${uid}clip)`}>
            <rect width={W} height={H} fill={`url(#${uid}bg)`} />
            {patternPaths(card.pattern, m.ink, card.accent, uid)}
            {card.style === 'neon' && (
              <g opacity="0.75">
                <path d={`M-40 ${H - 120} L ${W + 40} ${H - 300}`} stroke={card.accent} strokeWidth="3" />
                <path d={`M-40 ${H - 96} L ${W + 40} ${H - 276}`} stroke={card.accent} strokeWidth="1.2" opacity="0.6" />
              </g>
            )}
            <rect width={W} height={H} fill={`url(#${uid}hl)`} />
            <rect x={-W * 0.5} width={W * 2} height={H} fill={`url(#${uid}sheen)`} className={animate ? 'sheen' : undefined} />
            {/* accent rule + issuer */}
            <rect x="64" y="58" width="6" height="36" rx="3" fill={card.accent} />
            <text x="84" y="88" fill={m.ink} fontSize="30" fontWeight="800" letterSpacing="5">
              {issuer}
            </text>
            {/* DEMO CARD label — always visible */}
            <g>
              <rect x={W - 254} y="52" width="194" height="46" rx="23" fill={m.ink} fillOpacity="0.14" stroke={m.ink} strokeOpacity="0.55" strokeWidth="2" />
              <text x={W - 157} y="83" textAnchor="middle" fill={m.ink} fontSize="21" fontWeight="800" letterSpacing="3">
                DEMO CARD
              </text>
            </g>
            {/* chip */}
            <g transform="translate(70 196)">
              <rect width="112" height="86" rx="16" fill={`url(#${uid}chip)`} />
              <path d="M0 30 H38 M0 56 H38 M74 30 H112 M74 56 H112 M38 0 V86 M74 0 V86 M38 43 H74" stroke={chip[2]} strokeWidth="2.4" fill="none" opacity="0.8" />
              <rect x="38" y="22" width="36" height="42" rx="7" fill="none" stroke={chip[2]} strokeWidth="2.4" opacity="0.8" />
            </g>
            <text x={W - 64} y="250" textAnchor="end" fill={m.ink2} fontSize="20" fontWeight="700" letterSpacing="4">
              {kindLabel}
            </text>
            {/* display digits only — never a full card number */}
            <text x="70" y="388" fill={m.ink} fontSize="40" fontWeight="600" letterSpacing="5" style={{ fontVariantNumeric: 'tabular-nums' }}>
              •••• {card.displayDigits}
            </text>
            {card.showExpiry && card.expiry && (
              <g>
                <text x="436" y="374" fill={m.ink2} fontSize="15" fontWeight="700" letterSpacing="2">
                  EXP
                </text>
                <text x="436" y="398" fill={m.ink} fontSize="24" fontWeight="600" letterSpacing="2">
                  {card.expiry}
                </text>
              </g>
            )}
            <text x="70" y="474" fill={m.ink} fontSize="27" fontWeight="650" letterSpacing="2.5">
              {holder}
            </text>
            <NetworkMark network={card.network} ink={m.ink} x={W - 190} y={418} w={124} />
            {frozen && (
              <g>
                <rect width={W} height={H} fill={m.light ? FROST.light : FROST.dark} opacity="0.62" />
                <g transform={`translate(${W / 2} ${H / 2 - 18})`} stroke={m.light ? FROST.dark : FROST.light} strokeWidth="6" strokeLinecap="round" fill="none">
                  {[0, 60, 120].map((a) => (
                    <path key={a} d="M0 -46 V46 M-14 -34 L0 -22 L14 -34 M-14 34 L0 22 L14 34" transform={`rotate(${a})`} />
                  ))}
                </g>
                <text x={W / 2} y={H / 2 + 76} textAnchor="middle" fill={m.light ? FROST.dark : FROST.light} fontSize="30" fontWeight="800" letterSpacing="6">
                  FROZEN
                </text>
              </g>
            )}
          </g>
          <rect x="1" y="1" width={W - 2} height={H - 2} rx="39" fill="none" stroke={FROST.light} strokeOpacity={m.light ? 0.5 : 0.12} strokeWidth="2" />
        </svg>
      </div>
    </div>
  );
}

/** Tiny material swatch used in pickers. */
export function MaterialSwatch({ card }: { card: Pick<Card, 'style' | 'customFrom' | 'customTo'> }) {
  const m = cardGradient(card);
  return <span className="sw" style={{ background: `linear-gradient(135deg, ${m.from}, ${m.via} 55%, ${m.to})` }} />;
}
