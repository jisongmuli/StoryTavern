import { v4 as uuid } from 'uuid'
import type { Session } from '../types'

export function copyStoryMessages(source: Session): { session: Session; messageIds: Map<string, string> } {
  const session = structuredClone(source)
  const lists = [
    session.messages,
    ...(session.threads || []).map((t) => t.messages),
    ...Object.values(session.messageForksHash || {}).flatMap((f) => f.lists.map((l) => l.messages)),
  ]
  const messageIds = new Map(lists.flatMap((list) => list.map((m) => [m.id, uuid()] as const)))
  for (const list of lists)
    for (const message of list) {
      message.id = messageIds.get(message.id)!
      message.generating = false
    }
  const points = (list: Session['compactionPoints']) =>
    list?.map((p) => ({
      ...p,
      summaryMessageId: messageIds.get(p.summaryMessageId) || p.summaryMessageId,
      boundaryMessageId: messageIds.get(p.boundaryMessageId) || p.boundaryMessageId,
    }))
  session.compactionPoints = points(session.compactionPoints)
  session.threads = session.threads?.map((t) => ({ ...t, id: uuid(), compactionPoints: points(t.compactionPoints) }))
  if (session.messageForksHash)
    session.messageForksHash = Object.fromEntries(
      Object.entries(session.messageForksHash).map(([id, entry]) => [
        messageIds.get(id) || id,
        { ...entry, lists: entry.lists.map((list) => ({ ...list, id: uuid() })) },
      ])
    )
  if (session.tavern) {
    session.tavern.memoryHistory = session.tavern.memoryHistory.map((m) => ({
      ...m,
      anchorId: messageIds.get(m.anchorId) || m.anchorId,
    }))
    session.tavern.memoryNotes = session.tavern.memoryNotes.map((m) => ({
      ...m,
      id: uuid(),
      anchorId: m.anchorId ? messageIds.get(m.anchorId) || m.anchorId : undefined,
    }))
  }
  if (session.settings) session.settings = { ...session.settings, sessionPromptContextSnapshot: undefined }
  return { session, messageIds }
}
