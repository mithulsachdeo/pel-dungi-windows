// Pel Dungi for Windows: tray app that shows Unnati in a transparent, click-through overlay.
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const win32 = require('./win32');
const { ReminderStore, STYLES } = require('./reminders-store');

// The voice clips must start without a user gesture (she talks as soon as she appears).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const ASSETS = path.join(ROOT, 'assets');

// ---------- command-line / debug flags (documented in README) ----------
function flag(name) {
  const pre = `--${name}=`;
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(pre));
  if (!hit) return undefined;
  return hit === `--${name}` ? true : hit.slice(pre.length);
}

const debugScenes = flag('debug-scenes') || process.env.PELDUNGI_DEBUG_SCENES;

// ---------- logging: stdout plus a log file (a packaged GUI app has no console) ----------
let logFile = null;
function log(...args) {
  const line = `[${new Date().toISOString()}] ` + args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  console.log(line);
  if (logFile) { try { fs.appendFileSync(logFile, line + '\n'); } catch (e) { /* logging must never crash the app */ } }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Launching it again (e.g. double-clicking the exe) opens the reminders window instead.
  app.on('second-instance', () => { log('[app] second instance started; showing reminders window'); openRemindersWindow(); });
  app.whenReady().then(start);
}

// Tray app: closing the reminders window must not quit.
app.on('window-all-closed', () => {});

let tray = null;
let store = null;
let remindersWin = null;

// ---------- active window tracking ----------
// Clicking the tray makes the taskbar the foreground window, so remember the last
// real (non-shell, non-ours) foreground window and fall back to it.
let lastGood = null;
let lastLogged = '';
function pollForeground() {
  const f = win32.foregroundWindow(process.pid);
  if (f && f.info) lastGood = f.handle;
  if (flag('debug-win')) { // log every change of the usable foreground window
    const key = f && f.info ? JSON.stringify(f.info) : '';
    if (key && key !== lastLogged) { lastLogged = key; log('[debug] foreground changed', activeWindowRect() || 'none'); }
  }
}

function activeWindowRect() {
  const f = win32.foregroundWindow(process.pid);
  let info = f && f.info;
  let source = 'foreground';
  if (!info && lastGood) { info = win32.describe(lastGood, process.pid); source = 'last-foreground'; }
  if (!info) { log('[win] no usable active window:', win32.lastReject() || 'none found'); return null; }
  const dip = screen.screenToDipRect(null, { x: info.x, y: info.y, width: info.w, height: info.h });
  const b = screen.getPrimaryDisplay().bounds;
  const cx = dip.x + dip.width / 2, cy = dip.y + dip.height / 2;
  // The overlay only covers the primary screen; a window elsewhere cannot be peeked from.
  if (cx < b.x || cx > b.x + b.width || cy < b.y || cy > b.y + b.height) {
    log('[win] active window is not on the primary display, omitting', info);
    return null;
  }
  return {
    x: Math.round(dip.x - b.x), y: Math.round(dip.y - b.y), w: Math.round(dip.width), h: Math.round(dip.height),
    source, physical: info,
  };
}

// ---------- overlay ----------
let overlay = null;
let overlayDone = null;   // callbacks waiting for the current overlay to close
let hitRects = [];
let capture = false;
let mouseIgnored = true;
let cursorTimer = null;

function screenInsets(display) {
  const b = display.bounds, wa = display.workArea;
  const fullWidth = wa.width === b.width;
  const bottom = fullWidth ? (b.y + b.height) - (wa.y + wa.height) : 0; // only a bottom taskbar counts
  const top = fullWidth ? wa.y - b.y : 0;
  return { top: Math.max(0, top), bottom: Math.max(0, bottom) };
}

