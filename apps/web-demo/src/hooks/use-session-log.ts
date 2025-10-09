import { useCallback, useReducer } from 'react'

import {
  initialSessionLogState,
  sessionLogReducer,
  type SessionLogEntry,
} from './session-log'

type SessionLogClock = () => number

const defaultClock: SessionLogClock = () => Date.now()

export function useSessionLog(clock: SessionLogClock = defaultClock) {
  const [state, dispatch] = useReducer(
    sessionLogReducer,
    initialSessionLogState,
  )

  const append = useCallback(
    (message: string) => {
      dispatch({ type: 'append', message, timestamp: clock() })
    },
    [clock],
  )

  const clear = useCallback(() => {
    dispatch({ type: 'clear' })
  }, [])

  return {
    entries: state.entries,
    append,
    clear,
  } satisfies {
    entries: SessionLogEntry[]
    append: (message: string) => void
    clear: () => void
  }
}
