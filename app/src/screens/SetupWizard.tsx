import { ChevronLeft, ShieldCheck } from 'lucide-react';
import { useLayoutEffect, useState } from 'react';
import { CURRENCIES, PRIMARY_CURRENCIES, type CurrencyCode } from '../domain/currency';
import { parseAmount } from '../domain/money';
import { createInitialState, localBalance, PRESETS, usernameFrom } from '../domain/presets';
import type { AccentName, Card, CardStyle, PresetId, ThemeMode } from '../domain/types';
import { validateName } from '../domain/validation';
import { finishSetup } from '../state/store';
import { toast, useBackInterceptor } from '../state/ui';
import { STYLE_NAME, STYLE_ORDER } from '../ui/cardStyles';
import { LogoMark } from '../ui/components/Brand';
import { DemoCard, MaterialSwatch } from '../ui/components/DemoCard';
import { CurrencyBadge } from '../ui/components/Glyphs';
import { AmountDisplay, Keypad } from '../ui/components/Keypad';
import { Button, Field, Notice, Segmented, Steps, TextInput, ToggleRow } from '../ui/components/primitives';
import { applyTheme, useResolvedTheme } from '../ui/themeRuntime';
import { ACCENT_LABEL, ACCENT_NAMES } from '../ui/tokens';
import { formatMoney } from '../domain/money';

interface Choices {
  preset: PresetId;
  name: string;
  currency: CurrencyCode;
  theme: ThemeMode;
  accent: AccentName;
  balanceText: string;
  cardStyle: CardStyle;
  sample: boolean;
  market: boolean;
  liveRates: boolean;
}

const STEP_TITLES = ['Choose a starting point', 'What should we call you?', 'Main currency', 'Look & feel', 'Starting balance', 'Your first demo card', 'Extras', 'Ready'];

function previewCard(style: CardStyle, name: string): Card {
  return {
    id: 'preview',
    nickname: 'Everyday',
    holderName: (name || 'ALEX MORGAN').toUpperCase().slice(0, 26),
    issuerName: 'VELTRIX',
    style,
    customFrom: '#1e293b',
    customTo: '#0f766e',
    accent: '#2dd4a7',
    pattern: style === 'carbon' ? 'grid' : style === 'pearl' ? 'dots' : style === 'glacier' || style === 'aurora' ? 'waves' : 'lines',
    network: 'vx',
    kind: 'debit',
    accountId: 'acc_main',
    displayDigits: '2048',
    expiry: '09/30',
    showExpiry: true,
    spendLimit: 0,
    spendOverride: null,
    status: 'active',
    order: 0,
    createdAt: '',
  };
}

