import type { ParserEventType, ParserState } from '../types'

/**
 * Primitive parser actions executed during state transitions.
 */
const actionType = {
  None: 'none',
  Print: 'print',
  Execute: 'execute',
  Clear: 'clear',
  CollectIntermediate: 'collect_intermediate',
  CollectParam: 'collect_param',
  ParamSeparator: 'param_separator',
  SetPrivateFlag: 'set_private_flag',
  Dispatch: 'dispatch',
  EnterOsc: 'enter_osc',
  OscPut: 'osc_put',
  ExitOsc: 'exit_osc',
  DcsHook: 'dcs_hook',
  DcsPut: 'dcs_put',
  DcsUnhook: 'dcs_unhook',
  Ignore: 'ignore',
} as const

export const ActionType = actionType
export type ActionType = (typeof actionType)[keyof typeof actionType]

export interface Action {
  readonly type: ActionType
  readonly event?: ParserEventType
}

export interface Transition {
  readonly nextState: ParserState
  readonly actions: ReadonlyArray<Action>
}
