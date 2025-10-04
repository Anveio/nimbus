export type DiagnosticEvent =
  | {
      readonly type: 'handshake'
      readonly attempt: number
      readonly timestamp: number
      readonly resumeTokenPresent: boolean
      readonly profileRequested?: string
    }
  | {
      readonly type: 'ping'
      readonly timestamp: number
      readonly rttMs: number
      readonly misses: number
    }
  | {
      readonly type: 'heartbeat_timeout'
      readonly timestamp: number
      readonly threshold: number
      readonly misses: number
    }
  | {
      readonly type: 'close'
      readonly timestamp: number
      readonly wsCode?: number
      readonly appCode?: number
      readonly reason?: string
      readonly phase: string
    }
  | {
      readonly type: 'resume_attempt'
      readonly timestamp: number
      readonly tokenHash: string
    }
  | {
      readonly type: 'resume_success'
      readonly timestamp: number
      readonly tokenHash: string
    }
  | {
      readonly type: 'resume_failure'
      readonly timestamp: number
      readonly tokenHash?: string
      readonly code: string
    }
  | {
      readonly type: 'buffer_state'
      readonly timestamp: number
      readonly state: 'high' | 'recovered'
      readonly bufferedAmount: number
      readonly threshold: number
    }

export type FlowPauseReason =
  | 'transport_backpressure'
  | 'visibility_hidden'
  | 'offline'
  | 'policy'

export type FlowResumeReason =
  | 'transport_recovered'
  | 'visibility_visible'
  | 'online'
  | 'policy_clear'

export type PolicyEvent =
  | {
      readonly type: 'flow_pause'
      readonly reason: FlowPauseReason
      readonly timestamp: number
    }
  | {
      readonly type: 'flow_resume'
      readonly reason: FlowResumeReason
      readonly timestamp: number
    }
  | {
      readonly type: 'credit_grant'
      readonly channelId: number
      readonly granted: number
      readonly outstanding: number
      readonly windowTarget: number
      readonly timestamp: number
    }
  | {
      readonly type: 'resize_coalesced'
      readonly count: number
      readonly timestamp: number
    }
