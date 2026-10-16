import { parseHTML } from 'linkedom'
import { v4 as uuid } from 'uuid'
import { createMessage, type Message } from '@shared/types'
import { TavernAssetSchema, type TavernAsset, LoreEntrySchema, type LoreEntry } from '@shared/tavern/types'

export type ImportedRoute = { name: string; messages: Message[]; uncertainRoles: number }
export type ImportedStory = { routes: ImportedRoute[]; filename: string; format: string; original: string }
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)
const number = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export function decodeTextFile(bytes: Uint8Array): string {
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('gb18030').decode(bytes)
  }
}

export function htmlToMessage(raw: string, preserveRoleLabel = false): { message: Message; uncertain: boolean } {
  // linkedom does not run scripts or fetch embedded resources.
  const { document } = parseHTML(`<html><body>${raw}</body></html>`)
  document.querySelectorAll('script,style,iframe,object,embed,link,svg').forEach((node) => node.remove())
  document.querySelectorAll('br').forEach((node) => node.replaceWith('\n'))
  document.querySelectorAll('p,div,li,pre,h1,h2,h3,h4,blockquote,tr').forEach((node) => node.append('\n'))
  const value = (document.body.textContent || '').trim().replace(/\n{3,}/g, '\n\n')
  const match = value.match(/^\s*(SYSTEM|USER|ASSISTANT|用户|系统|助手|AI|我|故事叙述者)\s*[:：]\s*/i)
  const label = match?.[1].toLowerCase()
  const role =
    label && ['system', '系统'].includes(label)
      ? 'system'
      : label && ['user', '用户', '我'].includes(label)
        ? 'user'
        : 'assistant'
  return {
    message: createMessage(role, match && !preserveRoleLabel ? value.slice(match[0].length) : value),
    uncertain: !match,
  }
}

export function parseChatboxHtml(source: string, name: string): ImportedRoute[] | null {
  const { document } = parseHTML(source)
  const dataNode = document.getElementById('chatbox-export-data')
  if (!dataNode) return null
  const data = record(JSON.parse(dataNode.textContent || ''))
  if (!Array.isArray(data.messages) || !Array.isArray(data.threads)) throw new Error('这份HTML缺少完整的对话数据。')
  const messages = new Map<string, { message: Message; uncertain: boolean }>()
  for (const value of data.messages) {
    const raw = record(value)
    const id = text(raw.id)
    if (!id || messages.has(id)) throw new Error('对话消息编号缺失或重复，请检查原文件。')
    const parsed = htmlToMessage(text(raw.html))
    parsed.message.isSummary = raw.isSummary === true
    messages.set(id, parsed)
  }
  const forks = new Map<string, { position: number; lists: string[][] }>()
  for (const value of Array.isArray(data.forks) ? data.forks : []) {
    const raw = record(value)
    forks.set(text(raw.id), {
      position: number(raw.position, 0),
      lists: (Array.isArray(raw.lists) ? raw.lists : []).map((list) => strings(record(list).messages)),
    })
  }
  const routes: ImportedRoute[] = []
  const seenPaths = new Set<string>()
  const expand = (ids: string[], resolved: Set<string>, title: string, depth = 0) => {
    if (depth > 128 || routes.length >= 10000)
      throw new Error('这份文件的分支数量过多，请按故事分别导出。原文件没有改动。')
    if (ids.some((id) => !messages.has(id))) throw new Error('HTML引用了缺失的消息，无法完整恢复这条路线。')
    const index = ids.findIndex((id) => forks.has(id) && !resolved.has(id) && (forks.get(id)?.lists.length || 0) > 1)
    if (index >= 0) {
      const anchor = ids[index]
      const fork = forks.get(anchor)!
      const nextResolved = new Set(resolved)
      nextResolved.add(anchor)
      let tail = index + 1
      while (tail < ids.length && messages.get(ids[tail])?.message.isSummary) tail += 1
      const active = Math.max(0, Math.min(fork.position, fork.lists.length - 1))
      // The live thread tail is authoritative; its saved fork slot can be stale.
      const positions = [active, ...fork.lists.map((_, i) => i).filter((i) => i !== active)]
      for (const position of positions) {
        const branch = position === active ? ids.slice(tail) : fork.lists[position]
        expand([...ids.slice(0, tail), ...branch], nextResolved, title, depth + 1)
      }
      return
    }
    const key = ids.join('|')
    if (seenPaths.has(key)) return
    seenPaths.add(key)
    let uncertainRoles = 0
    const routeMessages = ids.map((id) => {
      const entry = messages.get(id)!
      if (entry.uncertain) uncertainRoles += 1
      return { ...structuredClone(entry.message), id: uuid() }
    })
    routes.push({ name: title, messages: routeMessages, uncertainRoles })
  }
  for (const value of data.threads) {
    seenPaths.clear()
    const thread = record(value)
    const base = text(thread.name).trim() || name
    const before = routes.length
    expand(strings(thread.messages), new Set(), base)
    for (let index = before + 1; index < routes.length; index += 1)
      routes[index].name = `${base} · 历史分支 ${index - before}`
  }
  if (!routes.length) throw new Error('没有找到可恢复的对话。')
  return routes
}