function showOverlay({ style, text = '', link = '', outfit, voice } = {}, reason = 'menu') {
  let rect = activeWindowRect();   // before our window exists, so it cannot be the foreground
  const forced = flag('debug-win-rect'); // debug only: pretend this x,y,w,h (DIP) window is active
  if (forced && /^\d+,\d+,\d+,\d+$/.test(forced)) {
    const [x, y, w, h] = forced.split(',').map(Number);
    rect = { x, y, w, h, source: 'debug-win-rect' };
  }
  closeOverlay('replaced');

  const display = screen.getPrimaryDisplay();
  const b = display.bounds;
  const insets = screenInsets(display);
  const query = {
    // The page does `+top||25` (Mac menu bar). Windows has no top bar, and 0 would turn
    // into 25, so pass a negligible non-zero value unless the taskbar really is on top.
    top: String(insets.top || 0.01),
    bottom: String(insets.bottom),
    style: style || 'random',
  };
  if (text) query.text = text;
  if (link) query.link = link;
  if (outfit) query.outfit = outfit;
  if (voice) query.voice = voice;
  if (rect) query.win = [rect.x, rect.y, rect.w, rect.h].join(',');
  log(`[overlay] show (${reason})`, query, rect ? { winSource: rect.source, physical: rect.physical } : 'no active window');

  hitRects = []; capture = false; mouseIgnored = true;
  const w = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    transparent: true, frame: false, backgroundColor: '#00000000', hasShadow: false, thickFrame: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false, show: false,
    type: 'toolbar', // WS_EX_TOOLWINDOW: keeps it out of Alt+Tab
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-stage.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
    },
  });
  overlay = w;
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setIgnoreMouseEvents(true, { forward: true });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.webContents.on('console-message', (_e, level, message) => log(`[stage console:${level}]`, message));
  w.webContents.on('render-process-gone', (_e, d) => { log('[overlay] renderer gone', d); closeOverlay('crash'); });
  w.webContents.on('did-fail-load', (_e, code, desc) => { log('[overlay] load failed', code, desc); closeOverlay('load-failed'); });
  w.once('ready-to-show', () => {
    if (w.isDestroyed()) return;
    w.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height }); // Windows can nudge frameless bounds on DPI changes
    w.showInactive(); // do not steal focus from the window she is peeking around
  });
  w.on('closed', () => { if (overlay === w) finishOverlay(); });
  w.loadFile(path.join(WEB, 'stage.html'), { query });
  if (flag('debug-mute')) w.webContents.setAudioMuted(true);
  if (flag('debug-shot-on-show')) {
    const dir = path.resolve(String(flag('debug-shots') || path.join(ROOT, 'verification')));
    setTimeout(() => { if (!w.isDestroyed()) { fs.mkdirSync(dir, { recursive: true }); capture_(w, path.join(dir, `${reason}-${query.style}.png`)); } }, 4000);
  }

  cursorTimer = setInterval(updateMouse, 25);
  return w;
}

// Click-through except over the elements the page reports, or while she is being dragged.
function updateMouse() {
  if (!overlay || overlay.isDestroyed()) return;
  const p = screen.getCursorScreenPoint();
  const ob = overlay.getBounds();
  const x = p.x - ob.x, y = p.y - ob.y;
  const inside = capture || hitRects.some(([l, t, wd, ht]) => x >= l && x <= l + wd && y >= t && y <= t + ht);
  if (inside === !mouseIgnored) return;
  mouseIgnored = !inside;
  if (debugScenes) log(`[debug] mouse ${inside ? 'captured' : 'click-through'} at ${x},${y}${capture ? ' (drag)' : ''}`);
  if (mouseIgnored) overlay.setIgnoreMouseEvents(true, { forward: true });
  else overlay.setIgnoreMouseEvents(false);
}

function finishOverlay() {
  clearInterval(cursorTimer); cursorTimer = null;
  overlay = null; hitRects = []; capture = false;
  const cbs = overlayDone || []; overlayDone = null;
  cbs.forEach(cb => { try { cb(); } catch (e) { log('[overlay] done callback failed', e.message); } });
}

function closeOverlay(why) {
  if (!overlay) return;
  const w = overlay;
  log(`[overlay] close (${why})`);
  finishOverlay();
  if (!w.isDestroyed()) w.destroy();
}

function whenOverlayCloses(cb) { (overlayDone = overlayDone || []).push(cb); }

function openLink(url) {
  let u;
  try { u = new URL(String(url)); } catch (e) { u = null; }
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) { log('[open] rejected non-http(s) link', String(url)); return false; }
  log('[open]', u.href);
  shell.openExternal(u.href);
  return true;
}

const stageListeners = new Set(); // debug runner taps messages here
ipcMain.on('stage:message', (e, m) => {
  if (!overlay || e.sender !== overlay.webContents || !m || typeof m !== 'object') return;
  stageListeners.forEach(fn => fn(m));
  switch (m.type) {
    case 'style': log('[stage] style', { style: m.style, outfit: m.outfit }); break;
    case 'hit':
      if (Array.isArray(m.rects)) {
        hitRects = m.rects.slice(0, 64).filter(r => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite));
      }
      break;
    case 'capture': capture = !!m.on; updateMouse(); break;
    case 'open': openLink(m.url); break;
    case 'done': log('[stage] done'); closeOverlay('done'); break;
    default: log('[stage] unknown message', m);
  }
});

