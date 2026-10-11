import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { closeSheet, dismissToast, resolveDialog, useUI } from '../../state/ui';

export function SheetHost() {
  const { sheets } = useUI();
  return (
    <>
      {sheets.map((s, i) => (
        <div key={s.id} className="layer sheet-layer" style={{ zIndex: 40 + i }}>
          <div className="scrim" onClick={() => closeSheet(s.id)} />
          <div className={`sheet${s.tall ? ' tall' : ''}`} role="dialog" aria-modal="true" aria-label={s.title}>
            <div className="sheet-grip" />
            {s.render(() => closeSheet(s.id))}
          </div>
        </div>
      ))}
    </>
  );
}

export function DialogHost() {
  const { dialog } = useUI();
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (dialog) confirmRef.current?.focus();
  }, [dialog]);
  if (!dialog) return null;
  return (
    <div className="layer dialog-layer">
      <div className="scrim" onClick={() => resolveDialog(false)} />
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-msg">
        <h2 id="dlg-title">{dialog.title}</h2>
        <p id="dlg-msg">{dialog.message}</p>
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={() => resolveDialog(false)}>
            {dialog.cancelLabel ?? 'Cancel'}
          </button>
          <button ref={confirmRef} className={`btn ${dialog.destructive ? 'btn-solid-danger' : 'btn-primary'}`} onClick={() => resolveDialog(true)}>
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ToastHost({ withNav }: { withNav: boolean }) {
  const { toasts } = useUI();
  return (
    <div className={`toasts${withNav ? '' : ' top'}`} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" role={t.tone === 'error' ? 'alert' : 'status'}>
          <span className={`t-ico ${t.tone}`}>{t.tone === 'success' ? <CircleCheck size={18} /> : t.tone === 'error' ? <CircleAlert size={18} /> : <Info size={18} />}</span>
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action?.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
