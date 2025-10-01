/**
 * Base error class for SSH engine faults.
 */
export class SshError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SshError'
  }
}

/**
 * Raised when the engine encounters malformed input or protocol violations.
 *
 * @see RFC 4253 §12 (Disconnect Message)
 */
export class SshProtocolError extends SshError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SshProtocolError'
  }
}

/**
 * Raised when inbound bytes cannot be parsed according to SSH framing rules.
 */
export class SshDecodeError extends SshProtocolError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SshDecodeError'
  }
}

/**
 * Raised when an invariant internal to the reducer is violated. These indicate
 * implementation defects rather than peer behaviour.
 */
export class SshInvariantViolation extends SshError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SshInvariantViolation'
  }
}

/**
 * Helper to signal unimplemented code paths while scaffolding the reducer.
 */
export class SshNotImplementedError extends SshError {
  constructor(message: string) {
    super(message)
    this.name = 'SshNotImplementedError'
  }
}
