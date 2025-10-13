import React from 'react'

export interface InstructionPanelProps {
  readonly title: string
  readonly description?: string
  readonly steps: readonly {
    readonly heading: string
    readonly detail: string
  }[]
  readonly action?: React.ReactNode
}

export function InstructionPanel(
  props: InstructionPanelProps,
): React.ReactElement {
  const { title, description, steps, action } = props
  return (
    <section
      style={{
        borderRadius: '16px',
        padding: '2.5rem',
        background:
          'linear-gradient(160deg, rgba(30, 41, 59, 0.85) 0%, rgba(30, 64, 175, 0.35) 100%)',
        border: '1px solid rgba(59, 130, 246, 0.35)',
        color: 'rgba(226, 232, 240, 0.95)',
        maxWidth: '720px',
        margin: '0 auto',
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: '1.35rem',
          fontWeight: 600,
        }}
      >
        {title}
      </h2>
      {description ? (
        <p
          style={{
            marginTop: '0.75rem',
            marginBottom: '1.5rem',
            fontSize: '1rem',
            color: 'rgba(226, 232, 240, 0.8)',
            lineHeight: 1.6,
          }}
        >
          {description}
        </p>
      ) : null}
      <ol
        style={{
          margin: 0,
          paddingLeft: '1.2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        {steps.map((step, index) => (
          <li key={index}>
            <p
              style={{
                margin: 0,
                fontWeight: 600,
                fontSize: '1rem',
              }}
            >
              {step.heading}
            </p>
            <p
              style={{
                marginTop: '0.35rem',
                marginBottom: 0,
                fontSize: '0.95rem',
                color: 'rgba(203, 213, 225, 0.85)',
                lineHeight: 1.6,
              }}
            >
              {step.detail}
            </p>
          </li>
        ))}
      </ol>
      {action ? (
        <div
          style={{
            marginTop: '2rem',
          }}
        >
          {action}
        </div>
      ) : null}
    </section>
  )
}
