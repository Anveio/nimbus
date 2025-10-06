# Mana Renderer Specification v0

**Status:** Draft normative specification

**Applies to:** Renderer implementations targeting the `mana/vt` runtime and derivatives

**Version:** 0.1.0

---

## 1. Scope

This specification defines the renderer-facing contract for embedding the `mana/vt` interpreter within host environments (web, native, server-side rendering). It applies to all renderer implementations that intend to be consumed by Mana hosts, including but not limited to canvas, WebGL, WebGPU, and platform-specific drawing primitives. The document establishes the lifecycle, configuration, event dispatch, and diagnostic expectations required for interoperability with Mana hosts.

Renderer implementations that conform to this specification MUST expose the interfaces and semantics described herein. Hosts that integrate conformant renderers MUST honor the responsibilities assigned to them in informative sections, except where explicitly marked as non-normative.

## 2. Normative References

- Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", RFC 2119, March 1997.
- Mana `mana/vt` interpreter documentation (`packages/vt`).
- ECMAScript (ECMA-262) and TypeScript language specifications for syntax interpretation of included code listings.

## 3. Terms and Conventions

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, **MAY**, and **OPTIONAL** in this document are to be interpreted as described in RFC 2119.

The following terms are used throughout the specification:

- **Renderer**: A component that owns a `TerminalRuntime` instance, translates interpreter diffs into pixels, and exposes the APIs defined in this document.
- **Host**: An embedding environment (e.g., React component, DOM application, Electron window, native shell) responsible for lifecycle management, configuration, and user input mediation.
- **Surface**: The drawing target supplied by the host (e.g., `HTMLCanvasElement`, `OffscreenCanvas`, native GPU context).
- **Dispatch Event**: A command delivered from host to renderer to mutate runtime state, inject input, or adjust renderer configuration.

Unless otherwise noted, TypeScript interfaces appear as informative examples that illustrate the required shape and are expressed using TypeScript 5.x syntax.

## 4. Architectural Overview

A conformant renderer owns the VT runtime lifecycle and controls when frames are produced. The host is authoritative for surface provisioning, renderer configuration, accessibility hints, and user input. Hosts dispatch events to renderers; renderers render frames and may emit resize requests or diagnostics. Renderers MAY queue work internally but MUST respect the semantics of the lifecycle and event interfaces defined below.

## 5. Renderer Factory Contract

### 5.1 `createRenderer`

A renderer MUST expose a `createRenderer` factory. The factory MAY be synchronous or asynchronous but MUST consistently return the same type (either an instance or a promise resolving to an instance). Implementations MUST document which convention they follow.

```ts
type CreateRendererOptions<TRendererConfig> = {
  /** Inject an existing runtime; renderers fall back to a default when omitted. */
  runtime?: TerminalRuntime;
  /** Inject an existing profile; renderer initializes defaults when omitted. */
  profile?: TerminalProfile;
  rendererConfig: RendererConfiguration;
} & TRendererConfig;

// Synchronous factory variant
const createRenderer: <TRendererConfig = {}>(
  options?: CreateRendererOptions<TRendererConfig>,
) => RendererInstance<TRendererConfig>;

// Asynchronous factory variant
const createRendererAsync: <TRendererConfig = {}>(
  options?: CreateRendererOptions<TRendererConfig>,
) => Promise<RendererInstance<TRendererConfig>>;
```

Requirements:

1. A renderer MUST document whether its factory is synchronous or asynchronous. Hosts MUST treat the returned value as a promise in the absence of such documentation.
2. If provided, `runtime` MUST be used as the renderer's backing runtime and MUST NOT be replaced internally.
3. When `profile` is provided, the renderer MUST initialize the instance using this profile; otherwise, it MUST construct a profile consistent with Section 9.
4. Renderers MAY extend the options object with additional configuration keys (`TRendererConfig`). Any extension MUST NOT conflict with the fields defined here.

## 6. Renderer Instance Contract

A conformant renderer instance MUST satisfy the following interface. The TypeScript listing below is normative with respect to property names, method names, and parameter semantics.

```ts
interface RendererInstance<TRendererConfig> {
  readonly profile: TerminalProfile;
  readonly runtime: TerminalRuntime;
  readonly configuration?: RendererConfiguration;
  mount(surface: RenderSurface<TRendererConfig>): void;
  unmount(): void;
  dispatch(event: RendererEvent<TRendererConfig>): void;
  onFrame(
    listener: (event: RendererFrameEvent<TRendererConfig>) => void,
  ): () => void;
  onResizeRequest?(
    listener: (event: RendererResizeRequestEvent) => void,
  ): () => void;
  free(): void;
  serializeBuffer?(): Promise<ImageBitmap | Uint8Array>;
}
```

Normative requirements:

