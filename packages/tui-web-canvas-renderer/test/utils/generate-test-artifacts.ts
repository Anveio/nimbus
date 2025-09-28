import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, Image } from 'canvas'

const ARTIFACT_ROOT = fileURLToPath(new URL('../__artifacts__', import.meta.url))
const CANVAS_PADDING = 16
const LABEL_HEIGHT = 20
const GUTTER = 16
const LABEL_FONT = '16px "SFMono-Regular", "Menlo", monospace'
const BACKGROUND_COLOR = '#1b1b1d'
const LABEL_COLOR = '#f5f5f5'
const SEPARATOR_COLOR = '#2d2d30'

type LabelTriple = readonly [string, string, string]

const ensureDirectory = async (path: string): Promise<void> => {
  await mkdir(path, { recursive: true })
}

const loadImage = (buffer: Buffer): Promise<Image> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = (error) => reject(error)
    image.src = buffer
  })

const composeSideBySide = async (
  buffers: readonly [Buffer, Buffer, Buffer],
  labels: LabelTriple,
): Promise<Buffer> => {
  const [expected, actual, diff] = await Promise.all([
    loadImage(buffers[0]),
    loadImage(buffers[1]),
    loadImage(buffers[2]),
  ])
  const images: readonly Image[] = [expected, actual, diff]
  const width = Math.max(...images.map((image) => image.width))
  const height = Math.max(...images.map((image) => image.height))
  const columns = images.length
  const canvasWidth = CANVAS_PADDING * 2 + width * columns + GUTTER * (columns - 1)
  const canvasHeight = CANVAS_PADDING * 2 + LABEL_HEIGHT + height
  const composite = createCanvas(canvasWidth, canvasHeight)
  const context = composite.getContext('2d')
  context.fillStyle = BACKGROUND_COLOR
  context.fillRect(0, 0, canvasWidth, canvasHeight)
  context.font = LABEL_FONT
  context.fillStyle = LABEL_COLOR
  context.textBaseline = 'top'
  let x = CANVAS_PADDING

  images.forEach((image, index) => {
    const label = labels[index] ?? ''
    context.fillText(label, x, CANVAS_PADDING)
    context.drawImage(image, x, CANVAS_PADDING + LABEL_HEIGHT, width, height)

    if (index < columns - 1) {
      const separatorX = x + width + GUTTER / 2
      context.fillStyle = SEPARATOR_COLOR
      context.fillRect(
        separatorX,
        CANVAS_PADDING,
        2,
        LABEL_HEIGHT + height,
      )
      context.fillStyle = LABEL_COLOR
    }

    x += width + GUTTER
  })

  return composite.toBuffer('image/png')
}

export interface ComparisonArtifactOptions {
  readonly caseName: string
  readonly expected: Buffer
  readonly actual: Buffer
  readonly diff: Buffer
  readonly labels?: LabelTriple
}

export interface ComparisonArtifactPaths {
  readonly directory: string
  readonly expectedPath: string
  readonly actualPath: string
  readonly diffPath: string
  readonly sideBySidePath: string
}

const sanitizeCaseName = (value: string): string =>
  value.replace(/[^a-z0-9-_]/gi, '_')

/**
 * Persists the full artifact bundle for a renderer regression check. We emit the
 * raw `expected`, `actual`, and `diff` PNG buffers as independent files and then
 * compose a labelled, side-by-side reference image so developers can eyeball
 * failures without juggling multiple assets. Callers pass a human-readable
 * `caseName`; we sanitise it into a folder under `test/__artifacts__` that is
 * gitignored, keeping CI/local runs lightweight.
 */
export const writeComparisonArtifacts = async (
  options: ComparisonArtifactOptions,
): Promise<ComparisonArtifactPaths> => {
  const labels: LabelTriple = options.labels ?? [
    'expected',
    'actual',
    'diff',
  ]
  const directory = join(ARTIFACT_ROOT, sanitizeCaseName(options.caseName))
  await ensureDirectory(directory)

  const [expectedPath, actualPath, diffPath] = await Promise.all([
    writeFile(join(directory, 'expected.png'), options.expected).then(
      () => join(directory, 'expected.png'),
    ),
    writeFile(join(directory, 'actual.png'), options.actual).then(
      () => join(directory, 'actual.png'),
    ),
    writeFile(join(directory, 'diff.png'), options.diff).then(
      () => join(directory, 'diff.png'),
    ),
  ])

  const compositeBuffer = await composeSideBySide(
    [options.expected, options.actual, options.diff],
    labels,
  )
  const sideBySidePath = join(directory, 'side-by-side.png')
  await writeFile(sideBySidePath, compositeBuffer)

  return {
    directory,
    expectedPath,
    actualPath,
    diffPath,
    sideBySidePath,
  }
}
