'use client'

import { createAwsSerialBaudPolicy } from '@/lib/aws-serial'
import { Terminal } from '@nimbus/react'
import { createDefaultTerminalRuntime } from '@nimbus/vt'
import type React from 'react'
import { useEffect, useMemo, useRef } from 'react'

export function TerminalPreview(): React.ReactElement {
  const runtimeRef = useRef(createDefaultTerminalRuntime())

  const awsSerialPolicy = useMemo(() => createAwsSerialBaudPolicy(), [])
  const throttleSnapshot = useMemo(
    () => awsSerialPolicy.throttler?.inspect(Date.now()),
    [awsSerialPolicy],
  )
  const enforcedBaud = Number(awsSerialPolicy.enforced.output)
  const approxBytesPerSecond = Math.floor(enforcedBaud / 10)
  const approxKibPerSecond = approxBytesPerSecond / 1024
  const burstBytes = throttleSnapshot?.capacity ?? approxBytesPerSecond

  const welcomeFrame = useMemo(
    () => [
      'Nimbus Terminal Demo',
      '',
      'A connection has not been established yet.',
      'Configure EC2 Instance Connect, generate a websocket bridge, and forward runtime responses to complete the circuit.',
      '',
      `Serial console target: ${enforcedBaud.toLocaleString()} baud (~${approxKibPerSecond.toFixed(2)} KiB/s).`,
      `Nimbus throttling: burst ${Math.round(burstBytes).toLocaleString()} bytes, steady ${approxBytesPerSecond.toLocaleString()} B/s.`,
      '',
      'Because the runtime is hot, you can still experiment with local editing commands, selections, and Nimbus renderer capabilities.',
      '',
    ],
    [approxBytesPerSecond, approxKibPerSecond, burstBytes, enforcedBaud],
  )

  useEffect(() => {
    const runtime = runtimeRef.current
    const text = `${welcomeFrame.join('\n')}\n`
    runtime.write(text)
    runtime.write('> ')
  }, [welcomeFrame])

  return (
    <div
      style={{
        borderRadius: '16px',
        overflow: 'hidden',
        border: '1px solid rgba(59, 130, 246, 0.4)',
        boxShadow: '0 25px 50px -12px rgba(59, 130, 246, 0.45)',
        background:
          'radial-gradient(circle at 10% 10%, rgba(59, 130, 246, 0.55), transparent 60%)',
      }}
    >
      <Terminal
        rendererConfig={{ runtime: runtimeRef.current }}
        renderRootProps={{
          style: {
            width: '100%',
            height: '480px',
            display: 'block',
            backgroundColor: '#0b1120',
          },
        }}
      />
      <div
        style={{
          padding: '0.75rem 1rem',
          borderTop: '1px solid rgba(59, 130, 246, 0.35)',
          backgroundColor: 'rgba(10, 37, 64, 0.55)',
        }}
      >
        <p
          style={{
            margin: 0,
            marginBottom: '0.4rem',
            fontSize: '0.78rem',
            color: 'rgba(191, 219, 254, 0.82)',
            letterSpacing: '0.01em',
          }}
        >
          AWS EC2 serial console expects{' '}
          {enforcedBaud.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}{' '}
          baud (~{approxKibPerSecond.toFixed(2)} KiB/s).
        </p>
        <p
          style={{
            margin: 0,
            fontSize: '0.74rem',
            color: 'rgba(148, 163, 184, 0.78)',
          }}
        >
          Nimbus token bucket ready: burst{' '}
          {Math.round(burstBytes).toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}{' '}
          bytes, refill{' '}
          {approxBytesPerSecond.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}{' '}
          B/s.
        </p>
      </div>
    </div>
  )
}
