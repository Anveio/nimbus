export interface WebglContextResult {
  readonly gl: WebGL2RenderingContext
  readonly dispose: () => void
}

export interface CreateWebglContextOptions {
  readonly canvas: HTMLCanvasElement
  readonly attributes?: WebGLContextAttributes
}

export const createWebglContext = (
  options: CreateWebglContextOptions,
): WebglContextResult => {
  const { canvas, attributes } = options
  const gl = canvas.getContext('webgl2', {
    preserveDrawingBuffer: true,
    antialias: true,
    alpha: false,
    depth: false,
    stencil: false,
    ...attributes,
  }) as WebGL2RenderingContext | null

  if (!gl) {
    throw new Error('Unable to acquire WebGL2 context for terminal renderer')
  }

  const handleContextLost = (event: Event) => {
    event.preventDefault()
  }

  if ('addEventListener' in canvas) {
    canvas.addEventListener('webglcontextlost', handleContextLost)
  }

  return {
    gl,
    dispose: () => {
      /**
       * React 19 Strict Mode remounts components twice. If we deliberately lose
       * the WebGL context here, the follow-up mount reuses the same canvas
       * while the context is still “lost”, causing shader compilation to fail.
       * We therefore limit teardown to removing listeners and let the browser
       * release the context naturally. Hosts that need an explicit loss can add
       * their own `WEBGL_lose_context` handling.
       */
      if ('removeEventListener' in canvas) {
        canvas.removeEventListener('webglcontextlost', handleContextLost)
      }
    },
  }
}
