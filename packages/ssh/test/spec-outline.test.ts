import { describe, test } from 'vitest'

describe('Spec coverage outline', () => {
  describe('RFC 4253 §7 Algorithm Negotiation', () => {
    test.skip('FIXME: selects the first mutual key exchange algorithm in client preference order', () => {
      // Verify final reducer chooses the highest priority mutual algorithm once implemented.
      // Arrange client/server preference lists and assert chosen algorithms via session snapshot.
    })

    test.skip('FIXME: respects first_kex_packet_follows semantics when algorithms mismatch', () => {
      // Once KEX state machine exists, feed a KEXINIT with first_kex_packet_follows=true
      // and verify the next packet is ignored or consumed per spec when algorithms differ.
    })
  })

  describe('RFC 4253 §9 Rekeying', () => {
    test.skip('FIXME: initiates rekey after configured packet thresholds', () => {
      // Simulate large data transfer and assert rekey events fire before thresholds exceed spec limits.
    })

    test.skip('FIXME: aborts session when rekey negotiation fails', () => {
      // Force a failure during rekey (e.g., mismatched algorithms) and expect disconnect+diagnostics.
    })
  })

  describe('RFC 4252 Authentication Protocol', () => {
    test.skip('FIXME: announces available authentication methods after service request', () => {
      // Drive client through service request and confirm methods list emitted via auth events.
    })

    test.skip('FIXME: completes public key authentication with signature verification', () => {
      // Feed public key offer and confirm session emits auth-success only after signature validates.
    })

    test.skip('FIXME: handles partial success and retries remaining methods', () => {
      // Emulate server partial success and ensure strategy retries remaining advertised methods.
    })
  })

  describe('RFC 4254 Connection Protocol', () => {
    test.skip('FIXME: opens session channels and enforces window sizes', () => {
      // Verify channel open/confirm flows and that outbound data honors window size accounting.
    })

    test.skip('FIXME: propagates channel requests (pty-req, exec, exit-status)', () => {
      // Once channel handling exists, assert events mirror server responses and client intents.
    })

    test.skip('FIXME: cancels port forwarding on client request', () => {
      // After implementing port forwarding, ensure cancel requests trigger channel teardown per spec.
    })
  })

  describe('RFC 4255 / RFC 6187 Host Key Verification', () => {
    test.skip('FIXME: rejects host keys not anchored in trust policy', () => {
      // Provide a host key that host store marks as mismatch and ensure disconnect is emitted.
    })

    test.skip('FIXME: persists accepted host keys when TOFU policy allows', () => {
      // After remember() plumbing exists, assert successful host keys are recorded.
    })
  })

  describe('Vendor extensions (OpenSSH)', () => {
    test.skip('FIXME: advertises ext-info-c when enabled and reacts to ext-info-s', () => {
      // Confirm ext-info negotiation updates signature policy and diagnostics.
    })

    test.skip('FIXME: parses keepalive@openssh.com global requests', () => {
      // Ensure global request events emit structured payloads for keepalive pings.
    })
  })
})
