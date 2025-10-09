import { useCallback, useReducer } from 'react'

export interface SshFormState {
  readonly signedUrl: string
  readonly host: string
  readonly port: string
  readonly username: string
}

type Field = keyof SshFormState

const defaultState: SshFormState = {
  signedUrl: '',
  host: '',
  port: '22',
  username: '',
}

type SshFormAction =
  | {
      readonly type: 'update-field'
      readonly field: Field
      readonly value: string
    }
  | {
      readonly type: 'patch'
      readonly value: Partial<SshFormState>
    }

function reducer(state: SshFormState, action: SshFormAction): SshFormState {
  if (action.type === 'update-field') {
    if (state[action.field] === action.value) {
      return state
    }
    return {
      ...state,
      [action.field]: action.value,
    }
  }

  if (action.type === 'patch') {
    const next = { ...state, ...action.value }
    return next
  }

  return state
}

export function useSshFormState(
  initial: Partial<SshFormState> = defaultState,
) {
  const [state, dispatch] = useReducer(
    reducer,
    {
      ...defaultState,
      ...initial,
    },
  )

  const updateField = useCallback((field: Field, value: string) => {
    dispatch({ type: 'update-field', field, value })
  }, [])

  const patch = useCallback((value: Partial<SshFormState>) => {
    dispatch({ type: 'patch', value })
  }, [])

  return {
    state,
    updateField,
    patch,
  }
}
