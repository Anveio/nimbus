# Renderer Core Contract

This document defines the renderer-agnostic contract that hosts (React, vanilla DOM, native embeddings) use to integrate terminal renderers. It assumes renderers own the VT runtime lifecycle and control when frames are produced. Hosts provide surfaces, user input, theming, accessibility hints, and external data streams.

## Terminology

- **Renderer** – implementation that owns a `TerminalRuntime`, renders frames (CPU canvas, WebGL, WebGPU, native, etc.), and exposes the contract below.
- **Host** – environment embedding the renderer (React component, raw DOM app, Electron window, native shell).
- **Surface** – the environment the renderer draws into (DOM node, HTMLCanvasElement, OffscreenCanvas, custom drawing API).
- **Dispatch event** – message sent from host to renderer to mutate runtime state, deliver input, or update host configuration.

## Top-level API

```ts
type CreateRendererOptions<TRendererConfig> = {
  /** Inject an existing runtime; renderers fall back to their default when omitted. */
  runtime?: TerminalRuntime
  /** Inject an existing profile; renderer will create a default if none is provided. */
  profile?: TerminalProfile
  rendererConfig: RendererConfiguration
} & TRendererConfig

/** Synchronously create a renderer instance. */
const createRenderer: <TRendererConfig = {}>(
  options?: CreateRendererOptions & TRendererConfig ,
) => RendererInstance<TRendererConfig>

/** Asynchronously create a renderer instance. */
const createRenderer: <TRendererConfig = {}>(
  options?: CreateRendererOptions & TRendererConfig ,
) => Promise<RendererInstance<TRendererConfig>>
```
- A renderer's `createRenderer` function must be either sync or async.
- Assume `createRenderer` resolves asynchronously (shader compilation, asset loading). Hosts await it before mounting.

## RendererInstance

```ts
interface RendererInstance<TRendererConfig> {
  /**
   * Get access to the accessibility options, theming, etc. being used to paint the terminal UI
   * */
  readonly profile: TerminalProfile
  /**
   * Get access to the underlying runtime in order to manipulate the interpreter directly,
   * e.g. `moveCursorLeft`, `moveCursorRight`. Returns the same object across calls.
   * */
  readonly runtime: TerminalRuntime
  /**
   * The most recently applied renderer configuration, if available. Reflects the last `renderer.configure` event dispatched by the host. Use it when re-rendering overlays or mapping pointer input.
   */
  readonly configuration?: RendererConfiguration
  /**
   * Attaches the renderer to a host surface. Must be called before the renderer can push pixels to the screen. The renderer can accept dispatches prior to a mount. Multiple mount/unmount cycles
  must preserve runtime and graphics state.
   * */
  mount(surface: RenderSurface<TRendererConfig>): void
  /**
   * Detaches without destroying state, pauses pushing pixels to the screen.
   * */
  unmount(): void
  /**
   * Synchronous fire-and-forget. Renderers queue work and schedule
  frames as needed. Example: `renderer.dispatch({ type: 'runtime.cursor.move', direction: 'left' })`
   * */
  dispatch(event: RendererEvent<TRendererConfig>): void
  /**
   * Fires whenever pixels are presented and at least once after mounting
  to a new surface. Remounting the same referential surface does not require an
  extra frame.
   * */
  onFrame(
    listener: (event: RendererFrameEvent<TRendererConfig>) => void,
  ): () => void
  /**
   * notifies the host when the runtime asks for a new grid (e.g. CSI 8). The host remains the source of truth until it dispatches another configuration.
   */
  onResizeRequest?(
    listener: (event: RendererResizeRequestEvent) => void,
  ): () => void
  /**
   * Resets the renderer's buffer and the underlying interpreter to the initial state, pauses all pixel pushing (calls unmount internally). No more onFrame event handlers will be triggered. Mount can no longer be called as the renderer is now in an unusable state. Used to free up memory and release resources.
   * */
  free(): void;
  /**
   * Get the internal representation, for observability
   * */
  serializeBuffer?(): Promise<ImageBitmap | Uint8Array>;
}
```


## RenderSurface

Surfaces allow renderers to target multiple environments without hard-coding DOM logic.

```ts
type RenderSurface<TRendererConfig> =
  | { renderRoot: HTMLElement }
  | {
      renderRoot: TRendererConfig['renderRoot'] // For custom implementations of a renderer targeting a custom surface
    };
```

- If a renderer requires a specific surface kind, it must throw from `mount` when an incompatible kind is provided (with a descriptive error).

### Renderer Configuration & DPI Negotiation

Hosts remain the canonical authority for terminal dimensions and pixel geometry. They measure the environment, construct a `RendererConfiguration`, and dispatch it to the renderer.

