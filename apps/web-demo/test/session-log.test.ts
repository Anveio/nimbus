import { describe, expect, it } from 'vitest'

import {
  initialSessionLogState,
  sessionLogReducer,
} from '../src/hooks/session-log'

describe('sessionLogReducer', () => {
  it('appends log entries with stable sequencing', () => {
    const first = sessionLogReducer(initialSessionLogState, {
      type: 'append',
      timestamp: 10,
      message: 'first message',
    })

    expect(first.entries).toHaveLength(1)
    expect(first.entries[0]).toMatchObject({
      id: 1,
      timestamp: 10,
      message: 'first message',
    })
    expect(first.sequence).toBe(1)

    const second = sessionLogReducer(first, {
      type: 'append',
      timestamp: 20,
      message: 'second message',
    })

    expect(second.entries).toHaveLength(2)
    expect(second.entries.at(-1)).toMatchObject({
      id: 2,
      timestamp: 20,
      message: 'second message',
    })
    expect(second.sequence).toBe(2)
  })

  it('clears entries without resetting id sequencing', () => {
    const populated = sessionLogReducer(initialSessionLogState, {
      type: 'append',
      timestamp: 5,
      message: 'hello',
    })
    const cleared = sessionLogReducer(populated, { type: 'clear' })

    expect(cleared.entries).toHaveLength(0)
    expect(cleared.sequence).toBe(populated.sequence)

    const afterClearAppend = sessionLogReducer(cleared, {
      type: 'append',
      timestamp: 15,
      message: 'after clear',
    })

    expect(afterClearAppend.entries[0]?.id).toBe(populated.sequence + 1)
  })

  it('is a no-op when clearing an already empty log', () => {
    const cleared = sessionLogReducer(initialSessionLogState, {
      type: 'clear',
    })

    expect(cleared).toBe(initialSessionLogState)
  })
})
