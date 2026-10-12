// VELTRIX Wallet — end-to-end UI tests.
//
// Runs the production web bundle (app/dist — byte-for-byte what ships inside
// the APK, including its Content-Security-Policy) in a mobile-sized headless
// Chromium and drives real user flows. Every flow asserts on visible results:
// balances, ledger entries, statuses and persisted data.
//
//   cd app && npm run build
//   cd tools/ui-test && npm install && npm test            # tests only
//   npm run test:shots                                      # + docs/screenshots
//
// Browser: set CHROME_PATH to use a local Chrome/Chromium; otherwise the
// @sparticuz/chromium package (a self-contained Linux x64 build) is used.

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(here, '../../app/dist');
const OUT = resolve(here, 'out');
const SHOTS = resolve(here, '../../docs/screenshots');
const WANT_SHOTS = process.argv.includes('--screenshots');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
// Drive an already-running server instead of the built-in static one — used to
// exercise the bundle as served by the desktop launcher (tools/build-exe.sh),
// which is byte-for-byte the same bundle but reached over a different origin.
const BASE_URL = process.argv.find((a) => a.startsWith('--base-url='))?.slice(11);

/* ------------------------------ Static server ------------------------------ */

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png' };

function serve() {
  return new Promise((ok) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
      if (p === '/' || p === '') p = '/index.html';
      const file = join(DIST, p);
      if (!file.startsWith(DIST) || !existsSync(file)) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await readFile(file));
    });
    server.listen(0, '127.0.0.1', () => ok(server));
  });
}

/* --------------------------------- Browser --------------------------------- */

