import type { Message } from '../types'
import { getMessageText } from '../utils/message'
import type { TavernSession } from './types'

// A pending model answer is valid only for the exact story and memory it read.
export function memoryRevision(state: TavernSession, messages: Message[]): string {
  return JSON.stringify({
    messages: messages.map((message) => [message.id, message.role, getMessageText(message)]),
    notes: state.memoryNotes,
    history: state.memoryHistory,
    mode: state.memoryMode,
  })
}

export function memoryChunks(messages: Message[], maxCharacters = 12000): string[] {
  if (maxCharacters < 1) throw new Error('记忆分段长度必须大于0。')
  const chunks: string[] = []
  let current = ''
  for (const message of messages) {
    const text = `${message.role === 'user' ? '用户指令' : '正文'}：${getMessageText(message)}\n\n`
    for (let start = 0; start < text.length; start += maxCharacters) {
      const part = text.slice(start, start + maxCharacters)
      if (current && current.length + part.length > maxCharacters) {
        chunks.push(current)
        current = ''
      }
      current += part
    }
  }
  if (current) chunks.push(current)
  return chunks
}