export function SetupWizard() {
  const [step, setStep] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [c, setC] = useState<Choices>({
    preset: 'everyday',
    name: '',
    currency: 'USD',
    theme: 'system',
    accent: 'mint',
    balanceText: '',
    cardStyle: 'obsidian',
    sample: true,
    market: true,
    liveRates: false,
  });
  const patch = (p: Partial<Choices>) => setC((x) => ({ ...x, ...p }));
  const resolved = useResolvedTheme(c.theme);
  useLayoutEffect(() => applyTheme(resolved, c.accent, 'full', c.theme), [resolved, c.accent, c.theme]);
  useBackInterceptor(() => {
    if (step >= 0) {
      setStep((s) => s - 1);
      return true;
    }
    return false;
  });

  const preset = PRESETS.find((p) => p.id === c.preset)!;
  const dec = CURRENCIES[c.currency].decimals;
  const presetBalance = localBalance(preset.mainUsd, c.currency);
  const parsedBal = c.balanceText ? parseAmount(c.balanceText, dec, { allowZero: true }) : null;
  const balanceError = parsedBal && !parsedBal.ok ? 'Enter a valid amount' : null;
  const nameError = c.name.trim() ? validateName(c.name, 'Name') : null;

  const create = (skip = false) => {
    if (busy) return;
    setBusy(true);
    // Let the button state paint before the (synchronous) generation runs.
    setTimeout(() => {
      try {
        const state = createInitialState(
          skip
            ? { preset: 'everyday', displayName: 'Alex Morgan', currency: 'USD', theme: c.theme, accent: c.accent, startingBalance: null, cardStyle: 'obsidian', sampleTransactions: true, marketDemo: true, now: new Date() }
            : {
                preset: c.preset,
                displayName: c.name.trim() || 'Alex Morgan',
                username: usernameFrom(c.name.trim() || 'Alex Morgan'),
                currency: c.currency,
                theme: c.theme,
                accent: c.accent,
                startingBalance: parsedBal && parsedBal.ok ? parsedBal.minor : null,
                cardStyle: c.cardStyle,
                sampleTransactions: c.preset !== 'sandbox' && c.sample,
                marketDemo: c.market,
                liveRates: c.liveRates,
                now: new Date(),
              },
        );
        finishSetup(state);
      } catch (e) {
        setBusy(false);
        toast('Setup failed — please try again', 'error');
        console.error('setup failed', e instanceof Error ? e.message : '');
      }
    }, 30);
  };

  if (step === -1) {
    return (
      <div className="screen no-nav">
        <div className="scroll" style={{ display: 'flex', flexDirection: 'column', paddingTop: 'calc(var(--safe-top) + 40px)' }}>
          <div className="center">
            <div style={{ display: 'inline-block' }}>
              <LogoMark size={76} />
            </div>
            <h1 style={{ letterSpacing: '0.28em', fontSize: 26, margin: '18px 0 6px' }}>VELTRIX</h1>
            <p className="muted" style={{ margin: 0, fontSize: 17 }}>
              Your Money. Your Universe.
            </p>
          </div>
          <div style={{ margin: '28px 4px 0' }}>
            <DemoCard card={previewCard('obsidian', 'Alex Morgan')} />
          </div>
          <div className="panel pad" style={{ marginTop: 26 }}>
            <div className="hstack" style={{ alignItems: 'flex-start' }}>
              <ShieldCheck size={22} style={{ color: 'var(--accent-text)', flexShrink: 0 }} />
              <div className="small" style={{ lineHeight: 1.55 }}>
                <b>A realistic fintech simulator.</b> Balances, cards, transfers, credit and trades are fictional and stored only on this device. Nothing connects to a bank, card network or broker, and no real money can move.
              </div>
            </div>
          </div>
          <div className="stack" style={{ marginTop: 'auto', paddingTop: 26 }}>
            <Button block onClick={() => setStep(0)}>
              Set up my simulator
            </Button>
            <Button block variant="ghost" onClick={() => create(true)} disabled={busy}>
              {busy ? 'Creating…' : 'Skip — use the Everyday demo'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const last = STEP_TITLES.length - 1;
  const canNext = !(step === 1 && nameError) && !(step === 4 && balanceError);
  return (
    <div className="screen no-nav">
      <header className="topbar">
        <div className="topbar-side">
          <button className="icon-btn" aria-label="Back" onClick={() => setStep(step - 1)}>
            <ChevronLeft size={24} />
          </button>
        </div>
        <div className="topbar-title">{STEP_TITLES[step]}</div>
        <div className="topbar-side end">
          {step < last && (
            <button className="link-btn" onClick={() => setStep(last)}>
              Skip
            </button>
          )}
        </div>
      </header>
      <Steps count={STEP_TITLES.length} current={step} />
      <div className="scroll">
        {step === 0 && (
          <div className="stack" style={{ marginTop: 8 }}>
            {PRESETS.map((p) => (
              <button key={p.id} className="wizard-option" aria-pressed={c.preset === p.id} onClick={() => patch({ preset: p.id, sample: p.id !== 'sandbox' })}>
                <span className="radio-dot" />
                <span style={{ flex: 1 }}>
                  <span className="strong" style={{ display: 'block' }}>
                    {p.name}
                  </span>
                  <span className="small muted" style={{ display: 'block', marginTop: 2 }}>
                    {p.description}
                  </span>
                  <span className="xsmall faint" style={{ display: 'block', marginTop: 6 }}>
                    {p.highlights.join(' · ')}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        {step === 1 && (
          <div style={{ marginTop: 12 }}>
            <Field label="Display name" error={nameError} hint={`Your fictional username will be @${usernameFrom(c.name.trim() || 'Alex Morgan')}`}>
              <TextInput value={c.name} onChange={(v) => patch({ name: v })} placeholder="Alex Morgan" autoFocus maxLength={40} autoCapitalize="words" onEnter={() => canNext && setStep(2)} />
            </Field>
            <Notice>Any name works — it’s only shown inside the simulator and on your demo cards.</Notice>
          </div>
        )}
        {step === 2 && (
          <div className="list" style={{ marginTop: 8 }}>
            {PRIMARY_CURRENCIES.map((cur) => (
              <button key={cur} className="row" onClick={() => patch({ currency: cur, balanceText: '' })} aria-pressed={c.currency === cur}>
                <CurrencyBadge code={cur} />
                <div className="row-main">
                  <div className="row-title">{CURRENCIES[cur].name}</div>
                  <div className="row-sub">
                    {cur} · {CURRENCIES[cur].symbol}
                  </div>
                </div>
                {c.currency === cur && <span className="badge badge-accent">Selected</span>}
              </button>
            ))}
          </div>
        )}
        {step === 3 && (
          <div style={{ marginTop: 8 }}>
            <Field label="Theme">
              <Segmented
                value={c.theme}
                onChange={(v) => patch({ theme: v })}
                label="Theme"
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'system', label: 'System' },
                ]}
              />
            </Field>
            <Field label="Accent">
              <div className="swatches">
                {ACCENT_NAMES.map((a) => (
                  <button key={a} className="swatch" data-theme={resolved} data-accent={a} aria-pressed={c.accent === a} aria-label={ACCENT_LABEL[a]} style={{ background: 'var(--accent)' }} onClick={() => patch({ accent: a })} />
                ))}
              </div>
            </Field>
            <div className="panel pad">
              <div className="small muted">Preview</div>
              <div className="strong amount" style={{ fontSize: 28, margin: '4px 0 12px' }}>
                {formatMoney(presetBalance, c.currency)}
              </div>
              <Button block>Primary action</Button>
            </div>
          </div>
        )}
        {step === 4 && (
          <div style={{ marginTop: 4 }}>
            <p className="muted small center" style={{ margin: '0 0 6px' }}>
              Main wallet balance (simulated). Leave empty to use the preset’s {formatMoney(presetBalance, c.currency)}.
            </p>
            <div className="amount-entry">
              {c.balanceText ? <AmountDisplay text={c.balanceText} currency={c.currency} locale="en-US" invalid={!!balanceError} /> : <div className="amount-hero amount is-empty">{formatMoney(presetBalance, c.currency)}</div>}
              <div className="small" style={{ minHeight: 20 }}>
                {balanceError ? <span className="neg">{balanceError}</span> : c.balanceText ? <button className="link-btn" onClick={() => patch({ balanceText: '' })}>Use preset default</button> : <span className="faint">Preset default</span>}
              </div>
            </div>
            <Keypad value={c.balanceText} onChange={(v) => patch({ balanceText: v })} currency={c.currency} />
          </div>
        )}
        {step === 5 && (
          <div style={{ marginTop: 4 }}>
            <div style={{ padding: '4px 18px 18px' }}>
              <DemoCard card={previewCard(c.cardStyle, c.name)} />
            </div>
            <div className="style-grid">
              {STYLE_ORDER.filter((s) => s !== 'custom').map((s) => (
                <button key={s} className="style-opt" aria-pressed={c.cardStyle === s} onClick={() => patch({ cardStyle: s })}>
                  <MaterialSwatch card={{ style: s, customFrom: '#1e293b', customTo: '#0f766e' }} />
                  {STYLE_NAME[s]}
                </button>
              ))}
            </div>
            <p className="disclaimer">You can design more cards (including a fully custom one) in the card studio later.</p>
          </div>
        )}
        {step === 6 && (
          <div className="list" style={{ marginTop: 8 }}>
            <ToggleRow title="Sample transactions" sub={c.preset === 'sandbox' ? 'Not available for the empty sandbox' : 'Three months of realistic fictional activity'} checked={c.preset !== 'sandbox' && c.sample} disabled={c.preset === 'sandbox'} onChange={(v) => patch({ sample: v })} />
            <ToggleRow title="Market demo" sub="Simulated prices, watchlist and practice trading" checked={c.market} onChange={(v) => patch({ market: v })} />
            <ToggleRow title="Live indicative FX rates" sub="Optional. Downloads public indicative rates (ExchangeRate-API). Off = bundled demo rates, fully offline." checked={c.liveRates} onChange={(v) => patch({ liveRates: v })} />
          </div>
        )}
        {step === 7 && (
          <div style={{ marginTop: 8 }}>
            <div className="panel pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
              {[
                ['Preset', preset.name],
                ['Name', c.name.trim() || 'Alex Morgan'],
                ['Currency', c.currency],
                ['Theme', `${c.theme[0].toUpperCase()}${c.theme.slice(1)} · ${ACCENT_LABEL[c.accent]}`],
                ['Main wallet', formatMoney(parsedBal && parsedBal.ok ? parsedBal.minor : presetBalance, c.currency)],
                ['Card', STYLE_NAME[c.cardStyle]],
                ['Sample data', c.preset !== 'sandbox' && c.sample ? 'Yes' : 'No'],
                ['Market demo', c.market ? 'On' : 'Off'],
                ['FX rates', c.liveRates ? 'Live indicative (optional download)' : 'Bundled demo rates'],
              ].map(([k, v]) => (
                <div key={k} className="kv">
                  <span>{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
            <p className="disclaimer">Everything can be changed later in Settings. Reset Demo returns you here.</p>
          </div>
        )}
      </div>
      <div className="footer-bar">
        {step < last ? (
          <Button block onClick={() => setStep(step + 1)} disabled={!canNext}>
            Continue
          </Button>
        ) : (
          <Button block onClick={() => create(false)} disabled={busy}>
            {busy ? 'Creating your universe…' : 'Create my simulator'}
          </Button>
        )}
      </div>
    </div>
  );
}
