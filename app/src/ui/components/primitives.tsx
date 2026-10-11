import { ChevronLeft, ChevronRight, Info, TriangleAlert, X, CircleAlert } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, type ReactNode, type CSSProperties } from 'react';
import { haptic } from '../../platform/bridge';
import { getSnapshot } from '../../state/store';
import { nav, type Route } from '../../state/ui';

/* --------------------------- Screen context ------------------------- */

export interface ScreenInfo {
  route: Route;
  visible: boolean;
  hasNav: boolean;
}

export const ScreenContext = createContext<ScreenInfo>({ route: { key: '', name: 'home', params: {} }, visible: true, hasNav: true });

export function useScreen(): ScreenInfo {
  return useContext(ScreenContext);
}

export function tap(kind: 'tap' | 'select' | 'success' | 'warning' | 'error' = 'tap'): void {
  if (getSnapshot().app?.settings.haptics !== false) haptic(kind);
}

/* ------------------------------ Layout ------------------------------ */

export function TopBar({
  title,
  back = true,
  onBack,
  right,
  bordered,
}: {
  title?: ReactNode;
  back?: boolean;
  onBack?: () => void;
  right?: ReactNode;
  bordered?: boolean;
}) {
  return (
    <header className={`topbar${bordered ? ' bordered' : ''}`}>
      <div className="topbar-side">
        {back && (
          <button className="icon-btn" aria-label="Back" onClick={() => (onBack ? onBack() : nav.pop())}>
            <ChevronLeft size={24} />
          </button>
        )}
      </div>
      <h1 className="topbar-title">{title}</h1>
      <div className="topbar-side end">{right}</div>
    </header>
  );
}

/** Standard pushed screen: top bar, scrolling body and optional sticky footer. */
export function Page({
  title,
  right,
  children,
  footer,
  onBack,
  back = true,
  scrollRef,
  bordered,
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onBack?: () => void;
  back?: boolean;
  scrollRef?: React.Ref<HTMLDivElement>;
  bordered?: boolean;
}) {
  return (
    <>
      <TopBar title={title} right={right} onBack={onBack} back={back} bordered={bordered} />
      <div className="scroll" ref={scrollRef}>
        {children}
      </div>
      {footer && <div className="footer-bar">{footer}</div>}
    </>
  );
}

