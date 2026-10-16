import { create } from 'zustand'
import type { Message } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { getTavernMemory } from '@shared/tavern/prompt'
import { memoryChunks, memoryRevision } from '@shared/tavern/memory'
import { rendererApplication } from '@/app/renderer-application'
import { currentModelFactory } from '@/adapters/CurrentModelFactory'
import { getSessionSettings } from '@/stores/session/session-settings'
import { settingsStore } from '@/stores/settingsStore'

export const useTavernAIStatus = create<{ memory: Record<string, 'working' | 'failed' | undefined> }>(() => ({
  memory: {},
}))
const workers = new Map<string, Promise<void>>()

export async function runTavernAI(task: string, source: string, sessionId?: string): Promise<string> {
  const global = settingsStore.getState().getSettings()
  const sessionSettings = sessionId ? await getSessionSettings(sessionId) : undefined
  const modelChoice = sessionSettings || {
    provider: global.defaultChatModel?.provider,
    modelId: global.defaultChatModel?.model,
  }
  if (!modelChoice?.provider || !modelChoice.modelId) throw new Error('请先在接口设置里选择模型。')
  if (!global.providers?.[modelChoice.provider]?.apiKey)
    throw new Error('请先填写当前模型的接口密钥，再使用AI整理。原文可以直接保存。')
  const model = await currentModelFactory.createModel({
    ...modelChoice,
    temperature: 0.4,
    maxTokens: 5000,
    stream: false,
  })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180000)
  try {
    const result = await model.chat(
      [
        { role: 'system', content: task },
        { role: 'user', content: source },
      ],
      { signal: controller.signal, tools: {}, agentMode: false, maxSteps: 1 }
    )
    const answer = result.contentParts
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
      .trim()
    if (!answer) throw new Error('模型没有返回整理结果，请重试。')
    return answer
  } finally {
    clearTimeout(timeout)
  }
}

export async function updateTavernMemory(sessionId: string, force = false): Promise<void> {
  if (workers.has(sessionId)) return workers.get(sessionId)
  const operation = (async () => {
    const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
    const state = session?.tavern
    if (!session || !state || (!force && state.memoryMode !== 'auto')) return
    const messages = session.messages.filter((m) => !m.isForkMarker && !m.isSummary && !m.generating && !m.error)
    const anchor = messages.at(-1)
    if (!anchor || anchor.role !== 'assistant') {
      if (force) throw new Error('请先完成一段故事回复，再整理记忆。')
      return
    }
    const previous = [...state.memoryHistory].reverse().find((entry) => messages.some((m) => m.id === entry.anchorId))
    const boundary = previous ? messages.findIndex((m) => m.id === previous.anchorId) : -1
    const additions = messages.slice(boundary + 1).filter((m) => m.role !== 'system')
    if (!force && additions.filter((m) => m.role === 'assistant').length < 6) return
    const signature = memoryRevision(state, messages)
    useTavernAIStatus.setState((current) => ({ memory: { ...current.memory, [sessionId]: 'working' } }))
    try {
      let answer = getTavernMemory(state, messages)
      for (const chunk of memoryChunks(additions)) {
        const live = await rendererApplication.sessionQueryBridge.getSession(sessionId)
        const liveMessages = live?.messages.filter((m) => !m.isForkMarker && !m.isSummary && !m.generating && !m.error)
        if (!live?.tavern || memoryRevision(live.tavern, liveMessages!) !== signature) {
          useTavernAIStatus.setState((current) => ({ memory: { ...current.memory, [sessionId]: undefined } }))
          return
        }
        const source = `已有记忆：\n${answer}\n\n固定事实与手动记录：\n${getTavernMemory({ ...state, memoryHistory: [] }, messages)}\n\n本路线的后续对话（按顺序分段整理）：\n${chunk}`
        answer = await runTavernAI(
          '整理这段故事的连续性记忆。保留人物身份与关系、时间地点、已经发生的关键事件、未解决线索。固定事实必须保留，不擅自更改。不写后续剧情，不把建议或假设当成已发生事实。用清楚的中文分项描述，控制在1200字以内，只返回记忆正文。',
          source,
          sessionId
        )
      }
      await rendererApplication.sessions.updateSessionWithMessages(sessionId, (current) => {
        if (!current?.tavern) return current!
        const currentMessages = current.messages.filter(
          (m) => !m.isForkMarker && !m.isSummary && !m.generating && !m.error
        )
        if (memoryRevision(current.tavern, currentMessages) !== signature) return current
        if (!force && current.tavern.memoryMode !== 'auto') return current
        return {
          ...current,
          tavern: {
            ...current.tavern,
            memoryHistory: [
              ...current.tavern.memoryHistory,
              { anchorId: anchor.id, text: answer, createdAt: Date.now() },
            ],
          },
        }
      })
      useTavernAIStatus.setState((current) => ({ memory: { ...current.memory, [sessionId]: undefined } }))
    } catch (error) {
      useTavernAIStatus.setState((current) => ({ memory: { ...current.memory, [sessionId]: 'failed' } }))
      if (force) throw error
    }
  })().finally(() => workers.delete(sessionId))
  workers.set(sessionId, operation)
  return operation
}

export function afterTavernMessage(sessionId: string, message: Message): void {
  if (message.error || !getMessageText(message).trim()) return
  void updateTavernMemory(sessionId).catch(() => undefined)
}
