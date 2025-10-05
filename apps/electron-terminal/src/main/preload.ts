import { contextBridge } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

contextBridge.exposeInMainWorld('mana', {
  version: resolveAppVersion(),
})

function resolveAppVersion(): string {
  try {
    const pkgPath = join(__dirname, '../../package.json')
    const contents = readFileSync(pkgPath, 'utf-8')
    const parsed = JSON.parse(contents) as { version?: string }
    return parsed.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
