# How `simulang` works on macOS

`@simular-ai/simulang-js` is a NAPI-RS Node binding over the Rust crate
`simulang-rs`. The Node package is a thin wrapper; everything substantive —
including all macOS platform code — lives in the Rust crate
(`simular-ai/simulang-rs-internal`, private). Platform specifics sit behind
`#[cfg(target_os = "macos")]` guards in that crate; the binding layer just
re-exposes the cross-platform Rust traits.

```
your demo.mts
     │
     ▼
@simular-ai/simulang-js         (public, NAPI-RS cdylib)
     │   thin #[napi] wrappers around `simulang_rs::*`
     ▼
simulang-rs                     (private)
     │   #[cfg(target_os = "macos")] impls
     ▼
┌──────────────┬───────────────┬─────────────────┬──────────────┬─────────────┐
│ Accessibility│ CoreGraphics  │ AppKit          │ Screen-      │ cpal/rodio  │
│ (AXUIElement)│ (CGEvent,     │ (NSWorkspace,   │ CaptureKit   │ (CoreAudio  │
│              │  CGWindowList)│  NSPasteboard,  │ (capture +   │  playback)  │
│              │               │  NSRunningApp)  │  loopback)   │             │
└──────────────┴───────────────┴─────────────────┴──────────────┴─────────────┘
```

## Subsystems

### Accessibility tree
- `AXUIElementCreateApplication(pid)` from the frontmost app's PID
  (via `NSWorkspace.frontmostApplication.processIdentifier`).
- `AXUIElementCopyAttributeValue(kAX{Role,Title,Description,Value,Children,Position,Size,…}Attribute)`
  drives `AccessibilityNode` / `AccessibilityTree`.
- `kAXSubroleAttribute` is mapped to the cross-platform `className` field.
- `Window.snapshot()` emits raw AX roles like `AXWindow`, `AXButton`.
- AX actions: `AXUIElementPerformAction(kAXPressAction)` powers
  `.activate()`; `AXUIElementSetAttributeValue(kAXValueAttribute, …)`
  powers `.setValue()`; `kAXFocusedAttribute` powers `.setFocus()`, etc.
- `enableAccessibilityForFrontmostApp()` toggles the non-standard
  `AXManualAccessibility` attribute — many Chromium / Electron apps disable
  their AX tree by default to save IPC cost.

### Mouse & keyboard
- `CGEventCreateMouseEvent` + `CGEventPost(kCGHIDEventTap, …)` for moves,
  clicks, drags; `CGEventCreateScrollWheelEvent` for scroll.
- `CGEventCreateKeyboardEvent(keycode, down)` for named keys.
- `text(...)` uses `CGEventKeyboardSetUnicodeString` per character, so it's
  **layout-independent** (a US-QWERTY script still works on Dvorak/AZERTY).
- All coordinates are **global physical pixels** (device pixels), not
  CSS/logical points.

### Screen capture
- `SCScreenshotManager.captureImageWithFilter:configuration:` from
  **ScreenCaptureKit** (macOS 12.3+).
- `hideCursor` maps to `SCContentFilter` exclusion options.
- Returned `Screenshot` exposes `.shrink()`, `.compress()`, `.addGrid()`,
  `.base64()`, `.save()`, and a `.toGlobalPhysicalPixels()` helper that
  converts normalized VLM coords (e.g. UI-TARS / Qwen-VL 0–1000 outputs)
  back to screen pixels.
- The optional log-viewer window uses `NSWindowSharingNone` so it never
  appears in `screenshotFull` / `screenshotCropped`.

### Audio loopback & playback
- Loopback uses `SCStream` audio output via **ScreenCaptureKit** (macOS 13+)
  — no virtual device (BlackHole/Loopback) required.
- `CMSampleBuffer` audio frames → interleaved `f32` PCM → a
  `rodio::Source`-shaped ring buffer.
- Playback (`AudioOutput`, `Player`) uses **`rodio`** over **`cpal`**, which
  drives CoreAudio on macOS. `simulang_rs::rodio` is re-exported publicly.

### App launch
- `NSWorkspace.openURL:options:configuration:` /
  `NSWorkspace.launchApplication:`.