- `profile` MUST expose the renderer's current `TerminalProfile`. Implementations MUST keep this reference stable across calls unless the renderer is freed.
- `runtime` MUST return the active `TerminalRuntime`. The same instance MUST be returned across calls for the lifetime of the renderer, excluding the post-`free` state.
- `configuration` MUST reflect the most recent configuration applied via `renderer.configure` events. Before the first configuration dispatch, `configuration` MAY be `undefined`.
- `mount(surface)` MUST attach the renderer to the provided surface. If multiple mount/unmount cycles occur, the renderer MUST preserve runtime and graphics state across cycles.
- `mount(surface)` MUST throw a descriptive error if the provided surface is incompatible (see Section 7).
- `unmount()` MUST stop drawing to the surface without destroying runtime state.
- `dispatch(event)` MUST be synchronous and fire-and-forget. Renderers MUST queue any necessary work internally and MUST throw when receiving an unsupported event type.
- `onFrame(listener)` MUST register the listener and return a disposer that removes it. Renderers MUST invoke `listener` at least once after mounting to a new surface.
- `onResizeRequest(listener)` MAY be omitted. When implemented, renderers MUST invoke listeners whenever runtime-driven resize requests occur (see Section 8).
- `free()` MUST reset the renderer's buffers, release resources, and render the instance unusable. After `free()` is called, `mount()` MUST throw if invoked again.
- `serializeBuffer()` MAY be provided to expose the renderer's buffered frame data for diagnostics. When provided, it MUST resolve with an `ImageBitmap` or `Uint8Array` snapshot.

## 7. Render Surface Requirements

Hosts provide surfaces that satisfy the following structural contract:

```ts
type RenderSurface<TRendererConfig> =
  | { renderRoot: HTMLElement }
  | { renderRoot: TRendererConfig['renderRoot'] };
```

Normative requirements:

1. Renderers MUST accept an object containing a `renderRoot` key.
2. Renderers MAY define additional surface variants via `TRendererConfig`. When doing so, they MUST document the accepted shape and MUST reject incompatible surfaces through a thrown error.
3. Hosts MUST NOT mutate any renderer-owned surface objects once they have been passed to `mount`.

## 8. Configuration and DPI Negotiation

Hosts remain the canonical authority for geometry, DPI, and cell metrics. Renderers MUST accept `renderer.configure` events containing the following structure:

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

Normative requirements:

1. Upon receiving `renderer.configure`, the renderer MUST immediately treat `grid.rows` and `grid.columns` as authoritative until another configuration is applied.
2. Renderers MUST interpret `cssPixels` as the viewport size measured in CSS pixels.
3. Renderers MUST scale their backing buffers using `devicePixelRatio` when `framebufferPixels` is omitted. When `framebufferPixels` is supplied, renderers MUST use those exact dimensions and MUST NOT override them.
4. Renderers MUST respect the provided `cell` metrics when mapping overlays or pointer input.
5. When the runtime requests a resize (e.g., via CSI 8), the renderer SHOULD emit an event through `onResizeRequest`. Hosts MUST reconcile the request with local constraints and respond with a `renderer.configure` dispatch.
6. Until a new configuration is applied, the previous configuration remains canonical; renderers MUST continue rendering using the last applied configuration.

## 9. Profile Semantics

Renderer profiles express theme, accessibility, and overlay hints.

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
}>;
```

Normative requirements:

1. Renderers MUST merge partial profile updates with the previous state.
2. Renderers SHOULD assume that any profile update may necessitate a repaint.
3. `CursorOverride`, `RendererHighlight`, and overlay layers MUST NOT be mutated by the renderer; they are host-authored data structures.
4. Renderers MAY expose additional profile namespaces, provided they do not collide with the keys defined above.

## 10. Dispatch Events

A conformant renderer MUST accept all of the following dispatch events. The TypeScript union is normative with respect to event names and payload shapes.

```ts
type RendererEvent<TRendererConfig> =
  | {
      type: 'runtime.key';
      key: string;
      code: string;
      alt: boolean;
      ctrl: boolean;
      meta: boolean;
      shift: boolean;
    }
  | { type: 'runtime.text'; value: string }
  | {
      type: 'runtime.pointer';
      phase: 'down' | 'move' | 'up' | 'cancel';
      pointerId: number;
      buttons: number;
      position: { x: number; y: number };
    }
  | { type: 'runtime.wheel'; deltaX: number; deltaY: number }
  | { type: 'runtime.copy' }
  | { type: 'runtime.paste'; data: string }
  | { type: 'runtime.focus' }
  | { type: 'runtime.blur' }
  | {
      type: 'runtime.cursor.set';
      position: CursorPosition;
      options?: TerminalRuntimeCursorMoveOptions;
    }
  | {
      type: 'runtime.cursor.move';
      direction: TerminalRuntimeCursorMoveDirection;
      options?: TerminalRuntimeCursorMoveOptions;
    }
  | { type: 'runtime.selection.set'; selection: TerminalSelection }
  | { type: 'runtime.selection.update'; selection: TerminalSelection }
  | { type: 'runtime.selection.clear' }
  | {
      type: 'runtime.selection.replace';
      replacement: string;
      selection?: TerminalSelection | null;
      attributesOverride?: TerminalAttributes;
    }
  | { type: 'runtime.parser.dispatch'; event: ParserEvent }
  | { type: 'runtime.parser.batch'; events: Iterable<ParserEvent> }
  | { type: 'runtime.data'; data: string | Uint8Array }
  | { type: 'runtime.reset' }
  | {
      type: 'renderer.configure';
      configuration: RendererConfiguration;
    }
  | { type: 'profile.update'; profile: TerminalProfile };
