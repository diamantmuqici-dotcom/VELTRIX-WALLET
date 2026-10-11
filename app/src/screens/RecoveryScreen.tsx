import { FileWarning } from 'lucide-react';
import { useRef } from 'react';
import { loadState } from '../domain/schema';
import { saveTextFile } from '../platform/bridge';
import { corruptCopy } from '../state/persistence';
import { finishSetup, resetAll } from '../state/store';
import { confirm, toast } from '../state/ui';
import { Button, Notice } from '../ui/components/primitives';
import { rawFileName } from './fileNames';

/** Shown when saved data exists but cannot be read (and no good copy was available). */
export function RecoveryScreen({ errors }: { errors: string[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const raw = corruptCopy();
  return (
    <div className="screen no-nav">
      <div className="scroll" style={{ paddingTop: 'calc(var(--safe-top) + 32px)' }}>
        <div className="empty-ico" style={{ width: 64, height: 64, background: 'var(--warning-soft)', color: 'var(--warning)' }}>
          <FileWarning size={30} />
        </div>
        <h1 className="center" style={{ fontSize: 22, margin: '0 0 8px' }}>
          Saved data couldn’t be read
        </h1>
        <p className="center muted" style={{ margin: '0 0 18px', lineHeight: 1.5 }}>
          VELTRIX found simulator data on this device but it failed validation, so nothing was loaded or changed. You can keep a copy, restore a backup, or start fresh.
        </p>
        <Notice tone="warn">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {errors.slice(0, 5).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Notice>
        <div className="stack" style={{ marginTop: 20 }}>
          {raw && (
            <Button variant="secondary" block onClick={async () => toast((await saveTextFile(rawFileName(), 'application/json', raw)).ok ? 'Raw file saved' : 'Could not save the file', 'info')}>
              Export the unreadable file
            </Button>
          )}
          <Button variant="secondary" block onClick={() => fileRef.current?.click()}>
            Restore from a backup
          </Button>
          <Button
            block
            onClick={async () => {
              if (await confirm({ title: 'Start fresh?', message: 'A new simulator will be set up. The unreadable file is kept so you can still export it from Settings → Data.', confirmLabel: 'Start fresh' })) resetAll();
            }}
          >
            Start fresh
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              const r = loadState(JSON.parse(await file.text()));
              if (!r.ok) {
                toast(`Backup rejected: ${r.errors[0]}`, 'error');
                return;
              }
              finishSetup(r.state);
              toast('Backup restored', 'success');
            } catch {
              toast('That file is not a valid backup', 'error');
            }
          }}
        />
      </div>
    </div>
  );
}
