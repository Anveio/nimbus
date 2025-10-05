# Renderer Core Contract

This document defines the renderer-agnostic contract that hosts (React, vanilla DOM, native embeddings) use to integrate terminal renderers. It assumes renderers own the VT runtime lifecycle and control when frames are produced. Hosts provide surfaces, user input, theming, accessibility hints, and external data streams.

## Terminology

- **Renderer** – implementation that owns a `TerminalRuntime`, renders frames (CPU canvas, WebGL, WebGPU, native, etc.), and exposes the contract below.
- **Host** – environment embedding the renderer (React component, raw DOM app, Electron window, native shell).
- **Surface** – the environment the renderer draws into (DOM node, HTMLCanvasElement, OffscreenCanvas, custom drawing API).
- **Dispatch event** – message sent from host to renderer to mutate runtime state, deliver input, or update host configuration.

## Top-level API

```ts
/**
 * The renderer implementation can decide all of its own configuration, it must export a 
 * `createRenderer` functino.
 * */
const createRenderer: (config: TRendererConfig) => Promise<RendererInstance<TRendererConfig>>;
```

- Assume `createRenderer` resolves asynchronously (shader compilation, asset loading). Hosts await it before mounting.

## RendererInstance

```ts
interface RendererInstance<TRendererConfig> {
  mount(surface?: RenderSurface<TRendererConfig>): void;
  unmount(): void;
  dispatch(event: RendererEvent<TRendererConfig>): void;
  onFrame(listener: (event: RendererFrameEvent<TRendererConfig>) => void): () => void;
  /**
   * Should empty the renderer's buffer, also called
   * */
  reset(): void;
  /**
   * Get the internal representation, for observability
   * */
  serializeBuffer?(): Promise<ImageBitmap | Uint8Array>;
  /**
   * Get access to the underlying runtime in order to manipulate the interpreter directly,
   * e.g. `moveCursorLeft`, `moveCursorRight`
   * */
  getRuntime(): TerminalRuntime;
}
```

- `mount` attaches the renderer to some kind of host UI element (a canvas element, an svg element, or another type of presentable host, in the case of custom renderer implementations not provided by Mana)
- `unmount` Dispatches to the renderer after it has been unmounted MUST no-op.
- `reset` Resets the renderer's buffer and the underlying interpreter to the initial state. Used to free up memory and release resources.
- `dispatch` is synchronous fire-and-forget. Renderers MUST queue work and schedule frames as needed.
- `onFrame` onFrame MUST be invoked each time pixels are pushed to the screen in a discrete frame. Returns a deregistration function.
- `getRuntime` exposes imperative utilities for hosts/tests to directly manipulate the underlying runtime by calling its methods, e.g. `moveCursorLeft`, ` `getRuntime` must return the same object across calls.


## RenderSurface

Surfaces allow renderers to target multiple environments without hard-coding DOM logic.

```ts
type RenderSurface<TRendererConfig> =
  | { element: HTMLElement }
  | {
      element: TRendererConfig['element'] // For custom implementations of a renderer targeting a custom surface
    };
```

- If a renderer requires a specific surface kind, it must throw from `mount` when an incompatible kind is provided (with a descriptive error).

## Dispatch Events

```ts
type RendererEvent<TRendererConfig> =
  | { type: 'data'; payload: string | Uint8Array } // Renderer forwards these to the underlying runtime
  | { type: 'host-state'; payload: HostStateSnapshot<TRendererConfig> }
  /** Zoom level, resize from remote pty, resize from local shell */
  | { type: 'resize'; payload: ViewportMetrics<TRendererConfig> }
  | { type: 'selection'; payload: SelectionOverlay<TRendererConfig> }
  | { type: 'runtime-reset'; payload?: Partial<RendererRuntimeConfig<TRendererConfig>> }

interface ViewportMetrics<TRendererConfig> {
  readonly cols: number
  readonly rows: number
  /** $TODO: Need some way to declare the dimensions of a single quad **/
}
```

Renderers must support all event kinds; unrecognised events should throw with a clear error. When the host environment (e.g. a web application) forwards user events to the renderer, it should serialize the event properly

### HostStateSnapshot

Host state is a complete snapshot, not a partial diff. Hosts must resend the full object whenever any field changes.

```ts
interface HostStateSnapshot {
  theme: RendererTheme;
  accessibility: {
    highContrast: boolean;
    reducedMotion: boolean;
    colorScheme: 'light' | 'dark' | 'system';
  };
  overlays: {
    selection?: TerminalSelection | null;
    cursor?: CursorOverride | null;
    highlights?: RendererHighlight[];
    layers?: Record<string, unknown>;
  };
  viewport: {
    rows: number;
    columns: number;
    metrics: RendererMetrics;
  };
}
```

- Renderers may diff snapshots, but hosts should assume that every dispatch may trigger a repaint.
- `CursorOverride` adjusts shape/color/opacity/visibility independently of interpreter state.
- `RendererHighlight` describes host-driven highlight bands (search results, diagnostics markers).

### UserInputEvent

High-level input descriptor standardised across hosts:

```ts
type UserInputEvent =
  | { type: 'key'; key: string; code: string; alt: boolean; ctrl: boolean; meta: boolean; shift: boolean }
  | { type: 'text'; value: string } // IME commit/paste plain text
  | {
      type: 'pointer';
      kind: 'down' | 'move' | 'up' | 'cancel';
      pointerId: number;
      buttons: number;
      position: { x: number; y: number };
    }
  | { type: 'wheel'; deltaX: number; deltaY: number }
  | { type: 'copy' }
  | { type: 'paste'; data: string }
  | { type: 'focus' | 'blur' };
