import { describe, expect, it } from 'vitest'
import { createMessage } from '../types'
import { createTavernSession } from './types'
import { memoryChunks, memoryRevision } from './memory'

describe('story memory work', () => {
  it('invalidates pending summaries when the user edits remembered facts or message roles', () => {
    const message = createMessage('assistant', '林霁进入灯塔')
    const state = createTavernSession({
      memoryHistory: [{ anchorId: message.id, text: '林霁在灯塔', createdAt: 1 }],
    })
    const revision = memoryRevision(state, [message])
    const edited = structuredClone(state)
    edited.memoryHistory[0].text = '林霁尚未进入灯塔'
    expect(memoryRevision(edited, [message])).not.toBe(revision)
    expect(memoryRevision(state, [{ ...message, role: 'user' }])).not.toBe(revision)
    expect(memoryRevision({ ...state, memoryMode: 'manual' }, [message])).not.toBe(revision)
  })
  it('bounds long imports without dropping or reordering story text', () => {
    const messages = [createMessage('user', '继续'), createMessage('assistant', '前往海港。'.repeat(10000))]
    const chunks = memoryChunks(messages)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 12000)).toBe(true)
    expect(chunks.join('')).toBe(`用户指令：继续\n\n正文：${'前往海港。'.repeat(10000)}\n\n`)
  })
})
