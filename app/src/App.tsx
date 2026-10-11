import { Activity, ChartCandlestick, House, Lock, User, Wallet } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import type { AccentName, AnimationLevel, ThemeMode } from './domain/types';
import { applyTheme, useResolvedTheme } from './ui/themeRuntime';
import { authenticate, deviceLockAvailable, exitApp, isNative, nativeInsets, type Insets } from './platform/bridge';
import { SCREENS } from './screens';
import { RecoveryScreen } from './screens/RecoveryScreen';
import { SetupWizard } from './screens/SetupWizard';
import { flush, init, onResume, useSnapshot } from './state/store';
import { getUI, handleBack, nav, TABS, useUI, type Route, type Tab } from './state/ui';
import { LogoMark } from './ui/components/Brand';
import { DialogHost, SheetHost, ToastHost } from './ui/components/Overlays';
import { Button, ScreenContext, tap } from './ui/components/primitives';

function ThemeController({ mode, accent, motion }: { mode: ThemeMode; accent: AccentName; motion: AnimationLevel }) {
  const theme = useResolvedTheme(mode);
  useLayoutEffect(() => applyTheme(theme, accent, motion, mode), [theme, accent, motion, mode]);
  return null;
}

/* ---------------------------- Platform glue ------------------------ */

function applyInsets(i: Insets): void {
  const s = document.documentElement.style;
  s.setProperty('--safe-top', `${Math.max(0, i.top)}px`);
  s.setProperty('--safe-right', `${Math.max(0, i.right)}px`);
  s.setProperty('--safe-bottom', `${Math.max(0, i.bottom)}px`);
  s.setProperty('--safe-left', `${Math.max(0, i.left)}px`);
  s.setProperty('--ime', `${Math.max(0, i.ime)}px`);
}

function usePlatformGlue(phase: string): void {
  useEffect(() => {
    window.__veltrixInsets = applyInsets;
    const first = nativeInsets();
    if (first) applyInsets(first);
    window.__veltrixBack = () => {
      const handled = handleBack();
      if (!handled && getUI().tab === 'home') return false;
      return true;
    };
    window.__veltrixLifecycle = (s) => {
      if (s === 'pause') flush();
      else onResume();
    };
    // Browser preview: map the browser/hardware back button onto in-app back.
    if (!isNative()) {
      history.pushState({ veltrix: true }, '');
      const onPop = () => {
        if (handleBack()) history.pushState({ veltrix: true }, '');
        else history.back();
      };
      window.addEventListener('popstate', onPop);
      return () => window.removeEventListener('popstate', onPop);
    }
    return undefined;
  }, []);
  void phase;
}

/* ------------------------------ Lock ------------------------------- */

function useAppLock(enabled: boolean): [boolean, () => void] {
  const [locked, setLocked] = useState(() => enabled && deviceLockAvailable());
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled) {
      setLocked(false);
      return;
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > 30_000 && deviceLockAvailable()) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled]);
  const unlock = async () => {
    if (await authenticate('Unlock VELTRIX', 'Confirm it’s you to open the simulator')) setLocked(false);
  };
  return [locked, unlock];
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  useEffect(() => {
    onUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="lock">
      <LogoMark size={64} />
      <div>
        <h2 style={{ margin: '0 0 6px' }}>VELTRIX is locked</h2>
        <p className="muted" style={{ margin: 0 }}>Use your device screen lock to continue.</p>
      </div>
      <Button onClick={onUnlock} icon={<Lock size={18} />}>
        Unlock
      </Button>
      <button className="link-btn" onClick={exitApp}>
        Close app
      </button>
    </div>
  );
}

/* ---------------------------- Navigator ---------------------------- */

const TAB_META: Record<Tab, { label: string; Icon: ComponentType<{ size?: number }> }> = {
  home: { label: 'Home', Icon: House },
  wallet: { label: 'Wallet', Icon: Wallet },
  activity: { label: 'Activity', Icon: Activity },
  markets: { label: 'Markets', Icon: ChartCandlestick },
  profile: { label: 'Profile', Icon: User },
};

function ScreenView({ route, visible, hasNav, animate }: { route: Route; visible: boolean; hasNav: boolean; animate: boolean }) {
  const C = SCREENS[route.name];
  const [enter] = useState(animate);
  return (
    <div className={`screen ${hasNav ? 'with-nav' : 'no-nav'}${enter ? ' enter-forward' : ''}`} style={visible ? undefined : { visibility: 'hidden', pointerEvents: 'none' }} aria-hidden={!visible}>
      <ScreenContext.Provider value={{ route, visible, hasNav }}>
        <C />
      </ScreenContext.Provider>
    </div>
  );
}

function Shell() {
  const ui = useUI();
  const [mounted, setMounted] = useState<Set<Tab>>(() => new Set<Tab>(['home']));
  useEffect(() => {
    if (!mounted.has(ui.tab)) setMounted(new Set([...mounted, ui.tab]));
  }, [ui.tab, mounted]);
  const stack = ui.stacks[ui.tab];
  const atRoot = stack.length === 1;
  return (
    <>
      <div className="stage">
        {TABS.filter((t) => mounted.has(t) || t === ui.tab).map((t) => (
          <Fragment key={t}>
            {ui.stacks[t].map((r, i) => {
              const top = i === ui.stacks[t].length - 1;
              return <ScreenView key={r.key} route={r} visible={t === ui.tab && top} hasNav={i === 0} animate={i > 0 && ui.direction === 'forward'} />;
            })}
          </Fragment>
        ))}
      </div>
      {atRoot && (
        <nav className="navbar" aria-label="Main">
          {TABS.map((t) => {
            const { label, Icon } = TAB_META[t];
            return (
              <button
                key={t}
                className="nav-item"
                aria-current={ui.tab === t ? 'page' : undefined}
                onClick={() => {
                  tap('select');
                  nav.tab(t);
                }}
              >
                <span className="nav-ico">
                  <Icon size={21} />
                </span>
                {label}
              </button>
            );
          })}
        </nav>
      )}
      <ToastHost withNav={atRoot} />
    </>
  );
}

/* ------------------------------- App ------------------------------- */

export default function App() {
  const snap = useSnapshot();
  const [splash, setSplash] = useState(true);
  usePlatformGlue(snap.phase);
  useEffect(() => {
    init();
  }, []);
  useEffect(() => {
    if (snap.phase === 'loading') return undefined;
    const t = setTimeout(() => setSplash(false), 280);
    return () => clearTimeout(t);
  }, [snap.phase]);
  const settings = snap.app?.settings;
  const [locked, unlock] = useAppLock(!!settings?.appLock);
  return (
    <div className="app-frame">
      <div className="app">
        {settings && <ThemeController mode={settings.theme} accent={settings.accent} motion={settings.animation} />}
        {snap.phase === 'ready' && snap.app && <Shell />}
        {snap.phase === 'setup' && <SetupWizard />}
        {snap.phase === 'recovery' && <RecoveryScreen errors={snap.recoveryErrors} />}
        <SheetHost />
        <DialogHost />
        {snap.phase !== 'ready' && <ToastHost withNav={false} />}
        {locked && snap.phase === 'ready' && <LockScreen onUnlock={unlock} />}
        {splash && (
          <div className="splash" style={{ opacity: snap.phase === 'loading' ? 1 : 0, transition: 'opacity var(--dur) var(--ease)', pointerEvents: 'none' }} aria-hidden="true">
            <div className="mark">
              <LogoMark size={72} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
