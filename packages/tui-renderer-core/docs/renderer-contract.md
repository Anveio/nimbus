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
   * e.g. `moveCursorLeft`, `moveCursorRight`
   * */
  readonly runtime: TerminalRuntime
  mount(surface: RenderSurface<TRendererConfig>): void
  unmount(): void
  dispatch(event: RendererEvent<TRendererConfig>): void
  onFrame(
    listener: (event: RendererFrameEvent<TRendererConfig>) => void,
  ): () => void
  /**
   * Should empty the renderer's buffer
   * */
  reset(): void;
  /**
   * Get the internal representation, for observability
   * */
  serializeBuffer?(): Promise<ImageBitmap | Uint8Array>;
}
```
- `mount` attaches the renderer to a host surface. Multiple mount/unmount cycles
  must preserve runtime and graphics state.
- `unmount` detaches without destroying state; subsequent `dispatch` calls are
  expected to no-op until the renderer is mounted again.
- `reset` Resets the renderer's buffer and the underlying interpreter to the initial state. Used to free up memory and release resources.
- `dispatch` is synchronous fire-and-forget. Renderers queue work and schedule
  frames as needed. Example: `renderer.dispatch({ type: 'runtime.cursor.move', direction: 'left' })`
- `onFrame` fires whenever pixels are presented and at least once after mounting
  to a new surface. Remounting the same referential surface does not require an
  extra frame.
- `getRuntime` exposes imperative utilities for hosts/tests to directly manipulate the underlying runtime by calling its methods, e.g. `moveCursorLeft`, ` `getRuntime` must return the same object across calls.


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
      phase: 'down' | 'move' | 'up' | 'cancel'
      pointerId: number
      buttons: number
      position: { x: number; y: number }
    }
  | { type: 'runtime.wheel'; deltaX: number; deltaY: number }
  | { type: 'runtime.copy' }
  | { type: 'runtime.paste'; data: string }
  | { type: 'runtime.focus' }
  | { type: 'runtime.blur' }
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
  | { type: 'profile.update'; profile: TerminalProfile }
```

Renderers must support all event variants; unknown types should throw with a
clear error. Runtime-prefixed events map directly to
`TerminalRuntime.dispatchEvent`/`dispatchEvents` or `write`. Host state updates
tune renderer presentation, while input events let hosts forward keystrokes,
pointer gestures, and clipboard interactions. `runtime.reset` must recreate the
runtime, clear the framebuffer, and flush printer events before acknowledging
further work. Renderers may expose events beyond the minimum defined events above.

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

3. **Forward host state changes.** Whenever theme or accessibility change compose a `TerminalProfile` and dispatch it.
   ```ts
   // The host environment can expose UI for the user to select the theme, accessibility options, terminal dimensions, etc.
   const profile = useMemo<TerminalProfile>(() => ({ ...renderer.profile, accessibility, overlays }), [theme, accessibility, overlays]);

   useEffect(() => {
    renderer.dispatch({ type: 'profile.update', profile });
   }, [profile]);
   ```

4. **Wire DOM events.** React event handlers translate into `input` dispatches.

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

5. **Pipe remote data.** External transports (SSH, local PTY) feed into the renderer through `dispatch({ type: 'runtime.data', data })`.

   ```ts
   useEffect(() => {
     const onData = (data: Uint8Array) => {
      renderer.dispatch({ type: 'runtime.data', data });
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