```

Normative requirements:

1. Renderers MUST support every event variant listed above. Unsupported events MUST trigger a thrown error identifying the unknown type.
2. Events prefixed with `runtime.` MUST be forwarded to the underlying `TerminalRuntime` via `dispatchEvent`, `dispatchEvents`, or `write`, preserving order of arrival.
3. `runtime.reset` MUST recreate the runtime, clear any renderer buffers, and discard pending work before accepting new events.
4. Renderers MAY extend the event union with additional implementation-specific events but MUST ignore events they do not recognize rather than silently failing.
5. `renderer.configure` is the only normative pathway for mutating grid dimensions and DPI; renderers MUST NOT allow alternative configuration channels.

## 11. Frame and Diagnostics Callbacks

Renderers MAY expose frame diagnostics. When provided, the following structures are normative.

```ts
interface RendererFrameEvent<TRendererConfig> {
  timestamp: number;
  approxFrameDuration: number | null;
  dirtyRegion?: { rows: number; columns: number };
  metadata?: Record<string, unknown>;
  diagnostics?: RendererDiagnostics<TRendererConfig>;
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
  dcs?: {
    finalByte: number;
    params: number[];
    intermediates: number[];
    data: string;
  } | null;
  frameHash?: string;
}
```

Normative requirements:

1. Renderers MUST invoke all registered frame listeners whenever pixels are presented and at least once after mounting to a new surface.
2. `timestamp` MUST be based on `performance.now()` or a monotonic equivalent.
3. When dirty region tracking is supported, `dirtyRegion` MUST describe the rows and columns that changed since the previous frame.
4. Diagnostic payloads MAY omit fields (by returning `null`) when data is unavailable. Hosts MUST treat absent data as "unknown" rather than an error.

## 12. Host Integration Guidelines (Informative)

The following guidance is non-normative but illustrates best practices for React-based hosts embedding a conformant renderer.

```ts
const renderer = await createRenderer({ runtime, profile });

const applyRendererConfiguration = useCallback(
  (request?: RendererResizeRequestEvent) => {
    if (!canvasRef.current) {
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const devicePixelRatio = window.devicePixelRatio ?? 1;

    const configuration: RendererConfiguration = {
      grid: request
        ? { rows: request.rows, columns: request.columns }
        : inferGridFromLayout(rect),
      cssPixels: { width: rect.width, height: rect.height },
      devicePixelRatio,
      framebufferPixels: {
        width: Math.round(rect.width * devicePixelRatio),
        height: Math.round(rect.height * devicePixelRatio),
      },
      cell: measureCellMetrics(),
    };

    renderer.dispatch({ type: 'renderer.configure', configuration });
  },
  [renderer],
);

useLayoutEffect(() => {
  if (!canvasRef.current) {
    return;
  }
  renderer.mount({ renderRoot: canvasRef.current });
  return () => renderer.unmount();
}, [renderer]);

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

Hosts SHOULD mirror this pattern when building integrations in other frameworks: mount once, apply configuration on layout changes, forward input through dispatch events, and subscribe to frame diagnostics for instrumentation.

## 13. Conformance Checklist

A renderer implementation is conformant if and only if it satisfies all normative statements in Sections 5 through 11. The following checklist summarizes the required behaviors:

1. Expose a documented `createRenderer` factory (sync or async) honoring injected runtime and profile instances.
2. Provide a renderer instance with properties and methods matching Section 6, including stable references and lifecycle semantics.
3. Validate `RenderSurface` compatibility at mount time and preserve state across mount/unmount cycles.
4. Apply `RendererConfiguration` immediately, respect DPI and framebuffer overrides, and surface resize requests.
5. Accept and act upon every `RendererEvent` variant defined in Section 10.
6. Emit frame callbacks with monotonic timestamps and optional diagnostics when available.
7. Implement `free()` to release resources and prevent future mounts.

Conforming renderers MAY extend the specification in backward-compatible ways (e.g., additional events, diagnostics) provided they do not violate the requirements above.

---

*End of specification.*
