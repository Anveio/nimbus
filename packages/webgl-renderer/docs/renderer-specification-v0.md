# Nimbus Renderer Specification v1

**Status:** Draft normative specification

**Applies to:** Renderer implementations targeting the `nimbus/vt` runtime and derivatives

**Version:** 1.0.0

---

## 1. Scope

This specification defines the renderer-facing contract for embedding the `nimbus/vt` interpreter within host environments (web, native, server-side rendering). It applies to all renderer implementations that intend to be consumed by Nimbus hosts, including but not limited to canvas, WebGL, WebGPU, and platform-specific drawing primitives. The document establishes the lifecycle, configuration, event dispatch, and diagnostic expectations required for interoperability with Nimbus hosts.

Renderer implementations that conform to this specification MUST expose the interfaces and semantics described herein. Hosts that integrate conformant renderers MUST honor the responsibilities assigned to them in informative sections, except where explicitly marked as non-normative.

## 2. Normative References

- Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", RFC 2119, March 1997.
- Nimbus `nimbus/vt` interpreter documentation (`packages/vt`).
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


> **Version delta:** Specification v1 subsumes the v0 renderer factory contract. Renderers MUST retire the standalone `createRenderer` entry point in favour of `createRendererRoot`.

## 5. Renderer Root Contract

### 5.1 `createRendererRoot`

Renderer implementations MUST expose a synchronous `createRendererRoot` factory as the canonical entry point for hosts.

```ts
type RendererRootContainer = HTMLCanvasElement;

interface RendererRootOptions<TRendererConfig> {
  configuration: RendererConfiguration;
  profile?: TerminalProfile;
  runtime?: TerminalRuntime;
} & TRendererConfig;

const createRendererRoot: <TRendererConfig = {}>(
  container: RendererRootContainer,
  options: RendererRootOptions<TRendererConfig>,
) => RendererRoot<TRendererConfig>;
```

Normative requirements:

1. `createRendererRoot` MUST synchronously return a `RendererRoot` instance.
2. `createRendererRoot` MUST throw a descriptive error when invoked with an unsupported container.
3. `createRendererRoot` MUST be idempotent for a given container. Repeated calls with the same container MUST return the same `RendererRoot` instance for the lifetime of that container.
4. When `createRendererRoot` is called again for a container that already has a root, the implementation MUST merge the supplied options into the existing root before returning it. New values MUST replace prior values for the corresponding keys. Omitted keys MUST preserve their previous values.
5. Renderers MUST treat the returned root as the sole authority for managing sessions bound to the container.

### 5.2 Renderer Root Semantics

```ts
interface RendererRoot<TRendererConfig> {
  readonly container: RendererRootContainer;
  mount(): RendererSession<TRendererConfig>;
  readonly currentSession: RendererSession<TRendererConfig> | null;
  dispose(): void;
}
```

Normative requirements:

1. `container` MUST reference the value supplied to `createRendererRoot`.
2. `mount()` MUST attach the renderer to the container, initialize runtime state using the most recent options provided to `createRendererRoot`, and return a live `RendererSession`.
3. If a session is already active, `mount` MUST call `unmount()` on the existing session before creating a new one.
4. `currentSession` MUST reflect the active session, or `null` when no session is mounted.
5. `dispose()` MUST unmount any active session, release resources associated with the container, and remove the root from the idempotence registry. After disposal, subsequent `createRendererRoot(container, options)` calls MAY return a new root.

## 6. Renderer Mount Descriptor

`createRendererRoot(container, options)` captures the configuration needed to initialise renderer sessions.

Normative requirements:

1. `configuration` MUST honour the requirements in Section 8.
2. If provided, `runtime` MUST be used as the session's backing runtime and MUST NOT be replaced internally.
3. When `profile` is provided, the session MUST initialize using this profile; otherwise, it MUST construct a profile consistent with Section 10.
4. Renderers MAY extend the options object with additional configuration keys (`TRendererConfig`). Any extension MUST NOT conflict with the fields defined here.
5. Renderers MUST treat the container as the authoritative render surface. Implementations MUST NOT require hosts to provide an additional surface descriptor.

## 7. Renderer Session Contract

A conformant renderer session MUST satisfy the following interface. The TypeScript listing below is normative with respect to property names, method names, and parameter semantics.