async function launch() {
  const viewport = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  if (process.env.CHROME_PATH) {
    return puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox'], defaultViewport: viewport });
  }
  const { default: chromium, inflate } = await import('@sparticuz/chromium');
  // Locate the package's bin/ folder (it ships the browser and, for some distros, extra libraries).
  let dir = dirname(fileURLToPath(import.meta.resolve('@sparticuz/chromium')));
  while (!existsSync(join(dir, 'bin')) && dirname(dir) !== dir) dir = dirname(dir);
  const al2023 = join(dir, 'bin', 'al2023.tar.br');
  if (existsSync(al2023)) {
    await inflate(al2023);
    process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''}`;
  }
  // Drop flags meant for serverless use: single-process mode cannot host several browser
  // contexts, and the tests need normal web security so CSP violations surface.
  const drop = new Set(['--single-process', '--disable-web-security', '--allow-running-insecure-content']);
  const args = chromium.args.filter((a) => !drop.has(a));
  return puppeteer.launch({ executablePath: await chromium.executablePath(), headless: true, args: [...args, '--no-sandbox'], defaultViewport: viewport });
}

/* ------------------------------ Test harness ------------------------------- */

const results = [];
const consoleProblems = [];
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

class Assertion extends Error {}
function expect(cond, msg) {
  if (!cond) throw new Assertion(msg);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VISIBLE = `(e) => e.offsetParent !== null && !e.closest('[aria-hidden="true"]') && getComputedStyle(e).visibility !== 'hidden'`;

function helpers(page, base) {
  const h = {
    async open(fresh = true) {
      await page.goto(base, { waitUntil: 'networkidle0' });
      if (fresh) {
        await page.evaluate(() => localStorage.clear());
        await page.reload({ waitUntil: 'networkidle0' });
      }
    },
    async clickText(text, sel = 'button', { exact = false, timeout = 4000 } = {}) {
      const t0 = Date.now();
      for (;;) {
        const ok = await page.evaluate(
          (text, sel, exact, vis) => {
            const isVis = eval(vis);
            const el = [...document.querySelectorAll(sel)].filter(isVis).find((e) => (exact ? e.textContent.trim() === text : e.textContent.trim().includes(text)));
            if (!el || el.disabled) return false;
            el.click();
            return true;
          },
          text,
          sel,
          exact,
          VISIBLE,
        );
        if (ok) break;
        if (Date.now() - t0 > timeout) throw new Assertion(`No visible ${sel} with text "${text}"`);
        await sleep(100);
      }
      await sleep(260);
    },
    async clickLabel(label, { timeout = 4000 } = {}) {
      const t0 = Date.now();
      for (;;) {
        const ok = await page.evaluate(
          (label, vis) => {
            const isVis = eval(vis);
            const el = [...document.querySelectorAll(`[aria-label="${label}"]`)].filter(isVis)[0];
            if (!el || el.disabled) return false;
            el.click();
            return true;
          },
          label,
          VISIBLE,
        );
        if (ok) break;
        if (Date.now() - t0 > timeout) throw new Assertion(`No visible element labelled "${label}"`);
        await sleep(100);
      }
      await sleep(260);
    },
    async keys(s) {
      for (const ch of s) await h.clickLabel(ch === '.' ? 'Decimal point' : ch === '<' ? 'Delete digit' : ch);
    },
    async type(placeholderOrLabel, text, { clear = true } = {}) {
      const handle = await page.evaluateHandle(
        (key, vis) => {
          const isVis = eval(vis);
          return (
            [...document.querySelectorAll('input, textarea')]
              .filter(isVis)
              .find((e) => e.placeholder === key || e.getAttribute('aria-label') === key || (e.closest('label')?.querySelector('.field-label')?.textContent ?? '').trim().startsWith(key)) ?? null
          );
        },
        placeholderOrLabel,
        VISIBLE,
      );
      const el = handle.asElement();
      if (!el) throw new Assertion(`No input "${placeholderOrLabel}"`);
      if (clear) await el.click({ clickCount: 3 });
      if (clear) await page.keyboard.press('Backspace');
      await el.type(text, { delay: 5 });
      await sleep(150);
    },
    async waitText(text, timeout = 5000) {
      try {
        await page.waitForFunction((t, vis) => {
          const isVis = eval(vis);
          return [...document.querySelectorAll('body *')].some((e) => e.children.length === 0 && isVis(e) && e.textContent.includes(t));
        }, { timeout }, text, VISIBLE);
      } catch {
        throw new Assertion(`Text "${text}" did not appear`);
      }
    },
    async hasText(text) {
      return page.evaluate((t, vis) => {
        const isVis = eval(vis);
        return [...document.querySelectorAll('body *')].some((e) => e.children.length === 0 && isVis(e) && e.textContent.includes(t));
      }, text, VISIBLE);
    },
    async heroBalance() {
      await page.waitForSelector('.hero-amount', { timeout: 8000 });
      const t = await page.evaluate((vis) => {
        const isVis = eval(vis);
        return [...document.querySelectorAll('.hero-amount')].filter(isVis)[0]?.textContent ?? '';
      }, VISIBLE);
      return parseMoney(t);
    },
    async skipSetup() {
      await h.open(true);
      await h.clickText('Skip — use the Everyday demo');
      await page.waitForSelector('.hero-amount', { timeout: 15000 });
      await sleep(400);
    },
    async tab(name) {
      await h.clickText(name, 'button.nav-item');
      await sleep(250);
    },
    async back() {
      await h.clickLabel('Back');
    },
    async shot(name) {
      if (!WANT_SHOTS) return;
      await sleep(450);
      await page.screenshot({ path: join(SHOTS, `${name}.png`) });
    },
    async toastText() {
      await page.waitForSelector('.toast', { timeout: 5000 });
      return page.$$eval('.toast', (els) => els.map((e) => e.textContent).join(' | '));
    },
    async rowTitles() {
      return page.evaluate((vis) => {
        const isVis = eval(vis);
        return [...document.querySelectorAll('.list .row-main .row-title')].filter(isVis).map((e) => e.textContent.trim());
      }, VISIBLE);
    },
  };
  return h;
}

function parseMoney(text) {
  const neg = /[−-]/.test(text);
  const n = Number(text.replace(/[^\d.]/g, ''));
  return neg ? -n : n;
}

/* ---------------------------------- Tests ---------------------------------- */

/** In-page mock of the Android bridge (same method names/signatures as WebAppBridge.java). */
function installMockBridge() {
  const store = new Map();
  window.__calls = [];
  const rec = (name, ...args) => window.__calls.push([name, ...args]);
  window.VeltrixNative = {
    getPlatformInfo: () => JSON.stringify({ platform: 'android', sdk: 35, appVersion: '1.0.0', webView: 'test' }),
    storageGet: (k) => (store.has(k) ? store.get(k) : null),
    storageSet: (k, v) => {
      rec('storageSet', k, v.length);
      store.set(k, v);
      return true;
    },
    storageRemove: (k) => store.delete(k),
    haptic: (kind) => rec('haptic', kind),
    setTheme: (mode, dark, bg) => rec('setTheme', mode, dark, bg),
    getInsets: () => JSON.stringify({ top: 24, right: 0, bottom: 16, left: 0, ime: 0 }),
    copyText: () => true,
    shareText: () => rec('share'),
    saveDocument: () => rec('save'),
    updateWidget: (json) => rec('updateWidget', json),
    isDeviceSecure: () => false,
    authenticate: () => rec('auth'),
    openExternal: () => rec('open'),
    exitApp: () => rec('exit'),
  };
}

test('setup wizard creates a personalised simulator', async (page, h) => {
  await h.open(true);
  await h.shot('01-welcome');
  await h.clickText('Set up my simulator');
  await h.clickText('Minimal', 'button.wizard-option');
  await h.clickText('Continue', 'button', { exact: true });
  await h.type('Alex Morgan', 'Taylor Quinn');
  await h.clickText('Continue', 'button', { exact: true });
  await h.clickText('Euro', 'button.row');
  await h.clickText('Continue', 'button', { exact: true });
  await h.clickText('Light', 'button', { exact: true });
  await h.clickText('Continue', 'button', { exact: true });
  await h.keys('1234.56');
  await h.clickText('Continue', 'button', { exact: true });
  await h.clickText('Emerald', 'button.style-opt');
  await h.shot('02-setup-card');
  await h.clickText('Continue', 'button', { exact: true });
  await h.clickText('Continue', 'button', { exact: true });
  await h.waitText('Ready');
  await h.clickText('Create my simulator');
  const bal = await h.heroBalance();
  expect(bal === 1234.56, `main wallet should be €1,234.56, got ${bal}`);
  expect(await h.hasText('Taylor'), 'greeting should use the chosen name');
  expect((await page.evaluate(() => document.querySelector('.hero-amount').textContent)).includes('€'), 'balance should be in EUR');
  expect((await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'light theme should be applied');
});

test('send money: recipient → amount → note → review → result updates the ledger', async (page, h) => {
  await h.skipSetup();
  await h.shot('03-home-dark');
  const before = await h.heroBalance();
  await h.clickText('Send', 'button.qa');
  await h.shot('04-send-recipient');
  await h.clickText('Ava Laurent', 'button.row');
  await h.keys('25');
  await h.shot('05-send-amount');
  await h.clickText('Continue', 'button', { exact: true });
  await h.clickText('Dinner', 'button.chip');
  await h.clickText('Review', 'button', { exact: true });
  await h.waitText('Simulated transaction');
  await h.shot('06-send-review');
  await h.clickText('Confirm simulation');
  await h.waitText('Simulation completed');
  await h.shot('07-send-result');
  // Double-tap protection: confirming twice must not create a second entry.
  await h.clickText('Done', 'button', { exact: true });
  const after = await h.heroBalance();
  expect(Math.abs(before - 25 - after) < 0.001, `balance should drop by 25.00 (${before} → ${after})`);
  await h.tab('Activity');
  const titles = await h.rowTitles();
  expect(titles[0] === 'Ava Laurent', `newest ledger entry should be the payment, got ${titles[0]}`);
});

test('refund (reversal) restores the balance and keeps both entries', async (page, h) => {
  await h.skipSetup();
  const start = await h.heroBalance();
  await h.clickText('Send', 'button.qa');
  await h.clickText('Noah Kim', 'button.row');
  await h.keys('40');
  await h.clickText('Continue', 'button', { exact: true });
  await h.clickText('Review', 'button', { exact: true });
  await h.clickText('Confirm simulation');
  await h.clickText('View details');
  await h.shot('08-txn-detail');
  await h.clickText('Refund (reverse)');
  await h.clickText('Reverse', '.dialog button', { exact: true });
  await h.waitText('Simulation reversed');
  await h.back();
  await h.tab('Home');
  const end = await h.heroBalance();
  expect(Math.abs(end - start) < 0.001, `refund should restore ${start}, got ${end}`);
});

test('request money can be marked accepted', async (page, h) => {
  await h.skipSetup();
  const before = await h.heroBalance();
  await h.clickText('Request', 'button.qa');
  await h.clickText('Mila Hoxha', 'button.row');
  await h.keys('12');
  await h.clickText('Continue', 'button', { exact: true });
  await h.clickText('Review', 'button', { exact: true });
  await h.clickText('Create simulated request');
  await h.waitText('Request saved');
  await h.clickText('Mark accepted');
  await h.clickText('Done', 'button', { exact: true });
  const after = await h.heroBalance();
  expect(Math.abs(after - before - 12) < 0.001, `accepted request should add 12.00 (${before} → ${after})`);
});

test('receive: demo QR and a simulated incoming payment', async (page, h) => {
  await h.skipSetup();
  const before = await h.heroBalance();
  await h.clickText('Receive', 'button.qa');
  await h.waitText('Demo QR');
  expect(await page.$('.qr-box svg path'), 'QR code should render');
  await h.shot('09-receive');
  await h.clickText('Simulate incoming payment');
  await h.keys('40');
  await h.clickText('Receive simulated $40.00');
  await h.back();
  const after = await h.heroBalance();
  expect(Math.abs(after - before - 40) < 0.001, `incoming payment should add 40.00 (${before} → ${after})`);
});

test('manual balance edit is logged as an adjustment', async (page, h) => {
  await h.skipSetup();
  await h.clickText('Edit', 'button.hero-act');
  for (let i = 0; i < 12; i++) await h.clickLabel('Delete digit');
  await h.keys('5000');
  await h.clickText('Save balance');
  expect((await h.heroBalance()) === 5000, 'balance should be exactly 5,000.00');
  await h.clickText('Add', 'button.hero-act');
  await h.keys('250.5');
  await h.clickText('Add simulated funds');
  expect((await h.heroBalance()) === 5250.5, 'balance should be 5,250.50 after adding funds');
  await h.tab('Activity');
  const titles = await h.rowTitles();
  expect(titles[0] === 'Simulated funds added' && titles[1].startsWith('Balance edited to'), `adjustments should be in the ledger, got ${titles.slice(0, 2)}`);
});

test('card studio: create, freeze blocks purchases, unfreeze, delete', async (page, h) => {
  await h.skipSetup();
  await h.clickText('Cards', 'button.qa');
  await h.shot('10-card-studio');
  await h.clickLabel('Create demo card');
  await h.clickText('Neon', 'button.style-opt');
  await h.type('Nickname', 'Night Owl');
  await h.shot('11-card-editor');
  await h.clickText('Create demo card', '.footer-bar button');
  await h.waitText('Card history');
  expect(await page.evaluate(() => document.querySelector('svg[role="img"]').getAttribute('aria-label').includes('Not a real payment card')), 'card art must be labelled as not real');
  await h.clickText('Freeze', 'button.qa');
  await h.clickText('Purchase', 'button.qa');
  await h.waitText('frozen');
  await h.clickText('Urban Threads', 'button.chip');
  await h.keys('10');
  await h.clickText('Simulate $10.00');
  expect((await h.toastText()).includes('frozen'), 'purchase on a frozen card must be declined');
  await h.clickLabel('Close');
  await h.clickText('Unfreeze', 'button.qa');
  await h.clickText('Purchase', 'button.qa');
  await h.clickText('Urban Threads', 'button.chip');
  await h.keys('10');
  await h.clickText('Simulate $10.00');
  await h.waitText('Urban Threads');
  await h.clickText('Delete', 'button', { exact: true });
  await h.clickText('Delete card', '.dialog button');
  await h.waitText('Card studio');
  const names = await page.evaluate(() => [...document.querySelectorAll('.card-slide')].map((e) => e.getAttribute('aria-label')).join(','));
  expect(!names.includes('Night Owl'), 'deleted card should be gone');
});

test('exchange: optional fee, breakdown and FX wallet update', async (page, h) => {
  await h.skipSetup();
  await h.clickText('Exchange', 'button.qa');
  await h.waitText('Demo rates');
  await h.shot('12-exchange');
  await h.clickText('Simulate conversion');
  await h.waitText('Calculation');
  await h.clickText('Confirm simulated conversion');
  await h.waitText('Conversion breakdown');
  expect(await h.hasText('€86.00'), '100 USD at the 0.86 demo rate should give €86.00');
  expect(await h.hasText('Demo rates (bundled sample)'), 'rate source must be disclosed as demo');
  expect(await h.hasText('Not applied') === false, 'conversion should apply to balances');
});

test('markets: buy, position with average cost, sell with realized P&L', async (page, h) => {
  await h.skipSetup();
  await h.tab('Markets');
  await h.shot('13-markets');
  await page.evaluate((vis) => {
    const isVis = eval(vis);
    [...document.querySelectorAll('.list button.row')].filter(isVis).find((e) => e.textContent.includes('NVDA'))?.click();
  }, VISIBLE);
  await h.waitText('Demo price');
  await h.shot('14-asset');
  await h.clickText('Buy', 'button', { exact: true });
  await h.type('e.g. 250', '300');
  await h.clickText('Review order');
  await h.waitText('Simulated order');
  await h.clickText('Confirm buy');
  await h.waitText('Simulated order filled');
  await h.clickText('Done', 'button', { exact: true });
  await h.waitText('Your simulated position');
  await h.clickText('Sell', 'button', { exact: true });
  await h.clickText('All', 'button.chip', { exact: true });
  await h.clickText('Review order');
  await h.clickText('Confirm sell');
  await h.waitText('Realized P&L');
  await h.clickText('Portfolio', '.sheet button');
  await h.waitText('Realized P&L');
  await h.shot('15-portfolio');
});

test('activity: search, type filter and sort orders', async (page, h) => {
  await h.skipSetup();
  await h.tab('Activity');
  await h.shot('16-activity');
  await h.type('Search name, note, amount or SIM ref', 'metro transit');
  const titles = await h.rowTitles();
  expect(titles.length > 3 && titles.every((t) => t.toLowerCase().includes('metro transit')), `search should only show matches, got ${titles.slice(0, 3)}`);
  await h.type('Search name, note, amount or SIM ref', '');
  await h.clickText('Sent', 'button.chip', { exact: true });
  const subs = await page.evaluate((vis) => {
    const isVis = eval(vis);
    return [...document.querySelectorAll('.list .row .row-sub')].filter(isVis).map((e) => e.textContent);
  }, VISIBLE);
  expect(subs.filter((s) => s.includes('·')).every((s) => s.startsWith('Sent') || s.startsWith('Request to pay') || s.startsWith('Bill payment')), 'type filter should only show sent payments');
  await h.clickText('Sent', 'button.chip', { exact: true });
  await h.clickLabel('Sort: Newest first');
  await h.clickText('Largest amount', '.sheet button');
  const amounts = await page.evaluate((vis) => {
    const isVis = eval(vis);
    return [...document.querySelectorAll('.list .row .row-end .row-title')].filter(isVis).slice(0, 12).map((e) => Number(e.textContent.replace(/[^\d.]/g, '')));
  }, VISIBLE);
  expect(amounts.every((a, i) => i === 0 || a <= amounts[i - 1] + 1e-9), `largest-first sort should be descending: ${amounts}`);
});

test('CSV export is marked simulated; backup restores after changes', async (page, h) => {
  await page.evaluateOnNewDocument(() => {
    window.__blobs = [];
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      window.__blobs.push(b);
      return orig(b);
    };
  });
  await h.skipSetup();
  const saved = await h.heroBalance();
  await h.tab('Activity');
  await h.clickLabel('Export filtered entries as CSV');
  await sleep(500);
  const csv = await page.evaluate(async () => (window.__blobs.length ? window.__blobs[window.__blobs.length - 1].text() : ''));
  const lines = csv.trim().split('\r\n');
  expect(lines[0].startsWith('Simulation,Date'), 'CSV header');
  expect(lines.length > 50 && lines.slice(1).every((l) => l.startsWith('SIMULATED,')), 'every CSV row must be marked SIMULATED');
  await h.tab('Profile');
  await h.clickText('Data & backup', 'button.row');
  await h.clickText('Save full backup', 'button.row');
  await sleep(500);
  const backup = await page.evaluate(async () => window.__blobs[window.__blobs.length - 1].text());
  const parsed = JSON.parse(backup);
  expect(parsed.format === 'veltrix-backup' && /fictional/i.test(parsed.disclaimer), 'backup format + disclaimer');
  const file = join(tmpdir(), `veltrix-backup-${Date.now()}.json`);
  await writeFile(file, backup);
  // Change something, then restore.
  await h.back();
  await h.tab('Home');
  await h.clickText('Add', 'button.hero-act');
  await h.keys('999');
  await h.clickText('Add simulated funds');
  expect((await h.heroBalance()) !== saved, 'balance changed before restore');
  await h.tab('Profile');
  await h.clickText('Data & backup', 'button.row');
  const restoreBtn = await page.evaluateHandle((vis) => {
    const isVis = eval(vis);
    return [...document.querySelectorAll('button.row')].filter(isVis).find((e) => e.textContent.includes('Restore from backup'));
  }, VISIBLE);
  // A trusted click is needed: browsers only open file pickers from real user gestures.
  const [chooser] = await Promise.all([page.waitForFileChooser(), restoreBtn.asElement().click()]);
  await chooser.accept([file]);
  await h.clickText('Replace', '.dialog button', { exact: true, timeout: 6000 });
  await page.waitForSelector('.hero-amount');
  expect((await h.heroBalance()) === saved, 'restored balance should equal the backup');
});

test('persistence across reloads and recovery from a corrupt save', async (page, h) => {
  await h.skipSetup();
  const bal = await h.heroBalance();
  await sleep(600);
  await page.reload({ waitUntil: 'networkidle0' });
  expect((await h.heroBalance()) === bal, 'state should survive a reload');
  // Corrupt the main save but keep the last good copy: the app recovers automatically.
  await page.evaluate(() => localStorage.setItem('veltrix.state.v1', '{"truncated":'));
  await page.reload({ waitUntil: 'networkidle0' });
  expect((await h.heroBalance()) === bal, 'should restore the last good copy');
  // Corrupt both copies: the recovery screen offers export / restore / start fresh.
  await page.evaluate(() => {
    localStorage.setItem('veltrix.state.v1', '{"truncated":');
    localStorage.setItem('veltrix.state.prev', 'also broken');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await h.waitText('Saved data couldn’t be read');
  await h.clickText('Start fresh', 'button', { exact: true });
  await h.clickText('Start fresh', '.dialog button', { exact: true });
  await h.waitText('Set up my simulator');
});

test('Android-style back: closes sheets, pops screens, returns to Home', async (page, h) => {
  await h.skipSetup();
  await h.clickText('Add Funds', 'button.qa');
  expect(await page.$('.sheet'), 'sheet open');
  await page.goBack();
  await sleep(400);
  expect(!(await page.$('.sheet')), 'back should close the sheet');
  await h.clickText('Cards', 'button.qa');
  await h.waitText('Card studio');
  await page.goBack();
  await sleep(400);
  expect(await h.hasText('Good'), 'back should pop to Home');
  await h.tab('Wallet');
  await page.goBack();
  await sleep(400);
  expect((await page.$eval('.nav-item[aria-current="page"]', (e) => e.textContent)).includes('Home'), 'back from a tab root should go to Home');
});

test('appearance settings apply theme, accent and motion app-wide', async (page, h) => {
  await h.skipSetup();
  await h.tab('Profile');
  await h.shot('17-profile');
  await h.clickText('Appearance', 'button.row');
  await h.clickText('Light', 'button', { exact: true });
  expect((await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'light theme');
  await h.clickLabel('Violet');
  expect((await page.evaluate(() => document.documentElement.dataset.accent)) === 'violet', 'accent');
  await h.clickText('Off', 'button', { exact: true });
  expect((await page.evaluate(() => document.documentElement.dataset.motion)) === 'off', 'motion off');
  await h.back();
  await h.tab('Home');
  await h.shot('18-home-light');
  await h.clickText('Cards', 'button.qa');
  await h.shot('19-cards-light');
});

test('native bridge contract (storage, insets, theme bars, widget, back, haptics)', async (page, h) => {
  await page.evaluateOnNewDocument(installMockBridge);
  await page.goto(h.base, { waitUntil: 'networkidle0' });
  await h.clickText('Skip — use the Everyday demo');
  await page.waitForSelector('.hero-amount', { timeout: 15000 });
  await sleep(700);
  const info = await page.evaluate(() => ({
    calls: window.__calls,
    local: localStorage.length,
    top: getComputedStyle(document.documentElement).getPropertyValue('--safe-top').trim(),
    bottom: getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom').trim(),
  }));
  expect(info.local === 0, 'with the native bridge, data must not go to localStorage');
  expect(info.calls.some((c) => c[0] === 'storageSet' && c[1] === 'veltrix.state.v1' && c[2] > 1000), 'state saved through the bridge');
  expect(info.calls.some((c) => c[0] === 'setTheme' && typeof c[2] === 'boolean' && /^#[0-9a-f]{6}$/i.test(c[3])), 'system bars themed through the bridge');
  const widget = info.calls.filter((c) => c[0] === 'updateWidget').pop();
  expect(widget && widget[1].includes('DEMO') && widget[1].includes('not a real card'), 'widget payload must be labelled demo');
  expect(JSON.parse(widget[1]).amount.includes('••••'), 'widget masks the balance unless the user opts in');
  expect(info.top === '24px' && info.bottom === '16px', `native insets applied (${info.top}/${info.bottom})`);
  await page.evaluate(() => window.__veltrixInsets({ top: 30, right: 0, bottom: 0, left: 0, ime: 0 }));
  expect((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--safe-top').trim())) === '30px', 'inset updates applied');
  expect((await page.evaluate(() => window.__veltrixBack())) === false, 'back at Home root should let Android background the app');
  await h.clickText('Add Funds', 'button.qa');
  expect((await page.evaluate(() => window.__veltrixBack())) === true, 'back with an open sheet is handled');
  await sleep(300);
  expect(!(await page.$('.sheet')), 'sheet closed by native back');
  await h.clickText('Send', 'button.qa');
  await h.clickText('Ava Laurent', 'button.row');
  await h.keys('5');
  expect((await page.evaluate(() => window.__calls.some((c) => c[0] === 'haptic'))), 'keypad gives haptic feedback');
  expect((await page.evaluate(() => window.__veltrixBack())) === true, 'back inside a flow steps back');
});

test('large history (20,000 entries) stays responsive', async (page, h) => {
  // Like the APK, store data through the native bridge (files) rather than the ~5 MB localStorage quota.
  await page.evaluateOnNewDocument(installMockBridge);
  await page.goto(h.base, { waitUntil: 'networkidle0' });
  await h.clickText('Skip — use the Everyday demo');
  await page.waitForSelector('.hero-amount', { timeout: 15000 });
  await sleep(600);
  const backup = await page.evaluate(() => {
    const s = JSON.parse(window.VeltrixNative.storageGet('veltrix.state.v1'));
    const tpl = s.transactions.find((t) => t.type === 'purchase' && t.status === 'completed');
    const start = Date.now() - 400 * 86400000;
    const extra = [];
    for (let i = 0; i < 20000; i++) {
      extra.push({ ...tpl, id: `txn_bulk${i.toString(36)}`, amount: 100 + (i % 900), title: `Bulk merchant ${i % 50}`, createdAt: new Date(start + i * 1700000).toISOString(), links: undefined, balanceBefore: undefined, balanceAfter: undefined });
    }
    const total = extra.reduce((x, t) => x + t.amount + t.fee, 0);
    const opening = { ...s.transactions[0], id: 'txn_bulkopen', type: 'adjustment', subtype: 'opening', direction: 'in', title: 'Bulk opening', amount: total, fee: 0, accountId: tpl.accountId, cardId: undefined, toAccountId: undefined, createdAt: new Date(start - 1000).toISOString(), applied: true, status: 'completed' };
    s.transactions = [opening, ...extra, ...s.transactions];
    return JSON.stringify({ format: 'veltrix-backup', version: 1, exportedAt: new Date().toISOString(), disclaimer: 'Synthetic large simulator history', state: s });
  });
  const file = join(tmpdir(), `veltrix-bulk-${Date.now()}.json`);
  await writeFile(file, backup);
  await h.tab('Profile');
  await h.clickText('Data & backup', 'button.row');
  const restoreBtn = await page.evaluateHandle((vis) => {
    const isVis = eval(vis);
    return [...document.querySelectorAll('button.row')].filter(isVis).find((e) => e.textContent.includes('Restore from backup'));
  }, VISIBLE);
  const [chooser] = await Promise.all([page.waitForFileChooser(), restoreBtn.asElement().click()]);
  const tv = Date.now();
  await chooser.accept([file]);
  await page.waitForSelector('.dialog', { timeout: 20000 });
  const validateMs = Date.now() - tv;
  expect(await h.hasText('20,'), 'the confirm dialog should report the entry count');
  const t0 = Date.now();
  await h.clickText('Replace', '.dialog button', { exact: true, timeout: 5000 });
  await page.waitForSelector('.hero-amount', { timeout: 20000 });
  const applyMs = Date.now() - t0;
  const t1 = Date.now();
  await h.tab('Activity');
  await h.waitText('entries');
  const activityMs = Date.now() - t1;
  const count = await page.evaluate((vis) => {
    const isVis = eval(vis);
    return [...document.querySelectorAll('.list .row')].filter(isVis).length;
  }, VISIBLE);
  expect(count <= 80, `activity should paginate (rendered ${count} rows)`);
  expect(await h.hasText('20,'), 'entry count shown');
  const t2 = Date.now();
  await h.type('Search name, note, amount or SIM ref', 'bulk merchant 7');
  const searchMs = Date.now() - t2;
  const saved = await page.evaluate(() => (window.VeltrixNative.storageGet('veltrix.state.v1') ?? '').length);
  expect(saved > 5_000_000, `large state persisted through the bridge (${saved} chars)`);
  expect(validateMs < 8000 && applyMs < 8000 && activityMs < 4000, `validate ${validateMs} ms, apply ${applyMs} ms, activity ${activityMs} ms`);
  return `20,190 entries · validate ${validateMs} ms · apply ${applyMs} ms · activity ${activityMs} ms · search typing ${searchMs} ms`;
});

test('accessibility smoke: every control on the main tabs has a name', async (page, h) => {
  await h.skipSetup();
  const problems = [];
  for (const tab of ['Home', 'Wallet', 'Activity', 'Markets', 'Profile']) {
    await h.tab(tab);
    await sleep(400);
    const bad = await page.evaluate((vis) => {
      const isVis = eval(vis);
      const out = [];
      for (const b of [...document.querySelectorAll('button, [role="switch"], a')].filter(isVis)) {
        const name = (b.getAttribute('aria-label') || b.textContent || '').trim();
        if (!name) out.push(b.outerHTML.slice(0, 80));
      }
      for (const i of [...document.querySelectorAll('input, textarea')].filter(isVis)) {
        if (!(i.getAttribute('aria-label') || i.placeholder || i.closest('label'))) out.push(i.outerHTML.slice(0, 80));
      }
      return out;
    }, VISIBLE);
    problems.push(...bad.map((b) => `${tab}: ${b}`));
  }
  expect(problems.length === 0, `unnamed controls:\n${problems.join('\n')}`);
});

test('analytics, wallet, goals and calculator work with local data', async (page, h) => {
  await h.skipSetup();
  await h.clickText('Analytics', 'button.link-btn');
  await h.waitText('Income');
  expect(!(await h.hasText('No activity in this period')), 'analytics should have data for the Everyday preset');
  await h.shot('20-analytics');
  await h.back();
  await h.tab('Wallet');
  await h.waitText('Currency balances');
  await h.shot('21-wallet');
  await h.tab('Profile');
  await h.clickText('Goals', 'button.qa');
  await h.waitText('Emergency fund');
  await h.clickText('Add money', 'button', { exact: true });
  await h.type('0', '25');
  await h.clickText('Add money', '.sheet button', { exact: true });
  expect((await h.toastText()).includes('Saved toward'), 'goal contribution');
  // Calculator: decimal-exact arithmetic.
  await h.back();
  await h.clickText('Calculator', 'button.qa');
  for (const k of ['Decimal point', '1', 'Add', 'Decimal point', '2', 'Equals']) await h.clickLabel(k);
  expect(await h.hasText('0.3'), 'calculator: 0.1 + 0.2 should be exactly 0.3');
});

/* ---------------------------------- Runner --------------------------------- */

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('app/dist is missing — run `npm run build` in app/ first.');
    process.exit(2);
  }
  await mkdir(OUT, { recursive: true });
  if (WANT_SHOTS) await mkdir(SHOTS, { recursive: true });
  const server = BASE_URL ? null : await serve();
  const base = BASE_URL ?? `http://127.0.0.1:${server.address().port}/`;
  const browser = await launch();
  console.log(`VELTRIX UI tests · ${await browser.version()} · ${base}\n`);
  for (const t of tests) {
    if (ONLY && !t.name.includes(ONLY)) continue;
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    page.on('console', (m) => {
      if (m.type() === 'error') consoleProblems.push(`[${t.name}] ${m.text()}`);
    });
    page.on('pageerror', (e) => consoleProblems.push(`[${t.name}] pageerror: ${e.message}`));
    const h = helpers(page, base);
    h.base = base;
    const t0 = Date.now();
    try {
      const note = await t.fn(page, h);
      results.push({ name: t.name, ok: true, ms: Date.now() - t0, note });
      console.log(`  ✓ ${t.name} (${Date.now() - t0} ms)${note ? ` — ${note}` : ''}`);
    } catch (e) {
      results.push({ name: t.name, ok: false, ms: Date.now() - t0, error: e.message });
      console.log(`  ✗ ${t.name}\n      ${e.message}`);
      await page.screenshot({ path: join(OUT, `FAIL-${t.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.png`) }).catch(() => {});
    }
    await ctx.close();
  }
  const cspOrConsole = consoleProblems.filter((p) => !/Failed to load resource: net::ERR_/.test(p));
  results.push({ name: 'no console errors or CSP violations in any flow', ok: cspOrConsole.length === 0, ms: 0, error: cspOrConsole.join('\n') || undefined });
  console.log(cspOrConsole.length ? `  ✗ console errors:\n${cspOrConsole.join('\n')}` : '  ✓ no console errors or CSP violations in any flow');
  await browser.close();
  server?.close();
  const passed = results.filter((r) => r.ok).length;
  await writeFile(join(OUT, 'results.json'), JSON.stringify({ date: new Date().toISOString(), passed, total: results.length, results }, null, 2));
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
