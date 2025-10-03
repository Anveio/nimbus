import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoResize } from './useAutoResize'

interface TestComponentProps {
  readonly autoResize: boolean
  readonly rows?: number
  readonly columns?: number
  readonly defaultRows?: number
  readonly defaultColumns?: number
  readonly cellWidth?: number
  readonly cellHeight?: number
  readonly onSnapshot?: (snapshot: { rows: number; columns: number }) => void
}

const TestComponent = ({
  autoResize,
  rows,
  columns,
  defaultRows = 24,
  defaultColumns = 80,
  cellWidth = 10,
  cellHeight = 20,
  onSnapshot,
}: TestComponentProps) => {
  const {
    containerRef,
    rows: resolvedRows,
    columns: resolvedColumns,
  } = useAutoResize({
    autoResize,
    rows,
    columns,
    defaultRows,
    defaultColumns,
    cellMetrics: { width: cellWidth, height: cellHeight },
  })

  onSnapshot?.({ rows: resolvedRows, columns: resolvedColumns })

  return <div data-testid="host" ref={containerRef} />
}

describe('useAutoResize', () => {
  const observedElements: Element[] = []
  let observerCallback: ResizeObserverCallback | null = null
  const observeMock = vi.fn()
  const disconnectMock = vi.fn()

  beforeEach(() => {
    observedElements.length = 0
    observerCallback = null
    observeMock.mockReset()
    disconnectMock.mockReset()

    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          observerCallback = callback
        }

        observe(element: Element): void {
          observedElements.push(element)
          observeMock(element)
        }

        unobserve(): void {}

        disconnect(): void {
          disconnectMock()
        }
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const createEntry = (
    target: Element,
    width: number,
    height: number,
  ): ResizeObserverEntry =>
    ({
      target,
      contentRect: new DOMRect(0, 0, width, height),
      borderBoxSize: [] as unknown as ReadonlyArray<ResizeObserverSize>,
      contentBoxSize: [] as unknown as ReadonlyArray<ResizeObserverSize>,
      devicePixelContentBoxSize:
        [] as unknown as ReadonlyArray<ResizeObserverSize>,
    }) satisfies ResizeObserverEntry

  it('returns clamped rows and columns when autoResize is disabled', () => {
    const handleSnapshot = vi.fn()
    render(
      <TestComponent
        autoResize={false}
        rows={30}
        columns={120}
        onSnapshot={handleSnapshot}
      />,
    )

    expect(handleSnapshot).toHaveBeenLastCalledWith({ rows: 30, columns: 120 })
    expect(observeMock).not.toHaveBeenCalled()
    expect(disconnectMock).not.toHaveBeenCalled()
  })

  it('computes dimensions based on resize observer measurements', () => {
    const handleSnapshot = vi.fn()

    render(
      <TestComponent
        autoResize
        rows={undefined}
        columns={undefined}
        onSnapshot={handleSnapshot}
      />,
    )

    const host = screen.getByTestId('host')
    expect(observedElements).toContain(host)

    expect(observerCallback).not.toBeNull()

    act(() => {
      observerCallback?.([createEntry(host, 200, 100)], new ResizeObserver(() => {}) as any)
    })

    expect(handleSnapshot).toHaveBeenLastCalledWith({ rows: 5, columns: 20 })
  })

  it('resets container size when autoResize toggles off', () => {
    const handleSnapshot = vi.fn()

    const { rerender } = render(
      <TestComponent
        autoResize
        rows={undefined}
        columns={undefined}
        onSnapshot={handleSnapshot}
      />,
    )

    act(() => {
      observerCallback?.([createEntry(observedElements[0]!, 300, 200)], new ResizeObserver(() => {}) as any)
    })

    expect(handleSnapshot).toHaveBeenLastCalledWith({ rows: 10, columns: 30 })

    rerender(
      <TestComponent
        autoResize={false}
        rows={undefined}
        columns={undefined}
        onSnapshot={handleSnapshot}
      />,
    )

    expect(handleSnapshot).toHaveBeenLastCalledWith({ rows: 24, columns: 80 })
  })
})