export function parseTextConversation(source: string, name: string): ImportedRoute {
  const messages: Message[] = []
  let current: { role: 'user' | 'assistant' | 'system'; lines: string[] } | undefined
  const before: string[] = []
  for (const line of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:\[)?(USER|ASSISTANT|SYSTEM|用户|助手|系统|AI正文|AI|我|我的指令|故事设定|故事叙述者)(?:\])?\s*[:：]\s*(.*)$/i
    )
    if (match) {
      if (current) messages.push(createMessage(current.role, current.lines.join('\n').trim()))
      const label = match[1].toLowerCase()
      current = {
        role: ['system', '系统', '故事设定'].includes(label)
          ? 'system'
          : ['user', '用户', '我', '我的指令'].includes(label)
            ? 'user'
            : 'assistant',
        lines: [match[2]],
      }
    } else if (current) current.lines.push(line)
    else before.push(line)
  }
  if (current) messages.push(createMessage(current.role, current.lines.join('\n').trim()))
  if (!messages.length) return { name, messages: [createMessage('assistant', source.trim())], uncertainRoles: 1 }
  if (before.join('\n').trim()) messages.unshift(createMessage('system', before.join('\n').trim()))
  return {
    name,
    messages: messages.filter((m) => m.contentParts.some((p) => p.type === 'text' && p.text.trim())),
    uncertainRoles: 0,
  }
}

export async function importStoryFile(file: File): Promise<ImportedStory> {
  if (file.size > 100 * 1024 * 1024) throw new Error('请导入100MB以内的文件，较大文件可按故事分批导出。')
  const source = decodeTextFile(new Uint8Array(await file.arrayBuffer()))
  const name = file.name.replace(/\.[^.]+$/, '')
  const html = /\.html?$/i.test(file.name)
  const routes = html ? parseChatboxHtml(source, name) : null
  const plain =
    html && !routes
      ? htmlToMessage(source, true)
          .message.contentParts.filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('\n')
      : source
  return {
    filename: file.name,
    format: html ? 'html' : 'txt',
    original: source,
    routes: routes || [parseTextConversation(plain, name)],
  }
}

export function normalizeLoreBook(raw: unknown): {
  entries: LoreEntry[]
  scanDepth: number
  recursiveScanning: boolean
} {
  const book = record(raw)
  const values = Array.isArray(book.entries) ? book.entries : Object.values(record(book.entries))
  return {
    scanDepth: Math.max(0, number(book.scan_depth ?? book.scanDepth, 4)),
    recursiveScanning: flag(book.recursive_scanning, false),
    entries: values.map((value, index) => {
      const entry = record(value)
      const extension = record(entry.extensions)
      return LoreEntrySchema.parse({
        id: String(entry.id ?? entry.uid ?? index),
        name: text(entry.name ?? entry.comment),
        text: text(entry.content),
        keys: strings(entry.keys ?? entry.key),
        secondaryKeys: strings(entry.secondary_keys ?? entry.keysecondary),
        constant: flag(entry.constant, false),
        enabled: flag(entry.enabled, !flag(entry.disable, false)),
        selective: flag(entry.selective, false),
        selectiveLogic: number(entry.selectiveLogic, 0),
        caseSensitive: flag(entry.case_sensitive ?? entry.caseSensitive ?? extension.case_sensitive, false),
        wholeWords: flag(entry.matchWholeWords, false),
        scanDepth: typeof entry.scanDepth === 'number' ? Math.max(0, entry.scanDepth) : undefined,
        order: number(entry.insertion_order ?? entry.order, 100),
        position: entry.position === 'before_char' || entry.position === 0 ? 'before' : 'after',
        probability: flag(entry.useProbability, false)
          ? Math.max(0, Math.min(100, number(entry.probability, 100)))
          : 100,
        raw: value,
      })
    }),
  }
}

