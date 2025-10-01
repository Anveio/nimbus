import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'

const OUTPUT_DIR = path.resolve(
  __dirname,
  'dist',
)

const BUNDLE_PATH = path.join(OUTPUT_DIR, 'harness.js')

export default async function globalSetup(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const result = await build({
    entryPoints: [path.resolve(__dirname, 'harness.ts')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outfile: BUNDLE_PATH,
    sourcemap: 'inline',
    platform: 'browser',
    write: false,
  })

  const outputFile = result.outputFiles?.[0]
  if (!outputFile) {
    throw new Error('Failed to bundle Playwright harness')
  }

  await writeFile(BUNDLE_PATH, outputFile.contents)
}

export { BUNDLE_PATH }
