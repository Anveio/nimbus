import { useCallback, useEffect, useMemo, useRef } from 'react'

type AutoScrollDirection = -1 | 0 | 1

type AutoScrollTimer = number | null

interface AutoScrollState {
  timer: AutoScrollTimer
  direction: AutoScrollDirection
  step: (() => void) | null
}

export interface UseSelectionAutoScrollOptions {
  readonly intervalMs?: number
}

export interface SelectionAutoScrollHandle {
  readonly start: (direction: -1 | 1, step: () => void) => void
  readonly stop: () => void
  readonly getDirection: () => AutoScrollDirection
}

const clearTimer = (timer: AutoScrollTimer): void => {
  if (timer !== null) {
    window.clearInterval(timer)
  }
}

export const useSelectionAutoScroll = (
  options?: UseSelectionAutoScrollOptions,
): SelectionAutoScrollHandle => {
  const stateRef = useRef<AutoScrollState>({
    timer: null,
    direction: 0,
    step: null,
  })

  const interval = options?.intervalMs ?? 50

  const stop = useCallback(() => {
    const state = stateRef.current
    if (state.timer !== null) {
      clearTimer(state.timer)
      state.timer = null
    }
    state.direction = 0
    state.step = null
  }, [])

  const start = useCallback(
    (direction: -1 | 1, step: () => void) => {
      const state = stateRef.current
      if (state.timer !== null && state.direction === direction) {
        state.step = step
        return
      }

      stop()

      state.direction = direction
      state.step = step
      state.timer = window.setInterval(() => {
        state.step?.()
      }, interval)
    },
    [interval, stop],
  )

  useEffect(() => () => stop(), [stop])

  return useMemo(
    () => ({
      start,
      stop,
      getDirection: () => stateRef.current.direction,
    }),
    [start, stop],
  )
}