export function characterFromJson(value: unknown, fallbackName: string): TavernAsset {
  const raw = record(value)
  const data = raw.spec ? record(raw.data) : raw
  if (!['name', 'description', 'personality', 'scenario', 'first_mes'].some((key) => typeof data[key] === 'string'))
    throw new Error('这份JSON没有检测到角色卡资料。')
  const sections = [
    ['人物设定', data.description],
    ['性格', data.personality],
    ['场景', data.scenario],
  ]
  const book = normalizeLoreBook(data.character_book)
  return TavernAssetSchema.parse({
    id: uuid(),
    kind: 'character',
    name: text(data.name).trim() || fallbackName,
    text: sections
      .filter(([, body]) => text(body).trim())
      .map(([label, body]) => `【${label}】\n${body}`)
      .join('\n\n'),
    greeting: text(data.first_mes),
    alternateGreetings: strings(data.alternate_greetings),
    examples: text(data.mes_example),
    systemPrompt: text(data.system_prompt),
    postHistory: text(data.post_history_instructions),
    creatorNotes: text(data.creator_notes),
    ...book,
    raw: value,
    updatedAt: Date.now(),
  })
}

function decodeBase64Utf8(value: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\s/g, '')), (c) => c.charCodeAt(0)))
}

export async function characterFromPng(bytes: Uint8Array, filename: string): Promise<TavernAsset> {
  const magic = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!magic.every((v, i) => bytes[i] === v)) throw new Error('这不是有效的PNG角色卡。')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  const metadata = new Map<string, string>()
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = view.getUint32(offset)
    if (length > bytes.length - offset - 12) throw new Error('PNG文件不完整。')
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8))
    const data = bytes.slice(offset + 8, offset + 8 + length)
    if (['tEXt', 'zTXt', 'iTXt'].includes(type)) {
      const end = data.indexOf(0)
      const key = decoder.decode(data.subarray(0, end))
      if (end > 0 && ['chara', 'ccv3'].includes(key)) {
        let content = data.slice(end + 1)
        let compressed = false
        if (type === 'zTXt') {
          compressed = true
          content = content.slice(1)
        }
        if (type === 'iTXt') {
          compressed = content[0] === 1
          content = content.slice(2)
          for (let field = 0; field < 2; field += 1) {
            const zero = content.indexOf(0)
            if (zero < 0) throw new Error('PNG角色资料不完整。')
            content = content.slice(zero + 1)
          }
        }
        if (compressed) {
          const stream = new Blob([content]).stream().pipeThrough(new DecompressionStream('deflate'))
          const reader = stream.getReader()
          const chunks: Uint8Array[] = []
          let total = 0
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            total += chunk.value.length
            if (total > 20 * 1024 * 1024) {
              await reader.cancel()
              throw new Error('PNG角色资料过大。')
            }
            chunks.push(chunk.value)
          }
          content = new Uint8Array(total)
          let offset = 0
          for (const chunk of chunks) {
            content.set(chunk, offset)
            offset += chunk.length
          }
        }
        metadata.set(key, decoder.decode(content))
      }
    }
    offset += length + 12
    if (type === 'IEND') break
  }
  const payload = metadata.get('ccv3') || metadata.get('chara')
  if (!payload) throw new Error('这张PNG只有图片，没有检测到角色卡资料。可以把它作为头像，并粘贴人物设定。')
  const character = characterFromJson(
    JSON.parse(payload.trim().startsWith('{') ? payload : decodeBase64Utf8(payload)),
    filename.replace(/\.png$/i, '')
  )
  const binary = Array.from({ length: Math.ceil(bytes.length / 32768) }, (_, i) =>
    String.fromCharCode(...bytes.subarray(i * 32768, (i + 1) * 32768))
  ).join('')
  character.avatar = `data:image/png;base64,${btoa(binary)}`
  return character
}

export async function importAssetFile(file: File, kind: 'world' | 'character'): Promise<TavernAsset> {
  if (file.size > 20 * 1024 * 1024) throw new Error('请使用20MB以内的设定或角色卡。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const name = file.name.replace(/\.[^.]+$/, '')
  if (kind === 'character' && /\.png$/i.test(file.name)) return characterFromPng(bytes, file.name)
  const source = decodeTextFile(bytes)
  if (/\.json$/i.test(file.name)) {
    const raw = JSON.parse(source)
    if (kind === 'character') {
      const data = record(raw).spec ? record(record(raw).data) : record(raw)
      if (['description', 'personality', 'scenario', 'first_mes'].some((key) => typeof data[key] === 'string'))
        return characterFromJson(raw, name)
      return TavernAssetSchema.parse({
        id: uuid(),
        kind,
        name: text(data.name) || name,
        text: source,
        sourceText: source,
        raw,
        updatedAt: Date.now(),
      })
    }
    const book = normalizeLoreBook(raw)
    return TavernAssetSchema.parse({
      id: uuid(),
      kind,
      name: text(record(raw).name) || name,
      text: book.entries.length ? '' : source,
      ...book,
      raw,
      sourceText: source,
      updatedAt: Date.now(),
    })
  }
  return TavernAssetSchema.parse({ id: uuid(), kind, name, text: source, sourceText: source, updatedAt: Date.now() })
}
