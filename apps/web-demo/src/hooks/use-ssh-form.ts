import { useCallback, useReducer } from 'react'

export interface SshFormState {
  readonly signedUrl: string
  readonly host: string
  readonly port: string
  readonly username: string
  readonly endpoint: string
  readonly awsRegion: string
  readonly awsService: string
  readonly expiresInSeconds: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly sessionToken: string
}

type Field = keyof SshFormState

const defaultState: SshFormState = {
  signedUrl: '',
  host: '',
  port: '22',
  username: '',
  endpoint:
    'wss://prod.us-west-2.oneclickv2-proxy.ec2.aws.dev/proxy/instance-connect',
  awsRegion: 'us-west-2',
  awsService: 'ec2-instance-connect',
  expiresInSeconds: '60',
  accessKeyId: '',
  secretAccessKey: '',
  sessionToken: '',
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
