// Foreground-window lookup through Win32, via koffi (prebuilt FFI, no C++ toolchain).
// Returns rectangles in PHYSICAL screen pixels; the caller converts to DIPs.
// Everything is wrapped so a failure here only means "no window rect", never a crash.
let api = null;
let loadError = null;

function load() {
  if (api || loadError) return api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const dwmapi = koffi.load('dwmapi.dll');
    const RECT = koffi.struct('PD_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    const HWND = koffi.pointer('PD_HWND', koffi.opaque());
    api = {
      koffi, RECT,
      GetForegroundWindow: user32.func('PD_HWND __stdcall GetForegroundWindow()'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(PD_HWND hWnd, _Out_ uint32 *pid)'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(PD_HWND hWnd, _Out_ uint16 *buf, int max)'),
      IsWindow: user32.func('bool __stdcall IsWindow(PD_HWND hWnd)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(PD_HWND hWnd)'),
      IsIconic: user32.func('bool __stdcall IsIconic(PD_HWND hWnd)'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(PD_HWND hWnd, _Out_ PD_RECT *rect)'),
      DwmGetWindowAttribute: dwmapi.func('long __stdcall DwmGetWindowAttribute(PD_HWND hWnd, uint32 attr, _Out_ PD_RECT *rect, uint32 size)'),
      // DWMWA_CLOAKED (14) takes a DWORD; declared separately so the out-type matches.
      DwmGetCloaked: dwmapi.func('DwmGetWindowAttribute', 'long', ['PD_HWND', 'uint32', koffi.out(koffi.pointer('uint32')), 'uint32']),
    };
  } catch (e) {
    loadError = e;
    api = null;
  }
  return api;
}

// Shell surfaces that are never "the window you are working in".
const SHELL_CLASSES = new Set([
  'Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland', 'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow',
  'ForegroundStaging', 'MultitaskingViewFrame', 'TaskListThumbnailWnd', '#32768', // #32768 = popup menu
]);
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;

function className(a, hwnd) {
  const buf = new Uint16Array(256);
  const n = a.GetClassNameW(hwnd, buf, 256);
  return n > 0 ? String.fromCharCode(...buf.subarray(0, n)) : '';
}

let lastReject = '';
function reject(why) { lastReject = why; return null; }

// Describe a window, or return null if it is not a usable "active window" candidate.
function describe(hwnd, ownPid) {
  const a = load();
  if (!a || !hwnd) return null;
  try {
    if (!a.IsWindow(hwnd) || !a.IsWindowVisible(hwnd) || a.IsIconic(hwnd)) return reject('not a visible, restored window');
    const pid = [0];
    a.GetWindowThreadProcessId(hwnd, pid);
    if (pid[0] === ownPid) return reject('own window');
    const cls = className(a, hwnd);
    if (SHELL_CLASSES.has(cls)) return reject('shell window ' + cls);
    const cloaked = [0];
    if (a.DwmGetCloaked(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0]) return reject('cloaked ' + cls);
    const r = {};
    // Extended frame bounds exclude the invisible resize borders Windows 10/11 adds.
    let ok = a.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, a.koffi.sizeof(a.RECT)) === 0;
    if (!ok) ok = a.GetWindowRect(hwnd, r);
    if (!ok) return null;
    const w = r.right - r.left, h = r.bottom - r.top;
    if (w <= 0 || h <= 0) return null;
    return { hwnd: '0x' + a.koffi.address(hwnd).toString(16), cls, pid: pid[0], x: r.left, y: r.top, w, h };
  } catch (e) {
    return reject('error ' + e.message);
  }
}

// The foreground window right now (or null if it is ours / the shell / unusable).
function foregroundWindow(ownPid) {
  const a = load();
  if (!a) return null;
  try {
    const hwnd = a.GetForegroundWindow();
    return hwnd ? { handle: hwnd, info: describe(hwnd, ownPid) } : null;
  } catch (e) {
    return null;
  }
}

module.exports = { load, describe, foregroundWindow, loadError: () => loadError, lastReject: () => lastReject };
