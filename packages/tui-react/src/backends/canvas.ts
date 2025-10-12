import {
  getRendererBackend,
  hasRendererBackend,
  type RendererBackendRegistration,
  registerRendererBackend,
  setDefaultRendererBackend,
} from '../renderer-backend-registry'

const CANVAS_BACKEND_KEY = 'canvas'

const notImplementedRegistration: RendererBackendRegistration = {
  createRuntime() {
    throw new Error(
      'Canvas renderer backend is not yet implemented in @nimbus/tui-react.',
    )
  },
  mount() {
    throw new Error(
      'Canvas renderer backend is not yet implemented in @nimbus/tui-react.',
    )
  },
}

export const registerCanvasRendererBackend = (): void => {
  if (hasRendererBackend(CANVAS_BACKEND_KEY)) {
    return
  }
  registerRendererBackend(CANVAS_BACKEND_KEY, notImplementedRegistration)
}

if (!hasRendererBackend(CANVAS_BACKEND_KEY)) {
  registerCanvasRendererBackend()
}

setDefaultRendererBackend(CANVAS_BACKEND_KEY)

export const resolveCanvasRendererBackend = () =>
  getRendererBackend(CANVAS_BACKEND_KEY)
