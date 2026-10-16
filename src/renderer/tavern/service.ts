import { v4 as uuid } from 'uuid'
import { createMessage, ModelProviderEnum, ModelProviderType, type Message, type Session } from '@shared/types'
import { createTavernSession, type TavernSession, type TavernAsset, TavernSessionSchema } from '@shared/tavern/types'
import { memoryAtBranch } from '@shared/tavern/prompt'
import { findMessageContext } from '@shared/session/message-forks'
import { getMessageText } from '@shared/utils/message'
import { rendererApplication } from '@/app/renderer-application'
import { initEmptyChatSession } from '@/stores/sessionHelpers'
import { switchCurrentSession } from '@/stores/session/crud'
import { findMessageLocation, submitNewUserMessage } from '@/stores/session'
import { settingsStore } from '@/stores/settingsStore'
import { add as showToast } from '@/stores/toastActions'
import { hydrateTavernLibrary, saveImportSource } from './library'
import type { ImportedStory } from './importers'

export const GEMINI_PROVIDER_ID = 'tavern-gemini'
export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-2.5-flash']
export const DEEPSEEK_MODELS = ['deepseek-v4-pro', 'deepseek-flash']

export async function initializeTavern(): Promise<void> {
  await hydrateTavernLibrary()
  const state = settingsStore.getState()
  const providers = { ...state.providers }
  for (const [id, models, host] of [
    [GEMINI_PROVIDER_ID, GEMINI_MODELS, 'https://www.haerapi.com/v1'],
    [ModelProviderEnum.DeepSeek, DEEPSEEK_MODELS, 'https://api.deepseek.com'],
  ] as const) {
    const existing = providers[id] || {}
    const merged = [...(existing.models || [])]
    for (const modelId of models)
      if (!merged.some((model) => model.modelId === modelId))
        merged.push({ modelId, type: 'chat', contextWindow: 32768, maxOutput: 16384 })
    providers[id] = { ...existing, apiHost: existing.apiHost || host, models: merged }
    if (id === GEMINI_PROVIDER_ID) providers[id].apiPath = existing.apiPath || '/chat/completions'
  }
  const customProviders = [...(state.customProviders || [])]
  if (!customProviders.some((provider) => provider.id === GEMINI_PROVIDER_ID))
    customProviders.push({
      id: GEMINI_PROVIDER_ID,
      name: 'Gemini 中转',
      type: ModelProviderType.OpenAI,
      isCustom: true,
    })
  const defaultModel =
    !state.defaultChatModel || (state.defaultChatModel.provider === ModelProviderEnum.ChatboxAI && !state.licenseKey)
      ? { provider: GEMINI_PROVIDER_ID, model: GEMINI_MODELS[0] }
      : state.defaultChatModel
  settingsStore.setState({
    providers,
    customProviders,
    defaultChatModel: defaultModel,
    language: 'zh-Hans',
    languageInited: true,
    autoUpdate: false,
  })
}

export async function updateTavernSession(sessionId: string, patch: Partial<TavernSession>): Promise<void> {
  await rendererApplication.sessions.updateSession(sessionId, (current) => {
    if (!current) throw new Error('没有找到这段对话。')
    return { ...current, tavern: TavernSessionSchema.parse({ ...(current.tavern || createTavernSession()), ...patch }) }
  })
}

export async function createTavernStory(input: {
  name: string
  mode: 'narrator' | 'character'
  worlds: TavernAsset[]
  characters: TavernAsset[]
  speakingCharacterId?: string
  opening?: string
  replyLength?: number
  style?: string
  greeting?: string
}): Promise<Session> {
  const base = initEmptyChatSession()
  const active = input.characters.find((c) => c.id === input.speakingCharacterId) || input.characters[0]
  const tavern = createTavernSession({
    mode: input.mode,
    worlds: structuredClone(input.worlds),
    characters: structuredClone(input.characters),
    speakingCharacterId: active?.id,
    replyLength: input.replyLength || (input.mode === 'character' ? active?.replyLength : undefined) || 3000,
    ...(input.style !== undefined ? { style: input.style } : {}),
  })
  const messages = [...base.messages]
  if (input.mode === 'character') {
    const greeting = input.greeting ?? active?.greeting
    if (greeting?.trim())
      messages.push(
        createMessage(
          'assistant',
          greeting.replaceAll('{{user}}', tavern.userName).replaceAll('{{char}}', active?.name || '角色')
        )
      )
  }
  const session = await rendererApplication.sessions.createSession({
    ...base,
    name: input.name.trim() || (input.mode === 'character' ? `与${active?.name || '角色'}聊天` : '新的故事'),
    messages,
    tavern,
    settings: {
      ...base.settings,
      maxTokens: 10000,
      agentMode: { value: 'off', locked: true, lockReason: 'message_sent' },
    },
  })
  switchCurrentSession(session.id)
  if (input.opening?.trim())
    void sendTavernInstruction(session.id, input.opening).catch((error) =>
      showToast(error instanceof Error ? error.message : '发送失败，请在对话中重试。')
    )
  return session
}

