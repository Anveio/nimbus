import type { TerminalCell } from '@mana/vt'

export interface TileDefinition {
  readonly index: number
  readonly col0: number
  readonly row0: number
  readonly cols: number
  readonly rows: number
  readonly instanceCount: number
}

export interface TileResources {
  vao: WebGLVertexArrayObject | null
  instanceBuffer: WebGLBuffer | null
  instanceCapacity: number
  dprRectPx: { x: number; y: number; width: number; height: number }
}

export interface GlyphMeta {
  readonly page: number
  readonly u0: number
  readonly v0: number
  readonly u1: number
  readonly v1: number
  readonly advance: number
  readonly bearingX: number
  readonly bearingY: number
  readonly width: number
  readonly height: number
  readonly textureWidth: number
  readonly textureHeight: number
  readonly padding: number
  readonly isColor: boolean
}

export interface GlyphAtlasUpload {
  readonly page: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

export interface GlyphRequest {
  readonly key: string
  readonly cluster: string
  readonly cell: TerminalCell
}

export interface FrameTimings {
  readonly frameStart: number
  readonly gpuStart: number
  readonly gpuEnd: number
}

export interface ViewportMetrics {
  readonly cols: number
  readonly rows: number
  readonly widthPx: number
  readonly heightPx: number
  readonly dpr: number
}

export interface BackgroundUpload {
  readonly rect: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly data: Uint8Array
}
