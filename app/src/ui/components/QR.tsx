import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/**
 * Renders a QR code as SVG. Callers must only pass fictional demo payloads
 * (see ReceiveScreen) — the code never encodes real payment data.
 * Input is restricted to ASCII so the default byte encoding is exact.
 */
export function QRCode({ value, label }: { value: string; label: string }) {
  const { path, size } = useMemo(() => {
    const ascii = value.replace(/[^\x20-\x7e]/g, '');
    const qr = qrcode(0, 'M');
    qr.addData(ascii);
    qr.make();
    const n = qr.getModuleCount();
    const parts: string[] = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) parts.push(`M${c} ${r}h1v1h-1z`);
      }
    }
    return { path: parts.join(''), size: n };
  }, [value]);
  return (
    <svg viewBox={`-2 -2 ${size + 4} ${size + 4}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <path d={path} style={{ fill: 'var(--ink-on-light)' }} />
    </svg>
  );
}
