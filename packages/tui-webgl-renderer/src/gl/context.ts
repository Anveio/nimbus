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

  canvas.addEventListener('webglcontextlost', handleContextLost)

  return {
    gl,
    dispose: () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
