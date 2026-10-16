import { describe, expect, it } from 'vitest'
import {
  characterFromJson,
  characterFromPng,
  importStoryFile,
  decodeTextFile,
  normalizeLoreBook,
  parseChatboxHtml,
  parseTextConversation,
} from './importers'
import { getMessageText } from '@shared/utils/message'
import { createMessage } from '@shared/types'
import { buildTavernPrompt, memoryAtBranch, selectLoreEntries } from '@shared/tavern/prompt'
import { createTavernSession, TavernAssetSchema } from '@shared/tavern/types'

describe('existing story restoration', () => {
  it('preserves the first user instruction in HTML without Chatbox metadata', async () => {
    const file = new File(['<div>USER:前往灯塔</div><div>ASSISTANT:到了海港</div>'], '旧对话.html', {
      type: 'text/html',
    })
    const story = await importStoryFile(file)
    expect(story.routes[0].messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(story.routes[0].messages.map((m) => getMessageText(m))).toEqual(['前往灯塔', '到了海港'])
  })
  it('restores historical fork paths as isolated conversations with shared prefix', () => {
    const fixture = {
      messages: [
        ['s', 'SYSTEM:规则'],
        ['u', 'USER:去灯塔'],
        ['a', 'ASSISTANT:到了灯塔'],
        ['v', 'USER:走进门'],
        ['b', 'ASSISTANT:房中有人'],
        ['old', 'ASSISTANT:沿海返回'],
      ].map(([id, html]) => ({ id, html })),
      threads: [{ name: '海港', messages: ['s', 'u', 'a', 'v', 'b'] }],
      forks: [{ id: 'u', position: 0, lists: [{ messages: [] }, { messages: ['old'] }] }],
    }
    const routes = parseChatboxHtml(
      `<script id="chatbox-export-data" type="application/json">${JSON.stringify(fixture)}</script>`,
      '海港'
    )!
    expect(routes).toHaveLength(2)
    expect(routes[0].messages.map((m) => getMessageText(m))).toEqual([
      '规则',
      '去灯塔',
      '到了灯塔',
      '走进门',
      '房中有人',
    ])
    expect(routes[1].messages.map((m) => getMessageText(m))).toEqual(['规则', '去灯塔', '沿海返回'])
    expect(routes[0].messages[0].id).not.toBe(routes[1].messages[0].id)
    expect(routes[1].messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant'])
  })
  it('reports missing messages instead of silently losing a route', () => {
    expect(() =>
      parseChatboxHtml(
        '<script id="chatbox-export-data">{"messages":[],"threads":[{"messages":["missing"]}]}</script>',
        'a'
      )
    ).toThrow('缺失')
  })
  it('recognizes exported Chinese roles and preserves multiline prose', () => {
    const result = parseTextConversation(
      '故事设定：海港\n我的指令：继续\nAI正文：第一行\n第二行\n\n我的指令：改走山路',
      '测试'
    )
    expect(result.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(getMessageText(result.messages[2])).toBe('第一行\n第二行')
  })
  it('keeps unlabeled prose as editable assistant history and marks uncertainty', () => {
    const result = parseTextConversation('清晨，城门打开了。', '旧故事')
    expect(result.uncertainRoles).toBe(1)
    expect(result.messages[0].role).toBe('assistant')
  })
  it('decodes UTF16 and UTF8 without changing Chinese', () => {
    expect(decodeTextFile(new TextEncoder().encode('夜航'))).toBe('夜航')
    expect(decodeTextFile(Uint8Array.from([255, 254, 0x1c, 0x59, 0x2a, 0x82]))).toBe('夜航')
  })
})

describe('Tavern cards and story continuity', () => {
  it('uses character-only instructions when that character is acting as the AI', () => {
    const card = TavernAssetSchema.parse({
      id: 'c',
      kind: 'character',
      name: '林霁',
      text: '守塔人',
      postHistory: '保持角色身份 {{char}}',
      updatedAt: 1,
    })
    const session = {
      id: 's',
      name: '故事',
      type: 'chat' as const,
      messages: [],
      tavern: createTavernSession({ characters: [card], mode: 'narrator' }),
    }
    expect(buildTavernPrompt(session, []).postHistory).toBe('')
    session.tavern.mode = 'character'
    expect(buildTavernPrompt(session, []).postHistory).toBe('保持角色身份 林霁')
  })
  it('retains card extensions without treating creator notes as instructions', () => {
    const raw = {
      spec: 'chara_card_v2',
      data: {
        name: '守塔人',
        description: '管理灯塔',
        personality: '谨慎',
        first_mes: '你好 {{user}}',
        creator_notes: '不应成为人物规则',
        extensions: { custom: 42 },
        character_book: { entries: [{ keys: ['灯塔'], content: '每晚点灯', enabled: true }] },
      },
    }
    const card = characterFromJson(raw, '角色')
    expect(card.raw).toEqual(raw)
    expect(card.text).toContain('谨慎')
    expect(card.text).not.toContain('不应成为人物规则')
    expect(card.entries).toHaveLength(1)
  })
  it('reads a PNG card UTF8 metadata', async () => {
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ name: '林霁', description: '旅人' }))))
    const bytes = new TextEncoder().encode(`chara\0${payload}`)
    const png = new Uint8Array(8 + 12 + bytes.length + 12)
    png.set([137, 80, 78, 71, 13, 10, 26, 10])
    const v = new DataView(png.buffer)
    v.setUint32(8, bytes.length)
    png.set(new TextEncoder().encode('tEXt'), 12)
    png.set(bytes, 16)
    png.set(new TextEncoder().encode('IEND'), 8 + 12 + bytes.length + 4)
    expect((await characterFromPng(png, '角色.png')).name).toBe('林霁')
  })
  it('applies keyword and constant worldbook entries and preserves raw fields', () => {
    const book = normalizeLoreBook({
      entries: {
        a: { key: ['灯塔'], content: '点灯', disable: false, comment: '照明', extension: 9 },
        b: { key: ['山'], content: '雪山', disable: false },
        c: { content: '世界公理', constant: true, disable: false },
      },
    })
    const asset = TavernAssetSchema.parse({ id: 'w', kind: 'world', name: '海港', text: '', updatedAt: 1, ...book })
    const result = selectLoreEntries(asset, [createMessage('user', '前往灯塔')])
    expect(JSON.stringify(result)).toContain('点灯')
    expect(JSON.stringify(result)).toContain('世界公理')
    expect(JSON.stringify(result)).not.toContain('雪山')
    expect(asset.entries[0].raw).toHaveProperty('extension', 9)
  })
  it('drops future memories when returning to an earlier point', () => {
    const state = createTavernSession({
      memoryNotes: [
        { id: 'old', text: '早先事实', locked: true, anchorId: 'a' },
        { id: 'future', text: '未来事实', locked: true, anchorId: 'b' },
      ],
      memoryHistory: [
        { anchorId: 'a', text: '早先记忆', createdAt: 1 },
        { anchorId: 'b', text: '未来记忆', createdAt: 2 },
      ],
    })
    const branch = memoryAtBranch(state, new Set(['a']))
    expect(branch.memoryNotes.map((n) => n.text)).toEqual(['早先事实'])
    expect(branch.memoryHistory.map((n) => n.text)).toEqual(['早先记忆'])
  })
  it('includes frozen world and character settings in narrative context', () => {
    const world = TavernAssetSchema.parse({ id: 'w', kind: 'world', name: '海港', text: '灯塔每天点亮', updatedAt: 1 })
    const state = createTavernSession({ worlds: [structuredClone(world)], replyLength: 3000 })
    world.text = '外部修改'
    const prompt = buildTavernPrompt({ id: 's', name: '故事', type: 'chat', messages: [], tavern: state }, [
      createMessage('user', '继续'),
    ])
    expect(prompt.system).toContain('灯塔每天点亮')
    expect(prompt.system).not.toContain('外部修改')
    expect(prompt.system).toContain('3000')
  })
})
