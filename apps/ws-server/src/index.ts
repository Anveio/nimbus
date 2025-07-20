import { OpenAPIHono } from '@hono/zod-openapi'
import { secureHeaders } from 'hono/secure-headers'

const app = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json({ success: false, errors: result.error.errors }, 422)
    }
  },
})

app.get('/', (c) => {
  return c.redirect('https://midday.ai', 302)
})

app.use(secureHeaders())

export const appRoutes = app

export type AppType = typeof appRoutes

export default app
