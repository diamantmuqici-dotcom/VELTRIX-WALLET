const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

export const csvFileName = () => `veltrix-SIMULATED-ledger-${stamp()}.csv`;
export const backupFileName = () => `veltrix-simulator-backup-${stamp()}.json`;
export const rawFileName = () => `veltrix-unreadable-save-${stamp()}.json`;
