import { expect, it } from 'vitest'
import { createMessage, type Session } from '../types'
import { createTavernSession } from './types'
import { copyStoryMessages } from './copy'
it('remaps fork pivots and memory anchors when importing a copy', () => {
  const u = createMessage('user', '出发'),
    a = createMessage('assistant', '到了海港'),
    b = createMessage('assistant', '到了山间')
  const source: Session = {
    id: 's',
    name: '旧故事',
    type: 'chat',
    messages: [u, a],
    messageForksHash: {
      [u.id]: {
        position: 0,
        createdAt: 1,
        lists: [
          { id: 'l1', messages: [] },
          { id: 'l2', messages: [b] },
        ],
      },
    },
    tavern: createTavernSession({
      memoryHistory: [{ anchorId: a.id, text: '海港', createdAt: 1 }],
      memoryNotes: [{ id: 'n', text: '山间事实', locked: true, anchorId: b.id }],
    }),
  }
  const { session, messageIds } = copyStoryMessages(source)
  expect(session.messages[0].id).not.toBe(u.id)
  expect(session.messageForksHash).toHaveProperty(messageIds.get(u.id)!)
  expect(session.tavern!.memoryHistory[0].anchorId).toBe(messageIds.get(a.id))
  expect(session.tavern!.memoryNotes[0].anchorId).toBe(messageIds.get(b.id))
  expect(source.messages[0].id).toBe(u.id)
})
