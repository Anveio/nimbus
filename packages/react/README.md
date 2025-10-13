# @nimbus/tui-react

React bindings for the Nimbus terminal stack. `<Terminal />` manages renderer
sessions, bridges runtime events, and wires the new configuration helper so
hosts don’t have to guess canvas metrics.

## Install

```bash
npm install @nimbus/react
```

## Quickstart

```tsx
import { Terminal } from '@nimbus/react'
import { useRef } from 'react'

export function App() {
  return (
    <Terminal />
  )
}
```

What happens under the hood:

- `<Terminal />` provisions a renderer backend (`webgl` by default) and calls
  [`deriveRendererConfiguration`](../webgl-renderer/README.md#quickstart) to

### Next steps

- Use the `rendererBackend` prop to opt into custom backends as more renderer
  packages ship.
- Extend the session context via `useRendererSessionContext()` if you need
  direct access to the renderer root or runtime snapshot.
- Review [`docs/terminal-renderer-integration.md`](./docs/terminal-renderer-integration.md)
  for deeper guidance on event dispatch, accessibility overlays, and response
  forwarding.
