export type {
  DiagnosticEvent,
  FlowPauseReason,
  FlowResumeReason,
  PolicyEvent,
} from './diagnostics'
export type {
  ChannelFlowState,
  CreditDecision,
  FlowControllerState,
  FlowUpdate,
} from './flow'
export {
  applyDataReceipt,
  createFlowController,
  deregisterChannel,
  planCreditGrant,
  registerChannel,
  updateOffline,
  updateTransportBackpressure,
  updateVisibilityHidden,
} from './flow'
export type { Ctl, CtlType, DataFrame } from './messages'
export { isCtl, isDataFrame } from './messages'
export type { WireProfile } from './profiles'
export {
  clearProfilesForTest,
  getProfile,
  listProfiles,
  registerProfile,
} from './profiles'
export type {
  ChannelState,
  ConnectionEvent,
  ConnectionPhase,
  ConnectionState,
  ConnectionStateMachine,
} from './state'
export {
  createConnectionStateMachine,
  createInitialConnectionState,
  reduceConnection,
} from './state'

import {
  ensureDefaultProfiles as ensureProfilesRegistered,
  jsonBase64V1Profile,
  lenPrefixedV1Profile,
  nimbusV1Profile,
} from './profiles/defaults'

export {
  nimbusV1Profile,
  jsonBase64V1Profile,
  lenPrefixedV1Profile,
  ensureProfilesRegistered as ensureDefaultProfiles,
}

ensureProfilesRegistered()