export async function sendTavernInstruction(sessionId: string, text: string): Promise<void> {
  await submitNewUserMessage(sessionId, { newUserMsg: createMessage('user', text), needGenerating: true })
}

export async function createIndependentStoryBranch(
  sessionId: string,
  messageId: string,
  replacement?: Message,
  name?: string
): Promise<Session> {
  const source = await rendererApplication.sessionQueryBridge.getSession(sessionId)
  if (!source) throw new Error('原对话不存在。')
  const location = findMessageContext(source, messageId)
  if (!location) throw new Error('这条消息已经不存在。')
  if (location.list[location.index]?.generating) throw new Error('这条消息还在生成，完成后再创建支线。')
  const prefix = location.list.slice(0, location.index + 1)
  const ids = new Set(prefix.map((m) => m.id))
  const mapping = new Map(prefix.map((m) => [m.id, uuid()]))
  const messages = prefix.map((m) => {
    const copy = structuredClone(m.id === messageId && replacement ? replacement : m)
    return { ...copy, id: mapping.get(m.id)!, generating: false }
  })
  const memoryIds = new Set(ids)
  if (replacement) memoryIds.delete(messageId)
  const state = source.tavern ? memoryAtBranch(structuredClone(source.tavern), memoryIds) : undefined
  if (state) {
    state.memoryNotes = state.memoryNotes.map((note) => ({
      ...note,
      anchorId: note.anchorId ? mapping.get(note.anchorId) : undefined,
    }))
    state.memoryHistory = state.memoryHistory.map((snapshot) => ({
      ...snapshot,
      anchorId: mapping.get(snapshot.anchorId)!,
    }))
    state.origin = { sessionId, messageId, name: source.name }
  }
  const settings = {
    ...source.settings,
    sessionPromptContextSnapshot: undefined,
    agentMode: { value: 'off' as const, locked: true, lockReason: 'message_sent' as const },
  }
  const branch = await rendererApplication.sessions.createSession(
    {
      name: name?.trim() || `${source.name} · 支线`,
      type: 'chat',
      messages,
      tavern: state,
      settings,
      assistantAvatarKey: source.assistantAvatarKey,
      picUrl: source.picUrl,
      compactionPoints: source.compactionPoints
        ?.filter((point) => ids.has(point.summaryMessageId) && ids.has(point.boundaryMessageId))
        .map((point) => ({
          ...point,
          summaryMessageId: mapping.get(point.summaryMessageId)!,
          boundaryMessageId: mapping.get(point.boundaryMessageId)!,
        })),
    },
    source.id
  )
  switchCurrentSession(branch.id)
  return branch
}

export async function invalidateTavernMemoryAfter(sessionId: string, messageId: string): Promise<void> {
  await rendererApplication.sessions.updateSessionWithMessages(sessionId, (current) => {
    if (!current?.tavern) return current!
    const index = current.messages.findIndex((m) => m.id === messageId)
    if (index < 0) return current
    const prior = new Set(current.messages.slice(0, index).map((m) => m.id))
    return {
      ...current,
      tavern: {
        ...current.tavern,
        memoryHistory: current.tavern.memoryHistory.filter((snapshot) => prior.has(snapshot.anchorId)),
      },
    }
  })
}

export async function restoreImportedStory(story: ImportedStory): Promise<Session[]> {
  const sourceId = await saveImportSource(story.filename, story.format, story.original)
  const sessions: Session[] = []
  for (const route of story.routes) {
    const base = initEmptyChatSession()
    const originalMessages = route.messages.map((m) => ({ ...structuredClone(m), id: uuid() }))
    const hasSystem = originalMessages.some((m) => m.role === 'system')
    const session = await rendererApplication.sessions.createSession({
      ...base,
      name: route.name,
      messages: hasSystem ? originalMessages : [...base.messages, ...originalMessages],
      settings: {
        ...base.settings,
        maxTokens: 10000,
        agentMode: { value: 'off', locked: true, lockReason: 'message_sent' },
      },
      tavern: createTavernSession({ importSource: { name: story.filename, format: story.format, sourceId } }),
    })
    sessions.push(session)
  }
  if (sessions[0]) switchCurrentSession(sessions[0].id)
  return sessions
}

export function exportStoryText(session: Session, fullConversation: boolean): string {
  const header = `${session.name}\n${'='.repeat(24)}\n\n`
  const messages = session.messages.filter(
    (m) => !m.isForkMarker && (fullConversation || m.role === 'assistant') && !m.isSummary
  )
  return (
    header +
    messages
      .map(
        (m) =>
          `${fullConversation ? ({ user: '我的指令', assistant: 'AI正文', system: '故事设定', tool: '工具' }[m.role] || m.role) + '：\n' : ''}${getMessageText(m)}`
      )
      .join('\n\n')
  )
}
