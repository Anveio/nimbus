export const createFullScreenQuad = (
  gl: WebGL2RenderingContext,
): {
  readonly vao: WebGLVertexArrayObject
  readonly vertexBuffer: WebGLBuffer
} => {
  const vao = gl.createVertexArray()
  if (!vao) {
    throw new Error('Failed to create vertex array object')
  }

  const vertexBuffer = gl.createBuffer()
  if (!vertexBuffer) {
    gl.deleteVertexArray(vao)
    throw new Error('Failed to create vertex buffer')
  }

  const vertices = new Float32Array([
    -1, -1,
    1, -1,
    -1, 1,
    -1, 1,
    1, -1,
    1, 1,
  ])

  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)

  return { vao, vertexBuffer }
}

export const disposeFullScreenQuad = (
  gl: WebGL2RenderingContext,
  vao: WebGLVertexArrayObject | null,
  vertexBuffer: WebGLBuffer | null,
): void => {
  if (vao) {
    gl.deleteVertexArray(vao)
  }
  if (vertexBuffer) {
    gl.deleteBuffer(vertexBuffer)
  }
}
