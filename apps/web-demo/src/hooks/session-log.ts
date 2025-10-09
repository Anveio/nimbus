export interface SessionLogEntry {
  readonly id: number
  readonly timestamp: number
  readonly message: string
}

export interface SessionLogState {
  readonly entries: SessionLogEntry[]
  readonly sequence: number
}

export const initialSessionLogState: SessionLogState = {
  entries: [],
  sequence: 0,
}

type SessionLogAction =
  | {
      readonly type: 'append'
      readonly timestamp: number
      readonly message: string
    }
  | { readonly type: 'clear' }

export function sessionLogReducer(
  state: SessionLogState,
  action: SessionLogAction,
): SessionLogState {
  if (action.type === 'append') {
    const nextSequence = state.sequence + 1
    const entry: SessionLogEntry = {
      id: nextSequence,
      timestamp: action.timestamp,
      message: action.message,
    }
    return {
      entries: [...state.entries, entry],
      sequence: nextSequence,
    }
  }

  if (action.type === 'clear') {
    if (state.entries.length === 0) {
      return state
    }
    return {
      entries: [],
      sequence: state.sequence,
    }
  }

  return state
}
