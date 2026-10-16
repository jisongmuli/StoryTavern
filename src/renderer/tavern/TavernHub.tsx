import NiceModal, { useModal } from '@ebay/nice-modal-react'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  FileButton,
  Group,
  MultiSelect,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { useState, useEffect } from 'react'
import { v4 as uuid } from 'uuid'
import { createMessage, ModelProviderEnum } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { TavernAssetSchema, DEFAULT_STORY_STYLE, type TavernAsset } from '@shared/tavern/types'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { rendererApplication } from '@/app/renderer-application'
import { useTavernLibrary, saveTavernAsset, archiveTavernAsset } from './library'
import { importAssetFile, importStoryFile, type ImportedStory } from './importers'
import {
  createTavernStory,
  updateTavernSession,
  restoreImportedStory,
  GEMINI_PROVIDER_ID,
  GEMINI_MODELS,
  DEEPSEEK_MODELS,
} from './service'
import { runTavernAI } from './ai'
import { exportTavernBackup, importTavernBackup } from './backup'

export const TavernHub = NiceModal.create(
  ({ initialTab = 'new', sessionId }: { initialTab?: string; sessionId?: string }) => {
    const modal = useModal()
    const library = useTavernLibrary((s) => s.library)
    const { session } = rendererApplication.sessionHooks.useSession(sessionId || null)
    const [tab, setTab] = useState<string | null>(initialTab)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [busy, setBusy] = useState(false)
    useEffect(() => {
      if (modal.visible) {
        setTab(initialTab)
        setNotice('')
        setError('')
        setDraft(undefined)
        setOrganized('')
      }
    }, [modal.visible, initialTab, sessionId])
    const [draft, setDraft] = useState<TavernAsset>()
    const [organized, setOrganized] = useState('')
    const [imported, setImported] = useState<ImportedStory>()
    const [routeIndex, setRouteIndex] = useState('0')
    const [page, setPage] = useState(0)
    const [name, setName] = useState('')
    const [mode, setMode] = useState<'narrator' | 'character'>('narrator')
    const [worlds, setWorlds] = useState<string[]>([])
    const [characters, setCharacters] = useState<string[]>([])
    const [length, setLength] = useState<number | string>(3000)
    const [style, setStyle] = useState(DEFAULT_STORY_STYLE)
    const [opening, setOpening] = useState('')
    const [includeKeys, setIncludeKeys] = useState(false)
    const providers = useSettingsStore((s) => s.providers)
    const defaultModel = useSettingsStore((s) => s.defaultChatModel)
    const [geminiKey, setGeminiKey] = useState(providers?.[GEMINI_PROVIDER_ID]?.apiKey || '')
    const [deepseekKey, setDeepseekKey] = useState(providers?.[ModelProviderEnum.DeepSeek]?.apiKey || '')
    const [geminiHost, setGeminiHost] = useState(
      providers?.[GEMINI_PROVIDER_ID]?.apiHost || 'https://www.haerapi.com/v1'
    )
    const [deepseekHost, setDeepseekHost] = useState(
      providers?.[ModelProviderEnum.DeepSeek]?.apiHost || 'https://api.deepseek.com'
    )
    const [model, setModel] = useState(
      `${defaultModel?.provider || GEMINI_PROVIDER_ID}|${defaultModel?.model || GEMINI_MODELS[0]}`
    )
    useEffect(() => {
      if (!modal.visible) return
      if (tab === 'story') {
        setWorlds([])
        setCharacters([])
      }
      if (tab === 'api') {
        const state = settingsStore.getState()
        setGeminiKey(state.providers?.[GEMINI_PROVIDER_ID]?.apiKey || '')
        setDeepseekKey(state.providers?.[ModelProviderEnum.DeepSeek]?.apiKey || '')
        setGeminiHost(state.providers?.[GEMINI_PROVIDER_ID]?.apiHost || 'https://www.haerapi.com/v1')
        setDeepseekHost(state.providers?.[ModelProviderEnum.DeepSeek]?.apiHost || 'https://api.deepseek.com')
        setModel(
          `${state.defaultChatModel?.provider || GEMINI_PROVIDER_ID}|${state.defaultChatModel?.model || GEMINI_MODELS[0]}`
        )
      }
    }, [modal.visible, tab])
    const assets = library.assets.filter((asset) => !asset.archived)
    const options = (kind: 'world' | 'character') =>
      assets.filter((asset) => asset.kind === kind).map((asset) => ({ value: asset.id, label: asset.name }))
    const perform = async (action: () => Promise<void>) => {
      if (busy) return
      setBusy(true)
      setError('')
      setNotice('')
      try {
        await action()
      } catch (e) {
        setError(e instanceof Error ? e.message : '操作失败，请重试。')
      } finally {
        setBusy(false)
      }
    }
    const close = () => {
      if (!busy) {
        modal.hide()
        modal.resolve()
      }
    }
    const newAsset = (kind: 'world' | 'character') => {
      setDraft(
        TavernAssetSchema.parse({
          id: uuid(),
          kind,
          name: kind === 'world' ? '新的世界' : '新的角色',
          text: '',
          updatedAt: Date.now(),
          replyLength: kind === 'character' ? 600 : undefined,
        })
      )
      setOrganized('')
    }
    const route = imported?.routes[Number(routeIndex)]
    const changeMessage = (index: number, patch: object) => {
      if (!imported || !route) return
      setImported({
        ...imported,
        routes: imported.routes.map((r, i) =>
          i !== Number(routeIndex)
            ? r
            : { ...r, messages: r.messages.map((m, j) => (j === index ? { ...m, ...patch } : m)) }
        ),
      })
    }
    const saveKeys = () => {
      const state = settingsStore.getState()
      const [provider, chosen] = model.split('|')
      settingsStore.setState({
        providers: {
          ...state.providers,
          [GEMINI_PROVIDER_ID]: {
            ...state.providers?.[GEMINI_PROVIDER_ID],
            apiKey: geminiKey.trim(),
            apiHost: geminiHost.trim().replace(/\/$/, ''),
          },
          [ModelProviderEnum.DeepSeek]: {
            ...state.providers?.[ModelProviderEnum.DeepSeek],
            apiKey: deepseekKey.trim(),
            apiHost: deepseekHost.trim().replace(/\/$/, ''),
          },
        },
        defaultChatModel: { provider, model: chosen },
      })
    }
    return (
      <AdaptiveModal opened={modal.visible} onClose={close} title="故事工作台" size="xl" centered>
        <Stack gap="md">
          {error && (
            <Alert color="red" title="未完成">
              {error}
            </Alert>
          )}
          {notice && <Alert color="green">{notice}</Alert>}
          <Tabs
            value={tab}
            onChange={(value) => {
              setTab(value)
              setDraft(undefined)
              setOrganized('')
            }}
          >
            <Tabs.List style={{ flexWrap: 'wrap' }}>
              {[
                ['new', '新建故事'],
                ['world', '世界'],
                ['character', '角色'],
                ['import', '接着旧故事'],
                ['backup', '备份'],
                ['api', '接口'],
              ].map(([value, label]) => (
                <Tabs.Tab key={value} value={value} style={{ whiteSpace: 'nowrap' }}>
                  {label}
                </Tabs.Tab>
              ))}
              {session?.tavern && (
                <Tabs.Tab value="story" style={{ whiteSpace: 'nowrap' }}>
                  本故事
                </Tabs.Tab>
              )}
            </Tabs.List>
            <Tabs.Panel value="new" pt="md">
              <Stack>
                <Text c="dimmed" size="sm">
                  选好设定，写下开场，就可以开始。所有设定都支持自然语言。
                </Text>
                <TextInput
                  label="故事名称"
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                  placeholder="例如：夜游神"
                />
                <Select
                  label="AI怎样参与"
                  value={mode}
                  onChange={(v) => {
                    const next = v === 'character' ? 'character' : 'narrator'
                    setMode(next)
                    const role = assets.find((a) => a.id === characters[0])
                    setLength(next === 'character' ? role?.replyLength || 600 : 3000)
                  }}
                  data={[
                    { value: 'narrator', label: '故事叙述者：我给剧情指令，AI写正文' },
                    { value: 'character', label: '角色扮演：AI扮演选中的角色' },
                  ]}
                />
                <MultiSelect
                  label="世界设定（可多选）"
                  data={options('world')}
                  value={worlds}
                  onChange={setWorlds}
                  placeholder="先在“世界”里粘贴或导入设定"
                  searchable
                />
                <MultiSelect
                  label="人物（第一个是主要角色）"
                  data={options('character')}
                  value={characters}
                  onChange={(values) => {
                    setCharacters(values)
                    if (mode === 'character') setLength(assets.find((a) => a.id === values[0])?.replyLength || 600)
                  }}
                  searchable
                />
                <NumberInput
                  label="每次回复约多少字"
                  value={length}
                  onChange={setLength}
                  min={1}
                  max={20000}
                  step={100}
                  description="作为写作目标，实际字数由模型决定。"
                />
                <Textarea
                  label="文风、视角和写作要求"
                  value={style}
                  onChange={(e) => setStyle(e.currentTarget.value)}
                  autosize
                  minRows={3}
                />
                <Textarea
                  label="开场或第一条剧情指令（可稍后再写）"
                  value={opening}
                  onChange={(e) => setOpening(e.currentTarget.value)}
                  autosize
                  minRows={4}
                  placeholder="直接描述故事从哪里开始、发生什么……"
                />
                <Button
                  loading={busy}
                  onClick={() =>
                    perform(async () => {
                      if (mode === 'character' && !characters.length) throw new Error('请先选择一个角色。')
                      await createTavernStory({
                        name,
                        mode,
                        worlds: assets.filter((a) => worlds.includes(a.id)),
                        characters: characters.map((id) => assets.find((a) => a.id === id)!),
                        speakingCharacterId: characters[0],
                        replyLength: Number(length) || 3000,
                        style,
                        opening,
                      })
                      modal.hide()
                    })
                  }
                >
                  开始故事
                </Button>
              </Stack>
            </Tabs.Panel>
            {(['world', 'character'] as const).map((kind) => (
              <Tabs.Panel value={kind} key={kind} pt="md">
                <Stack>
                  {!draft ? (
                    <>
                      <Group>
                        <Button onClick={() => newAsset(kind)}>新建{kind === 'world' ? '世界' : '角色'}</Button>
                        <FileButton
                          accept={kind === 'world' ? '.txt,.md,.json' : '.txt,.md,.json,.png'}
                          onChange={(file) =>
                            file &&
                            perform(async () => {
                              setDraft(await importAssetFile(file, kind))
                              setOrganized('')
                            })
                          }
                        >
                          {(props) => (
                            <Button {...props} variant="light" disabled={busy}>
                              导入{kind === 'world' ? '设定 / 世界书' : '设定 / 角色卡'}
                            </Button>
                          )}
                        </FileButton>
                      </Group>
                      <Text size="sm" c="dimmed">
                        粘贴原文即可使用。修改后只供新故事使用，已有故事保存原设定。
                      </Text>
                      {assets
                        .filter((a) => a.kind === kind)
                        .map((asset) => (
                          <Group key={asset.id} justify="space-between">
                            <Text>
                              {asset.name} <Badge variant="light">版本 {asset.revision}</Badge>
                            </Text>
                            <Button
                              variant="subtle"
                              onClick={() => {
                                setDraft(structuredClone(asset))
                                setOrganized('')
                              }}
                            >
                              编辑
                            </Button>
                          </Group>
                        ))}
                      {!options(kind).length && <Text c="dimmed">还没有设定，点击上方新建。</Text>}
                    </>
                  ) : (
                    <>
                      <TextInput
                        label="名称"
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
                      />
                      <Textarea
                        label={kind === 'world' ? '世界设定：把原文粘贴到这里' : '角色设定：把原文粘贴到这里'}
                        value={draft.text}
                        onChange={(e) => setDraft({ ...draft, text: e.currentTarget.value })}
                        autosize
                        minRows={9}
                        maxRows={20}
                        placeholder="自然语言、Markdown、JSON等格式都可以。"
                      />
                      {kind === 'character' && (
                        <>
                          <NumberInput
                            label="这个角色的默认回复字数"
                            min={1}
                            max={20000}
                            value={draft.replyLength || 600}
                            onChange={(value) => setDraft({ ...draft, replyLength: Number(value) || 600 })}
                          />
                          <Textarea
                            label="开场白（可选）"
                            value={draft.greeting}
                            onChange={(e) => setDraft({ ...draft, greeting: e.currentTarget.value })}
                            autosize
                            minRows={2}
                          />
                          <Textarea
                            label="示例对话（可选）"
                            value={draft.examples}
                            onChange={(e) => setDraft({ ...draft, examples: e.currentTarget.value })}
                            autosize
                            minRows={2}
                          />
                        </>
                      )}
                      {!!draft.entries.length && (
                        <details>
                          <summary>世界书条目（{draft.entries.length}条）</summary>
                          <Stack mt="sm">
                            {draft.entries.map((entry, index) => (
                              <Stack key={entry.id} gap="xs">
                                <TextInput
                                  label="条目名称"
                                  value={entry.name}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      entries: draft.entries.map((x, i) =>
                                        i === index ? { ...x, name: e.currentTarget.value } : x
                                      ),
                                    })
                                  }
                                />
                                <Textarea
                                  label="条目内容"
                                  value={entry.text}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      entries: draft.entries.map((x, i) =>
                                        i === index ? { ...x, text: e.currentTarget.value } : x
                                      ),
                                    })
                                  }
                                  autosize
                                  minRows={3}
                                />
                                <TextInput
                                  label="触发词（逗号分隔）"
                                  value={entry.keys.join(', ')}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      entries: draft.entries.map((x, i) =>
                                        i === index
                                          ? {
                                              ...x,
                                              keys: e.currentTarget.value
                                                .split(/[,，]/)
                                                .map((v) => v.trim())
                                                .filter(Boolean),
                                            }
                                          : x
                                      ),
                                    })
                                  }
                                />
                                <Group>
                                  <Checkbox
                                    label="启用"
                                    checked={entry.enabled}
                                    onChange={(e) =>
                                      setDraft({
                                        ...draft,
                                        entries: draft.entries.map((x, i) =>
                                          i === index ? { ...x, enabled: e.currentTarget.checked } : x
                                        ),
                                      })
                                    }
                                  />
                                  <Checkbox
                                    label="始终生效"
                                    checked={entry.constant}
                                    onChange={(e) =>
                                      setDraft({
                                        ...draft,
                                        entries: draft.entries.map((x, i) =>
                                          i === index ? { ...x, constant: e.currentTarget.checked } : x
                                        ),
                                      })
                                    }
                                  />
                                </Group>
                                <Divider />
                              </Stack>
                            ))}
                          </Stack>
                        </details>
                      )}
                      {draft.creatorNotes && (
                        <Text size="sm" c="dimmed">
                          作者说明：{draft.creatorNotes}
                        </Text>
                      )}
                      <Group>
                        <Button
                          variant="light"
                          loading={busy}
                          onClick={() =>
                            perform(async () => {
                              setOrganized(
                                await runTavernAI(
                                  `整理以下${kind === 'world' ? '世界' : '人物'}设定。保留原有信息、语气和规则，不增添剧情，不改变事实。使用清晰的中文和小标题，只返回设定正文。`,
                                  draft.text
                                )
                              )
                            })
                          }
                        >
                          AI整理（预览后采用）
                        </Button>
                        <Button variant="subtle" onClick={() => setDraft(undefined)}>
                          返回列表
                        </Button>
                      </Group>
                      {organized && (
                        <>
                          <Textarea
                            label="整理结果：确认后才替换原文"
                            value={organized}
                            onChange={(e) => setOrganized(e.currentTarget.value)}
                            autosize
                            minRows={6}
                            maxRows={18}
                          />
                          <Group>
                            <Button
                              variant="light"
                              onClick={() => {
                                setDraft({ ...draft, sourceText: draft.sourceText || draft.text, text: organized })
                                setOrganized('')
                              }}
                            >
                              采用整理结果
                            </Button>
                            <Button variant="subtle" onClick={() => setOrganized('')}>
                              保留原文
                            </Button>
                          </Group>
                        </>
                      )}
                      <Group>
                        <Button
                          loading={busy}
                          onClick={() =>
                            perform(async () => {
                              await saveTavernAsset(draft)
                              setDraft(undefined)
                              setNotice('设定已保存，新故事可以选择使用。')
                            })
                          }
                        >
                          保存设定
                        </Button>
                        {library.assets.some((a) => a.id === draft.id) && (
                          <Button
                            color="gray"
                            variant="subtle"
                            onClick={() =>
                              perform(async () => {
                                await archiveTavernAsset(draft, true)
                                setDraft(undefined)
                              })
                            }
                          >
                            从素材库归档
                          </Button>
                        )}
                      </Group>
                    </>
                  )}
                </Stack>
              </Tabs.Panel>
            ))}
            <Tabs.Panel value="import" pt="md">
              <Stack>
                <Text>导入后会成为真正的对话，可以逐条编辑，并从任意消息另开剧情分支。</Text>
                <FileButton
                  accept=".txt,.html,.htm"
                  onChange={(file) =>
                    file &&
                    perform(async () => {
                      setImported(await importStoryFile(file))
                      setRouteIndex('0')
                      setPage(0)
                    })
                  }
                >
                  {(props) => (
                    <Button {...props} loading={busy}>
                      选择 TXT / HTML
                    </Button>
                  )}
                </FileButton>
                {imported && route && (
                  <>
                    <Alert>
                      {imported.filename}：共 {imported.routes.length} 条路线。全部历史分支都会分别导入。
                      {route.uncertainRoles > 0 && '部分文本没有角色标记，请在预览中校正。'}
                    </Alert>
                    <Select
                      label="预览路线"
                      data={imported.routes.map((r, i) => ({ value: String(i), label: r.name }))}
                      value={routeIndex}
                      onChange={(value) => {
                        setRouteIndex(value || '0')
                        setPage(0)
                      }}
                    />
                    <Text size="sm">
                      共 {route.messages.length} 条消息，第 {page + 1} 页
                    </Text>
                    {route.messages.slice(page * 10, page * 10 + 10).map((message, offset) => {
                      const index = page * 10 + offset
                      return (
                        <Stack key={message.id} gap="xs">
                          <Select
                            label={`消息 ${index + 1}`}
                            data={[
                              { value: 'user', label: '我的指令' },
                              { value: 'assistant', label: 'AI正文' },
                              { value: 'system', label: '故事设定' },
                            ]}
                            value={message.role}
                            onChange={(role) => role && changeMessage(index, { role })}
                          />
                          <Textarea
                            aria-label={`消息 ${index + 1} 内容`}
                            value={getMessageText(message)}
                            autosize
                            minRows={2}
                            maxRows={8}
                            onChange={(e) =>
                              changeMessage(index, { contentParts: [{ type: 'text', text: e.currentTarget.value }] })
                            }
                          />
                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() => {
                              const parts = getMessageText(message)
                                .split(/\n\s*\n/)
                                .filter((v) => v.trim())
                              if (parts.length < 2) {
                                setNotice('可以先在正文中增加空行，再按段落拆分。')
                                return
                              }
                              setImported({
                                ...imported,
                                routes: imported.routes.map((r, i) =>
                                  i === Number(routeIndex)
                                    ? {
                                        ...r,
                                        messages: [
                                          ...r.messages.slice(0, index),
                                          ...parts.map((text) => createMessage(message.role, text)),
                                          ...r.messages.slice(index + 1),
                                        ],
                                      }
                                    : r
                                ),
                              })
                            }}
                          >
                            按空行拆为多条消息
                          </Button>
                          <Divider />
                        </Stack>
                      )
                    })}
                    <Group>
                      <Button variant="light" disabled={!page} onClick={() => setPage(page - 1)}>
                        上一页
                      </Button>
                      <Button
                        variant="light"
                        disabled={(page + 1) * 10 >= route.messages.length}
                        onClick={() => setPage(page + 1)}
                      >
                        下一页
                      </Button>
                    </Group>
                    <Button
                      loading={busy}
                      onClick={() =>
                        perform(async () => {
                          const result = await restoreImportedStory(imported)
                          setNotice(`已恢复 ${result.length} 段独立对话。`)
                          setImported(undefined)
                          modal.hide()
                        })
                      }
                    >
                      确认恢复全部路线
                    </Button>
                  </>
                )}
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="backup" pt="md">
              <Stack>
                <Text>
                  手动备份包括全部对话、剧情分支、故事记忆、世界和角色及原始导入文件。手机和电脑互相导入时，全部保留为副本。
                </Text>
                <Checkbox
                  label="备份里也包含接口密钥（只用于自己的设备）"
                  checked={includeKeys}
                  onChange={(e) => setIncludeKeys(e.currentTarget.checked)}
                />
                <Button
                  loading={busy}
                  onClick={() =>
                    perform(async () => {
                      await exportTavernBackup(includeKeys)
                      setNotice('完整备份已导出。')
                    })
                  }
                >
                  导出完整备份
                </Button>
                <FileButton
                  accept=".json"
                  onChange={(file) =>
                    file &&
                    perform(async () => {
                      const count = await importTavernBackup(file)
                      setNotice(`已新增 ${count} 段对话副本，原有数据保留。`)
                    })
                  }
                >
                  {(props) => (
                    <Button {...props} variant="light" disabled={busy}>
                      导入完整备份
                    </Button>
                  )}
                </FileButton>
                <Text size="sm" c="dimmed">
                  聊天界面的“剧情工具”里也可以导出纯正文和完整对话TXT。
                </Text>
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="api" pt="md">
              <Stack>
                <Text size="sm">
                  密钥只保存在当前设备。选择默认模型后，新故事会使用它；已有对话可以在输入框旁切换模型。
                </Text>
                <TextInput
                  label="Gemini 中转地址"
                  value={geminiHost}
                  onChange={(e) => setGeminiHost(e.currentTarget.value)}
                />
                <PasswordInput
                  label="Gemini 密钥"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.currentTarget.value)}
                />
                <TextInput
                  label="DeepSeek 官方地址"
                  value={deepseekHost}
                  onChange={(e) => setDeepseekHost(e.currentTarget.value)}
                />
                <PasswordInput
                  label="DeepSeek 密钥"
                  value={deepseekKey}
                  onChange={(e) => setDeepseekKey(e.currentTarget.value)}
                />
                <Select
                  label="新故事默认模型"
                  value={model}
                  onChange={(value) => value && setModel(value)}
                  data={[
                    ...GEMINI_MODELS.map((id) => ({
                      value: `${GEMINI_PROVIDER_ID}|${id}`,
                      label: id + (id === 'gemini-3.7-flash' ? '（暂时不可用，保留）' : ''),
                    })),
                    ...DEEPSEEK_MODELS.map((id) => ({ value: `${ModelProviderEnum.DeepSeek}|${id}`, label: id })),
                  ]}
                />
                <Group>
                  <Button
                    onClick={() => {
                      saveKeys()
                      setNotice('接口设置已保存。')
                    }}
                  >
                    保存接口设置
                  </Button>
                  <Button
                    loading={busy}
                    variant="light"
                    onClick={() =>
                      perform(async () => {
                        saveKeys()
                        const answer = await runTavernAI('只回复“连接成功”。', '请检查接口连接。')
                        setNotice(`模型返回：${answer}`)
                      })
                    }
                  >
                    保存并测试连接
                  </Button>
                </Group>
                <FileButton
                  accept=".json"
                  onChange={(file) =>
                    file &&
                    perform(async () => {
                      const data = JSON.parse(await file.text())
                      if (
                        data.format !== 'tavern-owner-config' ||
                        typeof data.geminiKey !== 'string' ||
                        typeof data.deepseekKey !== 'string'
                      )
                        throw new Error('不是本应用的私人接口配置。')
                      setGeminiKey(data.geminiKey)
                      setDeepseekKey(data.deepseekKey)
                      const state = settingsStore.getState()
                      settingsStore.setState({
                        providers: {
                          ...state.providers,
                          [GEMINI_PROVIDER_ID]: { ...state.providers?.[GEMINI_PROVIDER_ID], apiKey: data.geminiKey },
                          [ModelProviderEnum.DeepSeek]: {
                            ...state.providers?.[ModelProviderEnum.DeepSeek],
                            apiKey: data.deepseekKey,
                          },
                        },
                      })
                      setNotice('私人密钥已导入当前设备。')
                    })
                  }
                >
                  {(props) => (
                    <Button {...props} variant="subtle" disabled={busy}>
                      导入自己的接口配置
                    </Button>
                  )}
                </FileButton>
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="story" pt="md">
              <Stack>
                {session?.tavern && (
                  <>
                    <TextInput
                      label="故事名称"
                      defaultValue={session.name}
                      key={session.id}
                      onBlur={(e) => {
                        const name = e.currentTarget.value.trim()
                        if (name)
                          void perform(async () => {
                            await rendererApplication.sessions.updateSession(session.id, { name })
                          })
                      }}
                    />
                    <Text size="sm" c="dimmed">
                      以下设定只属于「{session.name}」。直接修改会影响它接下来的回复。
                    </Text>
                    <Select
                      label="AI模式"
                      value={session.tavern.mode}
                      data={[
                        { value: 'narrator', label: '故事叙述者' },
                        { value: 'character', label: '角色扮演' },
                      ]}
                      onChange={(value) =>
                        value &&
                        perform(async () => {
                          if (value === 'character' && !session.tavern!.characters.length)
                            throw new Error('先为本故事添加人物。')
                          const active =
                            session.tavern!.characters.find((c) => c.id === session.tavern!.speakingCharacterId) ||
                            session.tavern!.characters[0]
                          await updateTavernSession(session.id, {
                            mode: value as 'narrator' | 'character',
                            replyLength: value === 'character' ? active?.replyLength || 600 : 3000,
                            speakingCharacterId: active?.id,
                          })
                        })
                      }
                    />
                    <Select
                      label="扮演哪个角色"
                      value={session.tavern.speakingCharacterId || null}
                      data={session.tavern.characters.map((c) => ({ value: c.id, label: c.name }))}
                      onChange={(value) =>
                        value &&
                        perform(async () => {
                          const c = session.tavern!.characters.find((c) => c.id === value)
                          await updateTavernSession(session.id, {
                            speakingCharacterId: value,
                            replyLength: c?.replyLength || 600,
                          })
                        })
                      }
                    />
                    <NumberInput
                      label="本故事的回复字数目标"
                      min={1}
                      max={20000}
                      value={session.tavern.replyLength}
                      onChange={(value) => {
                        if (Number(value) > 0) void updateTavernSession(session.id, { replyLength: Number(value) })
                      }}
                    />
                    <Textarea
                      label="文风和写作要求"
                      defaultValue={session.tavern.style}
                      autosize
                      minRows={3}
                      onBlur={(e) =>
                        perform(async () => {
                          await updateTavernSession(session.id, { style: e.currentTarget.value })
                        })
                      }
                    />
                    <MultiSelect
                      label="为本故事添加世界（复制当前版本）"
                      data={options('world').filter((o) => !session.tavern!.worlds.some((w) => w.id === o.value))}
                      value={worlds}
                      onChange={setWorlds}
                    />
                    <MultiSelect
                      label="为本故事添加角色（复制当前版本）"
                      data={options('character').filter(
                        (o) => !session.tavern!.characters.some((c) => c.id === o.value)
                      )}
                      value={characters}
                      onChange={setCharacters}
                    />
                    <Button
                      variant="light"
                      loading={busy}
                      onClick={() =>
                        perform(async () => {
                          await updateTavernSession(session.id, {
                            worlds: [
                              ...session.tavern!.worlds,
                              ...structuredClone(assets.filter((a) => worlds.includes(a.id))),
                            ],
                            characters: [
                              ...session.tavern!.characters,
                              ...structuredClone(assets.filter((a) => characters.includes(a.id))),
                            ],
                          })
                          setWorlds([])
                          setCharacters([])
                          setNotice('已添加至本故事。')
                        })
                      }
                    >
                      添加选中设定
                    </Button>
                    {[...session.tavern.worlds, ...session.tavern.characters].map((asset) => (
                      <details key={asset.id}>
                        <summary>
                          {asset.kind === 'world' ? '世界' : '角色'}：{asset.name}（版本 {asset.revision}）
                        </summary>
                        <Textarea
                          label="本故事中的设定"
                          defaultValue={asset.text}
                          autosize
                          minRows={5}
                          onBlur={(e) => {
                            const text = e.currentTarget.value
                            void perform(async () => {
                              const key = asset.kind === 'world' ? 'worlds' : 'characters'
                              await updateTavernSession(session.id, {
                                [key]: session.tavern![key].map((a) => (a.id === asset.id ? { ...a, text } : a)),
                              })
                            })
                          }}
                        />
                      </details>
                    ))}
                  </>
                )}
              </Stack>
            </Tabs.Panel>
          </Tabs>
          <Button variant="subtle" onClick={close} disabled={busy}>
            关闭工作台
          </Button>
        </Stack>
      </AdaptiveModal>
    )
  }
)
export function openTavernHub(initialTab = 'new', sessionId?: string) {
  void NiceModal.show('tavern-hub', { initialTab, sessionId })
}
NiceModal.register('tavern-hub', TavernHub)