```ts
type RendererConfiguration = {
  grid: { rows: number; columns: number };
  cssPixels: { width: number; height: number };
  devicePixelRatio: number;
  framebufferPixels?: { width: number; height: number };
  cell: { width: number; height: number; baseline?: number };
};

interface RendererResizeRequestEvent {
  rows: number;
  columns: number;
  reason: 'remote' | 'host-triggered' | 'initial';
}
```

- `grid.rows` and `grid.columns` express the runtime dimensions. Once the host dispatches a configuration, both renderer and runtime treat those values as truth until another configuration is applied.
- `cssPixels` describe the surface in CSS pixels. Hosts usually obtain these by calling `getBoundingClientRect`.
- `devicePixelRatio` mirrors the platform DPI (`window.devicePixelRatio` on web). Renderers combine it with `cssPixels` to derive backing resolutions.
- `framebufferPixels` optionally overrides the backing-store size (e.g. preallocated `OffscreenCanvas`). When omitted, renderers multiply `cssPixels` by `devicePixelRatio`.
- `cell` contains glyph metrics (width, height, optional baseline) so hosts and renderers agree on overlay placement.
- Resize requests surface runtime wishes (like CSI 8). Hosts listen via `onResizeRequest`, decide whether they can satisfy the request, and then dispatch a new configuration or leave the current one in place.

The negotiation loop always terminates with the host:
1. Renderer receives a runtime-initiated resize (or the host decides to change layout) and emits `onResizeRequest` if the runtime asked for new rows/columns.
2. Host measures available space, computes glyph metrics, and builds a `RendererConfiguration` that reconciles remote intent with local constraints.
3. Host dispatches `renderer.configure` with the chosen configuration. The renderer applies it immediately and treats the new grid as the ground truth until another configuration arrives.

## Dispatch Events

```ts
type RendererEvent<TRendererConfig> =
 | {
      type: 'runtime.key'
      key: string
      code: string
      alt: boolean
      ctrl: boolean
      meta: boolean
      shift: boolean
    }
  | { type: 'runtime.text'; value: string } // IME commit/paste plain text
  | {
      type: 'runtime.pointer'
      action: 'down' | 'move' | 'up' | 'cancel'
      pointerId: number
      button: 'left' | 'middle' | 'right' | 'aux1' | 'aux2' | 'none'
      buttons: number
      position: { x: number; y: number }
      cell: { row: number; column: number }
      modifiers?: { shift?: boolean; alt?: boolean; meta?: boolean; ctrl?: boolean }
    }
  | {
      type: 'runtime.wheel'
      deltaX: number
      deltaY: number
      cell: { row: number; column: number }
      modifiers?: { shift?: boolean; alt?: boolean; meta?: boolean; ctrl?: boolean }
    }
  | { type: 'runtime.focus' }
  | { type: 'runtime.blur' }
  | { type: 'runtime.paste'; text: string }
  | {
      type: 'runtime.cursor.set'
      position: CursorPosition
      options?: TerminalRuntimeCursorMoveOptions
    }
  | {
      type: 'runtime.cursor.move'
      direction: TerminalRuntimeCursorMoveDirection
      options?: TerminalRuntimeCursorMoveOptions
    }
  | { type: 'runtime.selection.set'; selection: TerminalSelection }
  | { type: 'runtime.selection.update'; selection: TerminalSelection }
  | { type: 'runtime.selection.clear' }
  | {
      type: 'runtime.selection.replace'
      replacement: string
      selection?: TerminalSelection | null
      attributesOverride?: TerminalAttributes
    }
  | { type: 'runtime.parser.dispatch'; event: ParserEvent }
  | { type: 'runtime.parser.batch'; events: Iterable<ParserEvent> }
  | { type: 'runtime.data'; data: string | Uint8Array }
  | {
      type: 'runtime.reset'
    }
  | {
      type: 'renderer.configure'
      configuration: RendererConfiguration
    }
  | { type: 'profile.update'; profile: TerminalProfile }
```

Renderers must support all event variants; unknown types should throw with a
clear error. Runtime-prefixed events map directly to
`TerminalRuntime.dispatchEvent`/`dispatchEvents` or `write`. Host state updates
tune renderer presentation, while input events let hosts forward keystrokes,
pointer gestures, and clipboard interactions. `runtime.reset` must recreate the
runtime, clear the framebuffer, and flush printer events before acknowledging
further work. `renderer.configure` is the only pathway for
changing grid dimensions or DPI—hosts dispatch it after reconciling local layout
and any runtime resize requests. Renderers may expose events beyond the minimum
defined events above.

### Profile

Configuration that affects rendering behavior. Partial updates will be merged with the profile of the previous state.

```ts
type TerminalProfile = Partial<{
  theme: RendererTheme;
  accessibility: Partial<{
    highContrast: boolean;
    reducedMotion: boolean;
    colorScheme: 'light' | 'dark' | 'system';
  }>;
  overlays: Partial<{
    selection: TerminalSelection | null;
    cursor: CursorOverride | null;
    highlights: RendererHighlight[];
    layers: Record<string, unknown>;
  }>;
}>
```