```ts
interface RendererSession<TRendererConfig> {
  readonly profile: TerminalProfile;
  readonly runtime: TerminalRuntime;
  readonly configuration?: RendererConfiguration;
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

- `profile` MUST expose the session's current `TerminalProfile`. Implementations MUST keep this reference stable across calls unless the session is freed.
- `runtime` MUST return the active `TerminalRuntime`. The same instance MUST be returned across calls for the lifetime of the session, excluding the post-`free` state.
- `configuration` MUST reflect the most recent configuration applied via `renderer.configure` events. Before the first configuration dispatch, `configuration` MAY be `undefined`.
- `unmount()` MUST stop drawing to the surface without destroying runtime state. Hosts MAY call `mount` again through the root to resume rendering.
- `dispatch(event)` MUST be synchronous and fire-and-forget. Sessions MUST queue any necessary work internally and MUST throw when receiving an unsupported event type.
- `onFrame(listener)` MUST register the listener and return a disposer that removes it. Sessions MUST invoke `listener` at least once after mounting to a new surface.
- `onResizeRequest(listener)` MAY be omitted. When implemented, sessions MUST invoke listeners whenever runtime-driven resize requests occur (see Section 9).
- `free()` MUST reset the renderer's buffers, release resources, and render the session unusable for future rendering. After `free()` is called, subsequent calls to `dispatch` or new listener registrations MUST throw. `unmount()` MAY be invoked during teardown but MUST succeed exactly once; further calls MUST throw.
- `serializeBuffer()` MAY be provided to expose the session's buffered frame data for diagnostics. When provided, it MUST resolve with an `ImageBitmap` or `Uint8Array` snapshot.

## 8. Render Surface Requirements

The renderer root container doubles as the active render surface. Hosts MUST supply an `HTMLCanvasElement`. Renderers MAY extend the accepted container types via `TRendererConfig`, but they MUST document the supported variants and reject unsupported containers through a thrown error surfaced by `createRendererRoot`.

Normative requirements:

1. Renderers MUST adopt the supplied container as the definitive render surface.
2. Renderers MAY expose additional initialisation flags within `TRendererConfig` to tweak surface behaviour (e.g., WebGL context attributes) but MUST NOT require hosts to provide auxiliary surface objects.
3. Hosts MUST NOT mutate renderer-owned surface state (context attributes, GL handles, etc.) once control has been transferred via `createRendererRoot`.

## 9. Configuration and DPI Negotiation

Hosts remain the canonical authority for geometry, DPI, and cell metrics. Sessions MUST accept `renderer.configure` events containing the following structure:

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

1. Upon receiving `renderer.configure`, the session MUST immediately treat `grid.rows` and `grid.columns` as authoritative until another configuration is applied.
2. Sessions MUST interpret `cssPixels` as the viewport size measured in CSS pixels.
3. Sessions MUST scale their backing buffers using `devicePixelRatio` when `framebufferPixels` is omitted. When `framebufferPixels` is supplied, sessions MUST use those exact dimensions and MUST NOT override them.
4. Sessions MUST respect the provided `cell` metrics when mapping overlays or pointer input.
5. When the runtime requests a resize (e.g., via CSI 8), the session SHOULD emit an event through `onResizeRequest`. Hosts MUST reconcile the request with local constraints and respond with a `renderer.configure` dispatch.
6. Until a new configuration is applied, the previous configuration remains canonical; sessions MUST continue rendering using the last applied configuration.

## 10. Profile Semantics

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

1. Sessions MUST merge partial profile updates with the previous state.
2. Sessions SHOULD assume that any profile update may necessitate a repaint.
3. `CursorOverride`, `RendererHighlight`, and overlay layers MUST NOT be mutated by the renderer; they are host-authored data structures.
4. Sessions MAY expose additional profile namespaces, provided they do not collide with the keys defined above.

## 11. Dispatch Events

A conformant session MUST accept all of the following dispatch events. The TypeScript union is normative with respect to event names and payload shapes.

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
      action: 'down' | 'move' | 'up' | 'cancel';
      pointerId: number;
      button: 'left' | 'middle' | 'right' | 'aux1' | 'aux2' | 'none';
      buttons: number;
      position: { x: number; y: number };
      cell: { row: number; column: number };
      modifiers?: {
        shift?: boolean;
        alt?: boolean;
        meta?: boolean;
        ctrl?: boolean;
      };
    }
  | {
      type: 'runtime.wheel';
      deltaX: number;
      deltaY: number;
      cell: { row: number; column: number };
      modifiers?: {
        shift?: boolean;
        alt?: boolean;
        meta?: boolean;
        ctrl?: boolean;
      };
    }
  | { type: 'runtime.paste'; text: string }
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

1. Sessions MUST support every event variant listed above. Unsupported events MUST trigger a thrown error identifying the unknown type.
2. Events prefixed with `runtime.` MUST be forwarded to the underlying `TerminalRuntime` via `dispatchEvent`, `dispatchEvents`, or `write`, preserving order of arrival.
3. `runtime.reset` MUST recreate the runtime, clear any renderer buffers, and discard pending work before accepting new events.
4. Sessions MAY extend the event union with additional implementation-specific events but MUST ignore events they do not recognize rather than silently failing.
5. `renderer.configure` is the only normative pathway for mutating grid dimensions and DPI; sessions MUST NOT allow alternative configuration channels.

## 12. Frame and Diagnostics Callbacks

Sessions MAY expose frame diagnostics. When provided, the following structures are normative.

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

1. Sessions MUST invoke all registered frame listeners whenever pixels are presented and at least once after mounting to a new surface.
2. `timestamp` MUST be based on `performance.now()` or a monotonic equivalent.
3. When dirty region tracking is supported, `dirtyRegion` MUST describe the rows and columns that changed since the previous frame.
4. Diagnostic payloads MAY omit fields (by returning `null`) when data is unavailable. Hosts MUST treat absent data as "unknown" rather than an error.

## 13. Host Integration Guidelines (Informative)

The following guidance is non-normative but illustrates best practices for React-based hosts embedding a conformant renderer.

```ts
useLayoutEffect(() => {
  const canvas = canvasRef.current;
  if (!canvas) {
    return;
  }

  const deriveConfiguration = (
    request?: RendererResizeRequestEvent,
  ): RendererConfiguration => {
    const rect = canvas.getBoundingClientRect();
    const devicePixelRatio = window.devicePixelRatio ?? 1;

    return {
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
  };

  const root = createRendererRoot(canvas, {
    configuration: deriveConfiguration(),
    profile,
  });

  const session = root.mount();

  const resizeObserver = new ResizeObserver(() => {
    session.dispatch({
      type: 'renderer.configure',
      configuration: deriveConfiguration(),
    });
  });
  resizeObserver.observe(canvas);

  const offResizeRequest = session.onResizeRequest?.((request) => {
    session.dispatch({
      type: 'renderer.configure',
      configuration: deriveConfiguration(request),
    });
  });

  return () => {
    offResizeRequest?.();
    resizeObserver.disconnect();
    session.unmount();
  };
}, [profile]);
```

Idempotence allows hosts to call `createRendererRoot(canvas, options)` inside an effect without caching the result explicitly; repeated calls reuse the same root and update its options. Hosts SHOULD mirror this pattern in other frameworks: mount once per container, apply configuration on layout changes, forward input through dispatch events, and subscribe to frame diagnostics for instrumentation.

## 14. Conformance Checklist

A renderer implementation is conformant if and only if it satisfies all normative statements in Sections 5 through 12. The following checklist summarizes the required behaviors:

1. Expose a documented, synchronous `createRendererRoot` factory that enforces container idempotence.
2. Provide a `RendererRoot` that manages the active session, enforces single-session semantics, and disposes resources when requested.
3. Honour host-supplied runtime instances, profiles, and renderer configuration extensions provided through `createRendererRoot(container, options)`.
4. Produce `RendererSession` instances with lifecycle, dispatch, and diagnostic APIs matching Section 7.
5. Validate container compatibility at creation time and preserve state across mount/unmount cycles.
6. Apply `RendererConfiguration` immediately, respect DPI and framebuffer overrides, and surface resize requests.
7. Accept and act upon every `RendererEvent` variant defined in Section 11.
8. Emit frame callbacks with monotonic timestamps and optional diagnostics when available.
9. Implement `free()` to release resources and prevent future interaction with the session.

Conforming renderers MAY extend the specification in backward-compatible ways (e.g., additional events, diagnostics) provided they do not violate the requirements above.

---

*End of specification.*
