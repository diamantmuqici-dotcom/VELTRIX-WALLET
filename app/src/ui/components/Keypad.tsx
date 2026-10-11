import { Delete } from 'lucide-react';
import { useEffect } from 'react';
import { CURRENCIES, type CurrencyCode } from '../../domain/currency';
import { formatTypedAmount, keypadInput, type KeypadKey } from '../../domain/money';
import { tap } from './primitives';

const KEYS: KeypadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

/**
 * Custom decimal keypad. The pure `keypadInput` reducer guarantees the text
 * never becomes invalid (single separator, currency precision respected).
 * A hardware keyboard works too (digits, '.', ',', Backspace).
 */
export function Keypad({ value, onChange, currency, active = true }: { value: string; onChange: (v: string) => void; currency: CurrencyCode; active?: boolean }) {
  const decimals = CURRENCIES[currency].decimals;
  const press = (k: KeypadKey) => {
    const next = keypadInput(value, k, decimals);
    if (next !== value) tap('tap');
    onChange(next);
  };
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (/^\d$/.test(e.key)) press(e.key as KeypadKey);
      else if (e.key === '.' || e.key === ',') press('.');
      else if (e.key === 'Backspace') press('back');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="keypad" role="group" aria-label="Amount keypad">
      {KEYS.map((k) =>
        k === '.' && decimals === 0 ? (
          <span key={k} />
        ) : (
          <button
            key={k}
            type="button"
            className="key"
            aria-label={k === 'back' ? 'Delete digit' : k === '.' ? 'Decimal point' : k}
            onClick={() => press(k)}
            onContextMenu={(e) => {
              if (k === 'back') {
                e.preventDefault();
                onChange('');
              }
            }}
          >
            {k === 'back' ? <Delete size={24} /> : k === '.' ? '.' : k}
          </button>
        ),
      )}
    </div>
  );
}

export function AmountDisplay({ text, currency, locale, invalid }: { text: string; currency: CurrencyCode; locale: string; invalid?: boolean }) {
  return (
    <div className={`amount-hero amount${text ? '' : ' is-empty'}${invalid ? ' invalid' : ''}`} aria-live="polite">
      {formatTypedAmount(text, currency, locale)}
    </div>
  );
}