// ---------- reminders ----------
const STYLE_LABELS = {
  meeting: 'Meeting (she drives in by car)',
  balloon: 'Balloon (for meetings)',
  motivation: 'I need motivation (balloon)',
  scold: 'Mujhe daanto (she slides in)',
};

// Accept "meet.google.com/abc" as well as full URLs; anything not http(s) is refused.
function normalizeLink(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s;
  try {
    const u = new URL(withScheme);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch (e) { return null; }
}

function fromReminders(e) { return remindersWin && !remindersWin.isDestroyed() && e.sender === remindersWin.webContents; }
function notifyRemindersChanged() {
  if (remindersWin && !remindersWin.isDestroyed()) remindersWin.webContents.send('reminders:changed');
}

ipcMain.handle('reminders:list', (e) => (fromReminders(e) ? { items: store.list(), labels: STYLE_LABELS } : null));
ipcMain.handle('reminders:add', (e, r) => {
  if (!fromReminders(e) || !r) return { error: 'Not allowed.' };
  const at = Number(r.at);
  if (!Number.isFinite(at)) return { error: 'Pick a time.' };
  if (at <= Date.now()) return { error: 'That time has already passed. Pick a later time.' };
  const link = normalizeLink(r.link);
  if (link === null) return { error: 'That link does not look like a web address.' };
  const saved = store.save({ text: String(r.text || '').slice(0, 200), link, style: STYLES.includes(r.style) ? r.style : 'meeting', at });
  log('[reminders] saved', saved);
  notifyRemindersChanged();
  return { ok: true };
});
ipcMain.handle('reminders:remove', (e, id) => {
  if (!fromReminders(e)) return;
  store.remove(String(id));
  notifyRemindersChanged();
});
ipcMain.handle('reminders:preview', (e, r) => {
  if (!fromReminders(e) || !r) return { error: 'Not allowed.' };
  const link = normalizeLink(r.link);
  if (link === null) return { error: 'That link does not look like a web address.' };
  showOverlay({ style: STYLES.includes(r.style) ? r.style : 'meeting', text: String(r.text || '').slice(0, 200), link }, 'preview');
  return { ok: true };
});

function checkReminders() {
  if (overlay) return; // let the current scene finish; the reminder fires on the next tick
  const due = store.firstDue();
  if (!due) return;
  // Mark first so a crash or quit mid-scene can never make a one-off reminder repeat.
  store.markFired(due.id);
  notifyRemindersChanged();
  log('[reminders] firing', due);
  showOverlay({ style: due.style, text: due.text, link: due.link }, 'reminder');
}

function openRemindersWindow() {
  if (remindersWin && !remindersWin.isDestroyed()) { remindersWin.show(); remindersWin.focus(); return remindersWin; }
  const workH = screen.getPrimaryDisplay().workArea.height;
  remindersWin = new BrowserWindow({
    width: 440, height: Math.min(780, workH - 40), minWidth: 380, minHeight: 480,
    title: 'Pel Dungi reminders', icon: path.join(ASSETS, 'app.ico'),
    backgroundColor: '#efe5d8', autoHideMenuBar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-reminders.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  remindersWin.removeMenu();
  remindersWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  remindersWin.webContents.on('will-navigate', e => e.preventDefault());
  remindersWin.once('ready-to-show', () => remindersWin.show());
  remindersWin.on('closed', () => { remindersWin = null; });
  remindersWin.loadFile(path.join(__dirname, 'reminders.html'));
  return remindersWin;
}

// ---------- tray ----------
function trayIcon() {
  const src = nativeImage.createFromPath(path.join(ASSETS, 'menu-face.png'));
  const img = nativeImage.createEmpty();
  for (const scale of [1, 1.25, 1.5, 2]) {
    const px = Math.round(16 * scale);
    img.addRepresentation({ scaleFactor: scale, buffer: src.resize({ width: px, height: px, quality: 'best' }).toPNG() });
  }
  return img;
}

function buildTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Pel Dungi');
  const menu = Menu.buildFromTemplate([
    { label: 'I need motivation', click: () => showOverlay({ style: 'motivation' }, 'menu') },
    { label: 'Mujhe daanto', click: () => showOverlay({ style: 'scold' }, 'menu') },
    { type: 'separator' },
    { label: 'Meeting reminder...', click: () => openRemindersWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  // On the Mac the icon's menu opens on a plain click; do the same on left-click here.
  tray.on('click', () => tray.popUpContextMenu());
}

// ---------- debug runner (only active with --debug-* flags; see README) ----------
const DEBUG_ALL = ['winpeek', 'peek', 'shout', 'car', 'onwin', 'balloon', 'motivation', 'scold', 'meeting'];
const AUTO_MODES = new Set(['motivation', 'scold']);

function capture_(w, file) {
  return w.webContents.capturePage().then(img => { fs.writeFileSync(file, img.toPNG()); log('[debug] screenshot', file); })
    .catch(e => log('[debug] screenshot failed', file, e.message));
}

async function audioState(w) {
  try {
    return await w.webContents.executeJavaScript(
      '({src:voice.src.split("/").pop(),t:+voice.currentTime.toFixed(2),dur:+(voice.duration||0).toFixed(2),paused:voice.paused,ended:voice.ended,error:voice.error&&voice.error.code})', true);
  } catch (e) { return { error: 'eval failed: ' + e.message }; }
}

function runDebugScene(name, opts) {
  return new Promise(resolve => {
    const result = { name, styleMsg: null, hitMsgs: 0, mediaStarted: 0, audio: [], done: false, closedBy: null, ms: 0 };
    const t0 = Date.now();
    const timers = [];
    const listener = m => {
      if (m.type === 'style') result.styleMsg = { style: m.style, outfit: m.outfit };
      else if (m.type === 'hit') result.hitMsgs++;
      else if (m.type === 'done') result.done = true;
    };
    stageListeners.add(listener);
    // motivation/scold come from the tray menu, which never passes text or a link
    const fromMenu = AUTO_MODES.has(name);
    const w = showOverlay(fromMenu ? { style: name } : { style: name, text: opts.text, link: opts.link }, 'debug');
    w.webContents.on('media-started-playing', () => { result.mediaStarted++; });
    for (const ms of opts.shots) {
      timers.push(setTimeout(() => { if (!w.isDestroyed()) capture_(w, path.join(opts.shotDir, `${name}-${ms}ms.png`)); }, ms));
    }
    if (flag('debug-open-test')) { // the page asking for non-web links must be refused
      timers.push(setTimeout(() => {
        if (!w.isDestroyed()) w.webContents.executeJavaScript(`post({type:'open',url:'file:///C:/Windows/System32/calc.exe'});post({type:'open',url:'javascript:alert(1)'})`, true);
      }, 1000));
    }
    // Sample the voice clip after it should have started (scenes start it at 0.4-2.5 s).
    timers.push(setTimeout(async () => { if (!w.isDestroyed()) result.audio.push(await audioState(w)); }, 4000));
    // Scenes without auto-leave wait for a click; simulate it by calling the page's own leave().
    {
      timers.push(setTimeout(async () => {
        if (w.isDestroyed()) return;
        result.audio.push(await audioState(w));
        if (AUTO_MODES.has(name)) return; // these leave by themselves when the clip ends
        log(`[debug] ${name}: calling leave() (stands in for the click)`);
        w.webContents.executeJavaScript('leave()', true).catch(e => log('[debug] leave() failed', e.message));
      }, opts.leaveAfter));
    }
    timers.push(setTimeout(() => { if (!w.isDestroyed()) { log(`[debug] ${name}: timed out`); closeOverlay('debug-timeout'); } }, 150000));
    whenOverlayCloses(() => {
      timers.forEach(clearTimeout);
      stageListeners.delete(listener);
      result.closedBy = result.done ? 'done-message' : 'other';
      result.ms = Date.now() - t0;
      log('[debug] RESULT', result);
      resolve(result);
    });
  });
}

async function runDebugScenes(list) {
  const shotDir = path.resolve(String(flag('debug-shots') || path.join(ROOT, 'verification')));
  fs.mkdirSync(shotDir, { recursive: true });
  const opts = {
    shotDir,
    text: String(flag('debug-text') || 'Team call in 5 minutes'),
    link: flag('debug-link') ? String(flag('debug-link')) : '',
    shots: String(flag('debug-shot-ms') || '1500,3500').split(',').map(Number).filter(Boolean),
    leaveAfter: Number(flag('debug-leave-ms') || 6000),
  };
  const results = [];
  for (const name of list) {
    log(`[debug] ===== ${name} =====`);
    results.push(await runDebugScene(name, opts));
    await new Promise(r => setTimeout(r, 800));
  }
  log('[debug] SUMMARY', results.map(r => ({
    name: r.name, style: r.styleMsg && r.styleMsg.style, audioStarted: r.mediaStarted > 0,
    audioError: r.audio.some(a => a && a.error), done: r.done, ms: r.ms,
  })));
}

// ---------- startup ----------
async function start() {
  app.setAppUserModelId('com.shivali.peldungi.windows');
  logFile = path.join(app.getPath('userData'), 'pel-dungi.log');
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(logFile, ''); } catch (e) { logFile = null; }
  log('[app] start', { version: app.getVersion(), electron: process.versions.electron, userData: app.getPath('userData'), argv: process.argv.slice(1) });

  if (!win32.load()) log('[win] Win32 helper unavailable, active-window scenes will fall back', String(win32.loadError()));
  store = new ReminderStore(path.join(app.getPath('userData'), 'reminders.json'));
  log('[reminders] loaded', store.list().length, 'from', store.file);

  buildTray();
  setInterval(pollForeground, 400);
  setInterval(checkReminders, 5000);
  checkReminders();

  // --- optional debug hooks ---
  if (flag('debug-win')) {
    const show = () => log('[debug] active window', activeWindowRect() || 'none');
    show(); setTimeout(show, 3000);
  }
  const addIn = flag('debug-add-reminder');
  if (addIn) {
    const [secs, style] = String(addIn).split(':');
    const r = store.save({ text: 'Debug reminder: team call', link: normalizeLink(flag('debug-link') || '') || '', style: style || 'meeting', at: Date.now() + Number(secs) * 1000 });
    log('[debug] added reminder', r);
  }
  if (flag('debug-reminders-window')) {
    const w = openRemindersWindow();
    w.webContents.once('did-finish-load', () => setTimeout(() => {
      const dir = path.resolve(String(flag('debug-shots') || path.join(ROOT, 'verification')));
      fs.mkdirSync(dir, { recursive: true });
      capture_(w, path.join(dir, 'reminders-window.png'));
    }, 800));
  }
  if (flag('debug-close-reminders-ms')) { // checks the app survives its only window closing
    setTimeout(() => { if (remindersWin) { log('[debug] closing reminders window'); remindersWin.close(); } }, Number(flag('debug-close-reminders-ms')));
  }
  if (flag('debug-reminders-ui-test')) {
    // Drive the real form: a past time must be refused, a future one saved and listed.
    const w = openRemindersWindow();
    const js = s => w.webContents.executeJavaScript(s, true);
    const pause = ms => new Promise(r => setTimeout(r, ms));
    w.webContents.once('did-finish-load', async () => {
      await pause(500);
      const fill = (t, link) => `(() => { const d = new Date(Date.now() + (${t})); const p = n => String(n).padStart(2, '0');
        document.getElementById('at').value = d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes());
        document.getElementById('text').value = 'UI test reminder'; document.getElementById('link').value = ${JSON.stringify(link)};
        document.getElementById('style').value = 'balloon'; document.querySelector('button[type=submit]').click(); })()`;
      await js(fill(-5 * 60 * 1000, '')); await pause(500);
      log('[debug] ui-test past time ->', await js(`document.getElementById('error').textContent`));
      await js(fill(3 * 60 * 1000, 'ftp://example.com')); await pause(500);
      log('[debug] ui-test ftp link ->', await js(`document.getElementById('error').textContent`));
      await js(fill(3 * 60 * 1000, 'meet.google.com/abc-defg-hij')); await pause(500);
      log('[debug] ui-test future time -> error:', JSON.stringify(await js(`document.getElementById('error').textContent`)),
        'list:', await js(`[...document.querySelectorAll('#list li')].map(li => li.innerText.replace(/\\s+/g, ' ')).join(' | ')`));
      const dir = path.resolve(String(flag('debug-shots') || path.join(ROOT, 'verification')));
      await capture_(w, path.join(dir, 'reminders-window-with-item.png'));
      await js(`[...document.querySelectorAll('#list li')].filter(li => li.innerText.includes('UI test reminder')).forEach(li => li.querySelector('.remove').click())`);
      await pause(500);
      log('[debug] ui-test after remove -> UI test items left in store:', store.list().filter(r => r.text === 'UI test reminder').length);
    });
  }
  const scenes = debugScenes;
  if (scenes) {
    const list = scenes === true || scenes === 'all' ? DEBUG_ALL : String(scenes).split(',').map(s => s.trim()).filter(Boolean);
    setTimeout(() => runDebugScenes(list).then(() => { if (flag('debug-exit')) app.quit(); }), 1500);
  } else if (flag('debug-exit-after')) {
    setTimeout(() => app.quit(), Number(flag('debug-exit-after')) * 1000);
  }
}

app.on('before-quit', () => { closeOverlay('quit'); log('[app] quit'); });