export function Section({ title, action, children, className, id }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`section${className ? ` ${className}` : ''}`} id={id}>
      {(title || action) && (
        <div className="section-head">
          {title ? <h2 className="section-title">{title}</h2> : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/* ------------------------------ Controls ---------------------------- */

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'solid-danger';

export function Button({
  children,
  onClick,
  variant = 'primary',
  size,
  block,
  disabled,
  type = 'button',
  icon,
  ariaLabel,
  className,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  size?: 'sm';
  block?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  icon?: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant}${size ? ` btn-${size}` : ''}${block ? ' btn-block' : ''}${className ? ` ${className}` : ''}`}
      onClick={() => {
        if (disabled) return;
        tap();
        onClick?.();
      }}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({ label, onClick, children, filled, badge }: { label: string; onClick: () => void; children: ReactNode; filled?: boolean; badge?: number }) {
  return (
    <button
      className={`icon-btn${filled ? ' filled' : ''}`}
      aria-label={badge ? `${label} (${badge} unread)` : label}
      onClick={() => {
        tap();
        onClick();
      }}
    >
      {children}
      {!!badge && <span className="dot">{badge > 9 ? '9+' : badge}</span>}
    </button>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => {
        tap('select');
        onChange(!checked);
      }}
    />
  );
}

export function Segmented<T extends string>({ value, options, onChange, small, label }: { value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (v: T) => void; small?: boolean; label?: string }) {
  return (
    <div className={`seg${small ? ' small' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => {
            if (o.value !== value) tap('select');
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ children, pressed, onClick, count, icon }: { children: ReactNode; pressed?: boolean; onClick: () => void; count?: number; icon?: ReactNode }) {
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={pressed}
      onClick={() => {
        tap('select');
        onClick();
      }}
    >
      {icon}
      {children}
      {!!count && <span className="count">{count}</span>}
    </button>
  );
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'sim' | 'pos' | 'neg' | 'info' | 'muted' | 'accent' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function SimBadge({ label = 'Simulated' }: { label?: string }) {
  return <Badge tone="sim">{label}</Badge>;
}

/* ------------------------------- Rows ------------------------------- */

export function Row({
  icon,
  title,
  sub,
  end,
  endSub,
  onClick,
  chevron,
  children,
  ariaLabel,
}: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  end?: ReactNode;
  endSub?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  children?: ReactNode;
  ariaLabel?: string;
}) {
  const body = (
    <>
      {icon}
      <div className="row-main">
        <div className="row-title">{title}</div>
        {sub && <div className="row-sub">{sub}</div>}
      </div>
      {(end !== undefined || endSub) && (
        <div className="row-end">
          {end !== undefined && <div className="row-title">{end}</div>}
          {endSub && <div className="row-sub">{endSub}</div>}
        </div>
      )}
      {children}
      {chevron && <ChevronRight size={18} className="row-chevron" />}
    </>
  );
  if (!onClick) return <div className="row">{body}</div>;
  return (
    <button
      type="button"
      className="row"
      aria-label={ariaLabel}
      onClick={() => {
        tap();
        onClick();
      }}
    >
      {body}
    </button>
  );
}

export function ToggleRow({ title, sub, checked, onChange, icon, disabled }: { title: ReactNode; sub?: ReactNode; checked: boolean; onChange: (v: boolean) => void; icon?: ReactNode; disabled?: boolean }) {
  return (
    <div className="row">
      {icon}
      <div className="row-main">
        <div className="row-title">{title}</div>
        {sub && <div className="row-sub" style={{ whiteSpace: 'normal' }}>{sub}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={typeof title === 'string' ? title : 'Toggle'} disabled={disabled} />
    </div>
  );
}

export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="kv">
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}

/* ------------------------------ Fields ------------------------------ */

export function Field({ label, hint, error, children, counter }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; counter?: ReactNode }) {
  return (
    <label className="field">
      {(label || counter) && (
        <span className="field-label">
          <span>{label}</span>
          {counter && <span className="faint">{counter}</span>}
        </span>
      )}
      {children}
      {error ? <div className="field-error" role="alert">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  invalid,
  inputMode,
  maxLength,
  autoFocus,
  type = 'text',
  onEnter,
  ariaLabel,
  autoCapitalize,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  inputMode?: 'text' | 'decimal' | 'numeric' | 'email' | 'tel' | 'search';
  maxLength?: number;
  autoFocus?: boolean;
  type?: string;
  onEnter?: () => void;
  ariaLabel?: string;
  autoCapitalize?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocus) return undefined;
    const t = setTimeout(() => ref.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [autoFocus]);
  return (
    <input
      ref={ref}
      className="input"
      type={type}
      value={value}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      aria-label={ariaLabel}
      inputMode={inputMode}
      maxLength={maxLength}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize={autoCapitalize}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

export function TextArea({ value, onChange, placeholder, rows = 3, ariaLabel }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; ariaLabel?: string }) {
  return <textarea className="input" value={value} rows={rows} placeholder={placeholder} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} />;
}

export function SearchInput({ value, onChange, placeholder, autoFocus, icon }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean; icon: ReactNode }) {
  return (
    <div className="input-wrap">
      {icon}
      <TextInput value={value} onChange={onChange} placeholder={placeholder} inputMode="search" autoFocus={autoFocus} ariaLabel={placeholder} />
      {value && (
        <button className="icon-btn clear" aria-label="Clear search" onClick={() => onChange('')}>
          <X size={18} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------ Feedback ---------------------------- */

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-ico">{icon}</div>
      <h3>{title}</h3>
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}

export function Notice({ tone = 'info', children, style }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode; style?: CSSProperties }) {
  const Icon = tone === 'warn' ? TriangleAlert : tone === 'error' ? CircleAlert : Info;
  return (
    <div className={`notice${tone !== 'info' ? ` ${tone}` : ''}`} style={style} role={tone === 'error' ? 'alert' : undefined}>
      <Icon size={18} />
      <div>{children}</div>
    </div>
  );
}

export function ProgressBar({ value, max, tone }: { value: number; max: number; tone?: 'auto' }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const cls = tone === 'auto' ? (value > max ? ' over' : ratio >= 0.85 ? ' warn' : '') : '';
  return (
    <div className={`bar${cls}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
      <i style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

export function Steps({ count, current }: { count: number; current: number }) {
  return (
    <div className="steps" aria-label={`Step ${current + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={i <= current ? 'on' : ''} />
      ))}
    </div>
  );
}