- Renderers may diff snapshots, but hosts should assume that every dispatch may trigger a repaint.
- `CursorOverride` adjusts shape/color/opacity/visibility independently of interpreter state.
- `RendererHighlight` describes host-driven highlight bands (search results, diagnostics markers).

Renderers translate these into interpreter actions (key sequences, selection, scroll) while respecting overlays and accessibility policies.

## Frame & Diagnostics Callbacks

```ts
interface RendererFrameEvent<TRendererConfig> {
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

Host applications subscribe via `onFrame`. Renderers may emit additional metadata through the generic `metadata` field.

## Working Backwards: React Host Integration

How a React-based `<Terminal />` would consume the contract.

1. **Create renderer once per component instance.**
  ```ts
  const renderer = createRenderer({ runtime, profile }) // Assume synchronously initialized renderer.
  ```

2. **Mount on a React-managed surface.** Render the host container, then mount inside a layout effect.

   ```tsx
   const canvasRef = useRef<HTMLCanvasElement | null>(null);

   useLayoutEffect(() => {
     if (!canvasRef.current) {
       return;
     }
     renderer.mount({ renderRoot: canvasRef.current });
     return () => renderer.unmount();
   }, [canvasRef.current]);
   ```

   The renderer handles the drawing of pixels within the provided mount target.

3. **Apply renderer configuration.** Measure layout, reconcile runtime resize requests, and dispatch `renderer.configure`.
   ```ts
   const applyRendererConfiguration = useCallback(
     (request?: RendererResizeRequestEvent) => {
       if (!canvasRef.current) {
         return;
       }

       const rect = canvasRef.current.getBoundingClientRect();
       const devicePixelRatio = window.devicePixelRatio ?? 1;
       const framebufferWidth = Math.round(rect.width * devicePixelRatio);
       const framebufferHeight = Math.round(rect.height * devicePixelRatio);

       const configuration: RendererConfiguration = {
         grid: request
           ? { rows: request.rows, columns: request.columns }
           : inferGridFromLayout(rect), // Host-owned helper: pick rows/columns for the available space
         cssPixels: { width: rect.width, height: rect.height },
         devicePixelRatio,
         framebufferPixels: { width: framebufferWidth, height: framebufferHeight },
         cell: measureCellMetrics(), // Host-owned helper: preflight font metrics once per theme/zoom level
       };

       renderer.dispatch({
         type: 'renderer.configure',
         configuration,
       });
     },
     [renderer],
   );

   useLayoutEffect(() => {
     applyRendererConfiguration();

     if (!canvasRef.current) {
       return;
     }

     const resizeObserver = new ResizeObserver(() => applyRendererConfiguration());
     resizeObserver.observe(canvasRef.current);

     const offResizeRequest = renderer.onResizeRequest?.((request) => {
       applyRendererConfiguration(request);
     });

     return () => {
       offResizeRequest?.();
       resizeObserver.disconnect();
     };
   }, [applyRendererConfiguration]);
   ```

   The host decides whether to honor runtime requests (e.g. CSI 8). If honoring would exceed available space, the host can clamp the grid before dispatching a configuration; until a new configuration is sent, the previous one remains canonical.

4. **Forward host state changes.** Whenever theme or accessibility change, compose a `TerminalProfile` and dispatch it.
   ```ts
   const profile = useMemo<TerminalProfile>(
     () => ({ ...renderer.profile, accessibility, overlays }),
     [renderer.profile, accessibility, overlays],
   );

   useEffect(() => {
     renderer.dispatch({ type: 'profile.update', profile });
   }, [profile]);
   ```

5. **Wire DOM events.** React event handlers translate into `input` dispatches.

   ```tsx
   const handleKeyDown = useCallback((event: KeyboardEvent) => {
    renderer.dispatch({
      type: 'runtime.key',
      key: event.key,
      code: event.code,
      alt: event.altKey,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
    });
   }, []);
   ```

6. **Pipe remote data.** External transports (SSH, local PTY) feed into the renderer through `dispatch({ type: 'runtime.data', data })`.

   ```ts
   useEffect(() => {
     const onData = (data: Uint8Array) => {
      renderer.dispatch({ type: 'runtime.data', data });
     };
     sshConnection.on('data', onData);
     return () => sshConnection.off('data', onData);
   }, [sshConnection]);
   ```

7. **Listen for frames and diagnostics.**

   ```ts
   useEffect(() => {
     const offFrame = renderer.onFrame((event) => instrumentation.emitFrame(event));
     return () => {
       offFrame();
     };
   }, [instrumentation]);
   ```

This approach keeps React responsible for DOM lifecycle and accessibility semantics while renderers remain platform-agnostic.
