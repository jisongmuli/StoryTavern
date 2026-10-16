import type { Message, Session } from '../types'
import { getMessageText } from '../utils/message'
import type { LoreEntry, TavernAsset, TavernSession } from './types'

export function substituteTavernMacros(text: string, state: TavernSession, characterName?: string, original = '') {
  return text
    .replaceAll('{{original}}', original)
    .replaceAll('{{user}}', state.userName || '我')
    .replaceAll('{{char}}', characterName || (state.mode === 'narrator' ? '故事叙述者' : '角色'))
}

function matchesKey(text: string, key: string, entry: LoreEntry): boolean {
  if (!key.trim()) return false
  const source = entry.caseSensitive ? text : text.toLocaleLowerCase()
  const search = entry.caseSensitive ? key : key.toLocaleLowerCase()
  if (!entry.wholeWords || !/^[a-z0-9_ -]+$/i.test(search)) return source.includes(search)
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9_])${escaped}($|[^a-z0-9_])`, entry.caseSensitive ? '' : 'i').test(source)
}

export function selectLoreEntries(asset: TavernAsset, messages: Message[], seed = ''): LoreEntry[] {
  const chosen = new Set<string>()
  let extra = ''
  const rounds = asset.recursiveScanning ? Math.min(asset.entries.length + 1, 32) : 1
  for (let round = 0; round < rounds; round += 1) {
    let changed = false
    for (const entry of asset.entries) {
      if (!entry.enabled || chosen.has(entry.id)) continue
      const depth = entry.scanDepth ?? asset.scanDepth
      const history = messages.filter((m) => m.role !== 'system')
      const scan = (depth === 0 ? [] : history.slice(-depth)).map((m) => getMessageText(m)).join('\n') + extra
      const primary = entry.keys.some((key) => matchesKey(scan, key, entry))
      const secondary = entry.secondaryKeys.map((key) => matchesKey(scan, key, entry))
      let secondaryMatch = true
      if (entry.selective && secondary.length) {
        switch (entry.selectiveLogic ?? 0) {
          case 1:
            secondaryMatch = !secondary.every(Boolean)
            break
          case 2:
            secondaryMatch = !secondary.some(Boolean)
            break
          case 3:
            secondaryMatch = secondary.every(Boolean)
            break
          default:
            secondaryMatch = secondary.some(Boolean)
        }
      }
      if (!entry.constant && (!primary || !secondaryMatch)) continue
      let hash = 2166136261
      for (const c of seed + entry.id) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619)
      if ((hash >>> 0) % 100 >= entry.probability) continue
      chosen.add(entry.id)
      extra += `\n${entry.text}`
      changed = true
    }
    if (!changed) break
  }
  return asset.entries.filter((entry) => chosen.has(entry.id)).sort((a, b) => a.order - b.order)
}

export function getTavernMemory(state: TavernSession, messages: Message[]): string {
  const ids = new Set(messages.map((m) => m.id))
  const latest = [...state.memoryHistory].reverse().find((snapshot) => ids.has(snapshot.anchorId))
  const notes = state.memoryNotes.filter((note) => !note.anchorId || ids.has(note.anchorId))
  return [latest?.text, ...notes.map((note) => `${note.locked ? '[固定事实] ' : ''}${note.text}`)]
    .filter(Boolean)
    .join('\n')
}

export function buildTavernPrompt(session: Session, messages: Message[]): { system: string; postHistory: string } {
  const state = session.tavern
  if (!state) return { system: '', postHistory: '' }
  const active = state.characters.find((c) => c.id === state.speakingCharacterId) || state.characters[0]
  const original = messages
    .filter((m) => m.role === 'system')
    .map((m) => getMessageText(m))
    .join('\n\n')
  const base =
    state.mode === 'character' && active?.systemPrompt.trim()
      ? substituteTavernMacros(active.systemPrompt, state, active.name, original)
      : original
  const role =
    state.mode === 'narrator'
      ? '你是故事叙述者。用户给出后续剧情简介、人物行动或修正要求，你将其自然展开为小说正文。保持人物性格、知识边界与事件因果一致；承接此前情节，不把设定或用户指令复述成正文。'
      : `你扮演${active?.name || '所选角色'}，依照该角色的经历、性格和说话方式与用户互动。只代表你扮演的角色，不替用户决定对白和行动。`
  const parts = [base, role, `本次回复目标约${state.replyLength}中文字，可自然收尾。`, state.style]
  if (state.participation === 'director')
    parts.push('用户以导演身份给出剧情指令。除非用户要求，不在每段结尾附加行动选项或游戏面板。')
  else parts.push(`用户当前扮演${state.userName}。用户人物资料：\n${state.userPersona}`)
  const assets = [...state.worlds, ...state.characters]
  const lore = assets.flatMap((asset) =>
    selectLoreEntries(asset, messages, messages.at(-1)?.id).map((entry) => ({ asset, entry }))
  )
  for (const { asset, entry } of lore.filter((item) => item.entry.position === 'before')) {
    parts.push(
      `【${asset.name} / ${entry.name || '设定条目'}】\n${substituteTavernMacros(entry.text, state, asset.kind === 'character' ? asset.name : active?.name)}`
    )
  }
  for (const world of state.worlds)
    if (world.text.trim())
      parts.push(`【世界：${world.name}】\n${substituteTavernMacros(world.text, state, active?.name)}`)
  for (const character of state.characters) {
    parts.push(`【人物：${character.name}】\n${substituteTavernMacros(character.text, state, character.name)}`)
    if (character.examples)
      parts.push(`【对白风格参考】\n${substituteTavernMacros(character.examples, state, character.name)}`)
  }
  for (const { asset, entry } of lore.filter((item) => item.entry.position === 'after')) {
    parts.push(
      `【${asset.name} / ${entry.name || '设定条目'}】\n${substituteTavernMacros(entry.text, state, asset.kind === 'character' ? asset.name : active?.name)}`
    )
  }
  const memory = getTavernMemory(state, messages)
  if (memory) parts.push(`【本路线已发生的剧情和人物记忆】\n${memory}`)
  return {
    system: parts.filter(Boolean).join('\n\n'),
    postHistory:
      state.mode === 'character' && active?.postHistory
        ? substituteTavernMacros(active.postHistory, state, active.name)
        : '',
  }
}

export function memoryAtBranch(state: TavernSession, ids: Set<string>): TavernSession {
  return {
    ...state,
    memoryNotes: state.memoryNotes.filter((note) => !note.anchorId || ids.has(note.anchorId)),
    memoryHistory: state.memoryHistory.filter((snapshot) => ids.has(snapshot.anchorId)),
  }
}
