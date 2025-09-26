import type { ParserEventType, ParserState } from "../types";

/**
 * Primitive parser actions executed during state transitions.
 */
export enum ActionType {
  None = "none",
  Print = "print",
  Execute = "execute",
  Clear = "clear",
  CollectIntermediate = "collect_intermediate",
  CollectParam = "collect_param",
  ParamSeparator = "param_separator",
  SetPrivateFlag = "set_private_flag",
  Dispatch = "dispatch",
  EnterOsc = "enter_osc",
  OscPut = "osc_put",
  ExitOsc = "exit_osc",
  DcsHook = "dcs_hook",
  DcsPut = "dcs_put",
  DcsUnhook = "dcs_unhook",
  Ignore = "ignore",
}

export interface Action {
  readonly type: ActionType;
  readonly event?: ParserEventType;
}

export interface Transition {
  readonly nextState: ParserState;
  readonly actions: ReadonlyArray<Action>;
}
