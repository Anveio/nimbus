"use client"

import React, { useEffect, useMemo, useRef } from 'react'
import { Terminal } from '@nimbus/react'
import { createDefaultTerminalRuntime } from '@nimbus/vt'

export function TerminalPreview(): React.ReactElement {
  const runtimeRef = useRef(createDefaultTerminalRuntime())

  const welcomeFrame = useMemo(
    () => [
      'Nimbus Terminal Demo',
      '',
      'A connection has not been established yet.',
      'Configure EC2 Instance Connect, generate a websocket bridge, and forward runtime responses to complete the circuit.',
      '',
      'Because the runtime is hot, you can still experiment with local editing commands, selections, and Nimbus renderer capabilities.',
      '',
    ],
    [],
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
    </div>
  )
}