```

Renderers translate these into interpreter actions (key sequences, selection, scroll) respecting host overlays.

## Frame & Diagnostics Callbacks

```ts
interface RendererFrameEvent<TRendererConfig> {
  backend: string; // web-gl renderer will provide this as 'web-gl'
  timestamp: number; // performance.now() epoch
  approxFrameDuration: number | null;
  dirtyRegion?: { rows: number; columns: number }; // If the renderer supports dirty region tracking
  metadata?: Record<string, unknown>; // Grab bag for whatever the implementer wants to put
  diagnostics?: RendererDiagnostics<TRendererConfig> // Implementation can decide if this is guaranteed or not
}

interface RendererDiagnostics {
  lastFrameDurationMs: number | null;
  lastDrawCallCount: number | null;
  gpu?: {
    frameDurationMs: number | null;
    drawCallCount: number | null;
    bytesUploaded: number | null;
    dirtyRegionCoverage: number | null;
  };
  osc?: { identifier: string; data: string } | null;
  sosPmApc?: { kind: SosPmApcKind; data: string } | null;
  dcs?: { finalByte: number; params: number[]; intermediates: number[]; data: string } | null;
  frameHash?: string;
}
```

Hosts subscribe via `onFrame`. Renderers may emit additional metadata through the generic `metadata` field.

## RendererHandle

Imperative utilities exposed for hosts that need synchronous access:

```ts
interface RendererHandle {

}

interface TerminalState {
  rows: number
  columns: number
  cursor: CursorPosition
  scrollTop: number
  scrollBottom: number
  buffer: TerminalCell[][]
  attributes: TerminalAttributes
  tabStops: Set<number>
  autoWrap: boolean
  originMode: boolean
  cursorVisible: boolean
  title: string
  clipboard: ClipboardEntry | null
  lastSosPmApc: { readonly kind: SosPmApcKind; readonly data: string } | null
  selection: TerminalSelection | null
  charsets: TerminalCharsets
  keypadApplicationMode: boolean
  cursorKeysApplicationMode: boolean
  reverseVideo: boolean
  lineAttributes: Array<'single' | 'double-top' | 'double-bottom'>
  c1Transmission: C1TransmissionMode
  answerback: string
  printer: {
    controller: boolean
    autoPrint: boolean
  }
}
```

## Working Backwards: React Host Integration

How a React-based `<Terminal />` would consume the contract.

1. **Create renderer once per component instance.**

   ```ts

  // Outside the react layer...
  const renderer = createRenderer()

  // Inside <Terminal />

   useLayoutEffect(() => {
     let disposed = false;
     createRenderer().then((renderer) => {
       if (disposed) {
         renderer.unmount();
         return;
       }
     });
     return () => {
       disposed = true;
       rendererRef.current?.unmount();
       rendererRef.current = null;
     };
   }, []);
   ```

2. **Mount on a React-managed surface.** Render the host container, then mount inside a layout effect.

   ```tsx
   const canvasRef = useRef<HTMLCanvasElement | null>(null);

   useLayoutEffect(() => {
     if (!canvasRef.current) {
       return;
     }
     renderer.mount({ element: canvasRef.current });
     return () => renderer.unmount();
   }, [canvasRef.current]);
   ```

   The renderer handles the drawing of pixels within the provided mount target.

3. **Forward host state changes.** Whenever theme, accessibility, or viewport metrics shift, compose a `HostStateSnapshot` and dispatch it.
   ```ts
   // The host environment can expose UI for the user to select the theme, accessibility options, terminal dimensions, etc.
   const hostState = useMemo<HostStateSnapshot>(() => ({ theme, accessibility, overlays, viewport }), [theme, accessibility, overlays, viewport]);

   useEffect(() => {
     rendererRef.current?.dispatch({ type: 'host-state', payload: hostState });
   }, [hostState]);
   ```

4. **Wire DOM events.** React event handlers translate into `user-input` dispatches.

   ```tsx
   const handleKeyDown = useCallback((event: KeyboardEvent) => {
     renderer.dispatch({
       type: 'user-input',
       payload: {
         type: 'key',
         key: event.key,
         code: event.code,
         alt: event.altKey,
         ctrl: event.ctrlKey,
         meta: event.metaKey,
         shift: event.shiftKey,
       },
     });
   }, []);
   ```

5. **Pipe remote data.** External transports (SSH, local PTY) feed into the renderer through `dispatch({ type: 'data' })`.

   ```ts
   useEffect(() => {
     const onData = (data: Uint8Array) => {
       renderer.dispatch({ type: 'data', payload: data });
     };
     sshConnection.on('data', onData);
     return () => sshConnection.off('data', onData);
   }, [sshConnection]);
   ```

6. **Listen for frames and diagnostics.**

   ```ts
   useEffect(() => {
     const offFrame = renderer.onFrame((event) => instrumentation.emitFrame(event));
     return () => {
       offFrame();
     };
   }, [instrumentation]);
   ```

This approach keeps React responsible for DOM lifecycle and accessibility semantics while renderers remain platform-agnostic.
