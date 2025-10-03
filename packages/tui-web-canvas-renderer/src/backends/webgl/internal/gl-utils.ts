export class WebglError extends Error {}

type WebGLResource =
  | WebGLTexture
  | WebGLFramebuffer
  | WebGLBuffer
  | WebGLVertexArrayObject

const isWebgl2Context = (
  context: WebGLRenderingContext | WebGL2RenderingContext,
): context is WebGL2RenderingContext => {
  if (typeof WebGL2RenderingContext === 'undefined') {
    return false
  }
  return context instanceof WebGL2RenderingContext
}

export const assertContext = (
  gl: WebGL2RenderingContext | WebGLRenderingContext | null,
  reason: string,
): WebGL2RenderingContext => {
  if (!gl) {
    throw new WebglError(reason)
  }
  if (!isWebgl2Context(gl)) {
    throw new WebglError('WebGL2 context is required')
  }
  return gl
}

export const createShader = (
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type)
  if (!shader) {
    throw new WebglError('Failed to create shader')
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new WebglError(`Shader compilation failed: ${String(info)}`)
  }
  return shader
}

export const createProgram = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram => {
  const vs = createShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  if (!program) {
    throw new WebglError('Failed to create program')
  }
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new WebglError(`Program link failed: ${String(info)}`)
  }

  return program
}

export const createFramebufferTexture = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  options: {
    internalFormat: GLenum
    format: GLenum
    type: GLenum
    filter?: GLenum
  },
): WebGLTexture => {
  const texture = gl.createTexture()
  if (!texture) {
    throw new WebglError('Failed to create texture')
  }
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    options.internalFormat,
    width,
    height,
    0,
    options.format,
    options.type,
    null,
  )
  const filter = options.filter ?? gl.NEAREST
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.bindTexture(gl.TEXTURE_2D, null)
  return texture
}

export const bindFramebufferTexture = (
  gl: WebGL2RenderingContext,
  framebuffer: WebGLFramebuffer,
  texture: WebGLTexture,
): void => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  )
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new WebglError(`Framebuffer incomplete: 0x${status.toString(16)}`)
  }
}

const disposeShaderResource = <T extends WebGLResource>(
  gl: WebGL2RenderingContext,
  resource: T | null,
  deleteFn: (gl: WebGL2RenderingContext, resource: T) => void,
): void => {
  if (resource) {
    deleteFn(gl, resource)
  }
}

export const disposeProgram = (
  gl: WebGL2RenderingContext,
  program: WebGLProgram | null,
): void => {
  if (program) {
    gl.deleteProgram(program)
  }
}

export const disposeTexture = (
  gl: WebGL2RenderingContext,
  texture: WebGLTexture | null,
): void => {
  disposeShaderResource(gl, texture, (context, resource) => {
    context.deleteTexture(resource)
  })
}

export const disposeFramebuffer = (
  gl: WebGL2RenderingContext,
  framebuffer: WebGLFramebuffer | null,
): void => {
  disposeShaderResource(gl, framebuffer, (context, resource) => {
    context.deleteFramebuffer(resource)
  })
}

export const disposeBuffer = (
  gl: WebGL2RenderingContext,
  buffer: WebGLBuffer | null,
): void => {
  disposeShaderResource(gl, buffer, (context, resource) => {
    context.deleteBuffer(resource)
  })
}

export const disposeVertexArray = (
  gl: WebGL2RenderingContext,
  vao: WebGLVertexArrayObject | null,
): void => {
  disposeShaderResource(gl, vao, (context, resource) => {
    context.deleteVertexArray(resource)
  })
}
