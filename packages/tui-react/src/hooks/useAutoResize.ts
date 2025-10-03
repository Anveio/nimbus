import { useEffect, useRef, useState } from 'react'

interface CellMetrics {
  readonly width: number
  readonly height: number
}

interface UseAutoResizeOptions {
  readonly rows?: number
  readonly columns?: number
  readonly autoResize: boolean
  readonly defaultRows: number
  readonly defaultColumns: number
  readonly cellMetrics: CellMetrics
  readonly minRows?: number
  readonly maxRows?: number
  readonly minColumns?: number
  readonly maxColumns?: number
}

interface UseAutoResizeResult {
  readonly containerRef: React.RefObject<HTMLDivElement | null>
  readonly rows: number
  readonly columns: number
}

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value))
}

const DEFAULT_MIN_DIMENSION = 1
const DEFAULT_MAX_DIMENSION = 500

export const useAutoResize = ({
  rows,
  columns,
  autoResize,
  defaultRows,
  defaultColumns,
  cellMetrics,
  minRows = DEFAULT_MIN_DIMENSION,
  maxRows = DEFAULT_MAX_DIMENSION,
  minColumns = DEFAULT_MIN_DIMENSION,
  maxColumns = DEFAULT_MAX_DIMENSION,
}: UseAutoResizeOptions): UseAutoResizeResult => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(
    null,
  )

  useEffect(() => {
    if (!autoResize) {
      setContainerSize(null)
      return undefined
    }

    const node = containerRef.current
    if (!node || typeof ResizeObserver === 'undefined') {
      return undefined
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }
      const { width, height } = entry.contentRect
      if (!Number.isNaN(width) && !Number.isNaN(height)) {
        setContainerSize({ width, height })
      }
    })

    observer.observe(node)
    return () => observer.disconnect()
  }, [autoResize])

  const cellWidth = Math.max(cellMetrics.width, 1)
  const cellHeight = Math.max(cellMetrics.height, 1)

  const fallbackWidth = (columns ?? defaultColumns) * cellWidth
  const fallbackHeight = (rows ?? defaultRows) * cellHeight

  const effectiveWidth = autoResize && containerSize ? containerSize.width : fallbackWidth
  const effectiveHeight = autoResize && containerSize ? containerSize.height : fallbackHeight

  const autoColumns = Math.max(DEFAULT_MIN_DIMENSION, Math.floor(effectiveWidth / cellWidth))
  const autoRows = Math.max(DEFAULT_MIN_DIMENSION, Math.floor(effectiveHeight / cellHeight))

  const resolvedColumns = clamp(columns ?? autoColumns, minColumns, maxColumns)
  const resolvedRows = clamp(rows ?? autoRows, minRows, maxRows)

  return {
    containerRef,
    rows: resolvedRows,
    columns: resolvedColumns,
  }
}