- `FocusPolicy.DoNotSteal` → `NSWorkspaceLaunchWithoutActivation`.
- `Visibility.Hidden` → `NSWorkspaceLaunchAndHide`. Chromium / Electron apps
  routinely ignore this; the crate then re-hides the app post-launch.
- `App.defaultBrowser()` resolves via
  `NSWorkspace.URLForApplicationToOpenURL:` for `https://`.

### Window enumeration & control
- `CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly |
  kCGWindowListExcludeDesktopElements, kCGNullWindowID)` lists visible
  top-level windows.
- Per-PID `kAXWindowsAttribute` gives `AXUIElement` window handles.
- `Window.minimize()` → `kAXMinimizedAttribute = true`.
- `Window.maximize()` → press `kAXZoomButton`.
- `Window.close()` → press `kAXCloseButton`.
- `Window.scoredSearch(...)` walks the AX subtree and ranks nodes by
  bag-of-words Jaccard score against the node's `overallDescription` — find
  controls by concept ("the Send button") instead of brittle selectors.

### Clipboard
- `NSPasteboard.generalPasteboard` with `clearContents` +
  `setString:forType:NSPasteboardTypeString` / `stringForType:`.
- Image flavors via `NSPasteboardTypePNG` / `NSPasteboardTypeTIFF`.
- `Clipboard.pasteText(...)` is a convenience: snapshot existing clipboard →
  set new string → synthesize ⌘V via `CGEvent` → restore previous clipboard.

### Display geometry
- `NSScreen.mainScreen` / `CGMainDisplayID()`; `Screen.dimensions()` returns
  `[x, y, width, height]` in **physical pixels**.
- On a 2× Retina display, a "1920×1080" logical resolution reads as
  3840×2160 from this API. Image and screenshot dimensions follow the same
  convention.

### Permissions (macOS TCC)
| Capability | API | Notes |
|---|---|---|
| Screen Recording | `CGPreflightScreenCaptureAccess()` (no prompt), `CGRequestScreenCaptureAccess()` | Required by `screenshotFull`, `screenshotCropped`, `LoopbackSource`. |
| Accessibility    | `AXIsProcessTrusted()`                          | Required by AX tree reads, AX actions, *and* `CGEvent` posting (mouse/keyboard). |
| Input Monitoring | not needed                                       | That entitlement is for *listening* to system-wide input; *posting* synthetic events only needs Accessibility. |

TCC grants attach to the process that launched Node (typically your
terminal application), not to Node itself. `simulang setup` walks through
prompting and granting these.

### Key mapping platform leakage
The only place macOS specifics leak into the public binding repo is
`src/key.rs`, where `#[cfg]`-gated keys appear:

- macOS-only: `BrightnessUp`/`Down`, `ContrastUp`/`Down`, `Eject`,
  `Function`, `Launchpad`, `LaunchPanel`, `MissionControl`,
  `IlluminationUp`/`Down`/`Toggle`, `VidMirror`, `RCommand`, `ROption`,
  `Power`, `MediaFast`, `MediaRewind`.
- Linux-only (absent on macOS): `Break`, `Begin`, `Linefeed`, `MicMute`,
  `ScrollLock`, `SysReq`, …

## Supported targets

From `package.json`:
- `x86_64-apple-darwin` (Intel)
- `aarch64-apple-darwin` (Apple Silicon)

## Likely Rust crates used internally

(Inferred from functionality — the private crate's `Cargo.toml` is not
public.)

- `objc2`, `objc2-foundation`, `objc2-app-kit` — modern safe Objective-C
  runtime bindings for `NSWorkspace`, `NSPasteboard`, `NSRunningApplication`,
  `NSScreen`.
- `core-graphics`, `core-graphics-types` — `CGEvent`,
  `CGWindowListCopyWindowInfo`, `CGPoint`/`CGSize`/`CGRect`, `CGMainDisplayID`.
- `accessibility-sys` or hand-rolled `core-foundation-sys` — `AXUIElement*`.
- A ScreenCaptureKit binding (`screencapturekit`-rs or direct `objc2`).
- `rodio` + `cpal` — audio playback over CoreAudio (re-exported as
  `simulang_rs::rodio`).
