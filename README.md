# Pel Dungi for Windows

A Windows port of the Pel Dungi macOS menu-bar app. Unnati lives in the system tray
(bottom-right, near the clock; she may be hidden under the `^` overflow arrow) and pops
up on top of your screen when you ask for her or when a reminder is due.

## Run it

**Without Node (just use it):** double-click

    dist\Pel Dungi-win32-x64\Pel Dungi.exe

Nothing opens. Her face appears in the tray. Click it (left or right click) for the menu:

- **I need motivation**: she floats up on a balloon and plays the motivation recording.
- **Mujhe daanto**: she slides in from the right edge and scolds you.
- **Meeting reminder...**: opens the *Pel Dungi reminders* window.
- **Quit**: exits fully.

Double-clicking the exe again while she is already running opens the reminders window
(only one copy runs at a time).

Click Unnati to send her away. You can drag her a little; she wobbles back. Pull her
hard off a window title bar and she falls. Clicks anywhere else go through to the
windows underneath.

**From source:**

    npm install
    npm start

**Rebuild the packaged app:** `npm run package` (writes `dist\Pel Dungi-win32-x64\`).
The icon `assets\app.ico` is already built. `npm run make-icon` regenerates it from the
Mac `AppIcon.icns` in the Downloads folder.

## Reminders

Type a reminder, pick a time under *Remind me*, optionally add a meeting link, choose a
style, and click **Save reminder**. **See Unnati now, in the style picked above**
previews the style straight away.

- Reminders are saved in `%APPDATA%\Pel Dungi\reminders.json`. They survive restarts.
- The app checks for due reminders every 5 seconds. Each reminder fires once.
- A reminder only fires while the app is running. If the PC was off or the app was closed
  at the reminder time, it still fires on the next start, but only if it is less than
  10 minutes late. Older ones are marked *Missed* in the list and do not pop up.
- Links must be `http://` or `https://`. If you type `meet.google.com/...`, `https://`
  is added for you.
- A log of the last run is in `%APPDATA%\Pel Dungi\pel-dungi.log`.

## Start it when you sign in (optional)

The app does not register itself to start at login. To start it at login:

1. Press `Win + R`, type `shell:startup`, press Enter. A folder opens.
2. In another Explorer window, right-click `dist\Pel Dungi-win32-x64\Pel Dungi.exe` and
   choose **Show more options > Create shortcut**.
3. Move the shortcut into the `shell:startup` folder.

To stop it starting at login, delete the shortcut from that folder.

## How it differs from the Mac version

- **Tray instead of menu bar.** The menu has the same items. A left click opens the menu,
  the same as clicking the Mac status item.
- **No top menu bar.** The page was written for the Mac's 25px menu bar. Windows has no
  such bar, so the top offset is set to almost zero. If your taskbar is at the top of
  the screen, its height is used instead.
- **Taskbar instead of dock.** The car drives along the top of the taskbar when the
  taskbar is at the bottom. A taskbar on the side or at the top does not count as the
  bottom offset.
- **Active window.** She peeks from behind, or lands on, the window you were last using.
  Clicking the tray makes the taskbar the active window, so the app remembers the last
  real window you used before that. Windows that fill the screen (maximized) leave no
  room to peek from. In that case she uses the screen-edge scenes instead, the same as
  on the Mac.
- **Primary screen only.** The overlay covers the primary display. If your active window
  is on another monitor, the scenes that need a window are skipped.
- **Reminder catch-up.** The 10-minute limit for late reminders is new in this port (see
  above). How the Mac app handled reminders that were missed while it was closed is not
  known.
- **Layout of the reminders window.** The Mac layout could not be recovered. This window
  uses the Mac app's text and colours, in a new layout.

## Debug flags

These do nothing unless you pass them. They exist for testing. **Scenes play real audio**
unless you add `--debug-mute`.

| Flag | What it does |
| --- | --- |
| `--debug-scenes=all` or `=peek,shout,...` | Plays each scene/mode in turn (`winpeek, peek, shout, car, onwin, balloon, motivation, scold, meeting`). Logs the style the page picked, whether audio started, and when the page reported `done`. Calls the page's own `leave()` after `--debug-leave-ms` (default 6000) for scenes that wait for a click. Also available as the env var `PELDUNGI_DEBUG_SCENES`. |
| `--debug-shot-ms=1500,3500` | When to screenshot each scene (ms after it starts). |
| `--debug-shots=<dir>` | Where to save the screenshots (default `verification\`; required for the packaged exe). |
| `--debug-link=<url>` / `--debug-text=<text>` | The link and text passed to non-menu scenes. |
| `--debug-mute` | Mutes the overlay. Playback still runs and is still checked. |
| `--debug-exit` | Quits after `--debug-scenes` finishes. |
| `--debug-exit-after=<s>` | Quits after `s` seconds. |
| `--debug-win` | Logs the active-window rectangle whenever it changes. |
| `--debug-win-rect=x,y,w,h` | Pretends this window rectangle (in DIPs) is the active window. |
| `--debug-add-reminder=<secs>[:style]` | Adds a reminder `secs` from now. It is saved to your real reminders file. |
| `--debug-reminders-window` | Opens the reminders window at startup and screenshots it. |
| `--debug-reminders-ui-test` | Tests the reminders form: past time, bad link, then save and remove. |
| `--debug-close-reminders-ms=<ms>` | Closes the reminders window after `ms` ms, to check that the app keeps running. |
| `--debug-shot-on-show` | Screenshots every overlay 4 s after it appears. |
| `--debug-open-test` | Makes the page ask to open `file:` and `javascript:` links. Both must be refused. |

Example: `npx electron . --debug-scenes=all --debug-mute --debug-exit`

## Layout

- `src/main.js`: tray, overlay window, click-through, reminders timer, debug runner.
- `src/win32.js`: finds the foreground window through Win32 calls, using `koffi` (prebuilt, no compiler needed).
- `src/preload-stage.js`: provides `window.webkit.messageHandlers.agent.postMessage` to the unmodified Mac page.
- `src/reminders.*`, `src/preload-reminders.js`: the reminders window.
- `src/reminders-store.js`: the JSON reminder store.
- `web/`: copied unchanged from the Mac app (`stage.html`, art, voice clips, font).
- `verification/`: screenshots taken while testing.
