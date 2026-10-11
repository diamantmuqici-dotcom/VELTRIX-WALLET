import { Copy } from 'lucide-react';
import { useState } from 'react';
import { CALC_INITIAL, calcPress, type CalcKey } from '../domain/calculator';
import { copyText } from '../platform/bridge';
import { openSheet, toast } from '../state/ui';
import { SheetHeader } from '../ui/components/pickers';
import { tap } from '../ui/components/primitives';
import { useFmt } from '../ui/components/Money';

const ROWS: CalcKey[][] = [
  ['C', 'back', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['±', '0', '.', '='],
];

const LABEL: Partial<Record<CalcKey, string>> = { back: 'Delete', C: 'Clear', '±': 'Change sign', '%': 'Percent', '÷': 'Divide', '×': 'Multiply', '−': 'Subtract', '+': 'Add', '=': 'Equals', '.': 'Decimal point' };

/** Formats the decimal string with the user's grouping without going through floating point. */
function display(entry: string, locale: string): string {
  const neg = entry.startsWith('-');
  const body = neg ? entry.slice(1) : entry;
  const [int, frac] = body.split('.');
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(BigInt(int || '0'));
  const sep = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';
  return `${neg ? '−' : ''}${grouped}${frac !== undefined ? sep + frac : ''}`;
}

function CalculatorBody({ close }: { close: () => void }) {
  const f = useFmt();
  const [s, setS] = useState(CALC_INITIAL);
  const press = (k: CalcKey) => {
    tap('tap');
    setS((x) => calcPress(x, k));
  };
  return (
    <>
      <SheetHeader title="Calculator" onClose={close} />
      <div className="sheet-body">
        <div className="panel pad" style={{ textAlign: 'right', marginBottom: 12 }}>
          <div className="small faint" style={{ minHeight: 18 }}>{s.expr}</div>
          <div className="amount" style={{ fontSize: 40, fontWeight: 650, letterSpacing: '-0.03em', overflowWrap: 'anywhere', whiteSpace: 'normal' }} aria-live="polite">
            {s.error ?? display(s.entry, f.locale)}
          </div>
        </div>
        <div className="keypad" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {ROWS.flat().map((k) => (
            <button
              key={k}
              type="button"
              className="key"
              aria-label={LABEL[k] ?? k}
              style={{
                height: 60,
                fontSize: k === 'back' || k === 'C' ? 18 : 26,
                background: k === '=' ? 'var(--accent)' : /[÷×−+]/.test(k) ? 'var(--accent-soft)' : 'var(--surface-2)',
                color: k === '=' ? 'var(--accent-ink)' : /[÷×−+]/.test(k) ? 'var(--accent-text)' : 'var(--text)',
              }}
              onClick={() => press(k)}
            >
              {k === 'back' ? '⌫' : k}
            </button>
          ))}
        </div>
        <p className="disclaimer">Decimal-exact arithmetic (0.1 + 0.2 = 0.3). Results are rounded to 10 decimal places.</p>
      </div>
      <div className="sheet-foot">
        <button
          className="btn btn-secondary btn-block"
          disabled={!!s.error}
          onClick={async () => {
            const ok = await copyText(s.entry);
            toast(ok ? 'Result copied' : 'Could not copy', ok ? 'success' : 'error');
          }}
        >
          <Copy size={18} /> Copy result
        </button>
      </div>
    </>
  );
}

export function openCalculator(): void {
  openSheet((close) => <CalculatorBody close={close} />, { tall: true, title: 'Calculator' });
}
