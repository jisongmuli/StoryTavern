import NiceModal from '@ebay/nice-modal-react'
import { Alert, Button, Checkbox, Group, Select, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'
import type { Session } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { createTavernSession } from '@shared/tavern/types'
import { getTavernMemory } from '@shared/tavern/prompt'
import platform from '@/platform'
import Markdown from '@/components/Markdown'
import { openTavernHub } from './TavernHub'
import { updateTavernSession, sendTavernInstruction, createIndependentStoryBranch, exportStoryText } from './service'
import { updateTavernMemory, useTavernAIStatus } from './ai'

export function StoryPanel({ session }: { session: Session }) {
  const state = session.tavern
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [locked, setLocked] = useState(false)
  const [toolText, setToolText] = useState('')
  const [busy, setBusy] = useState(false)
  const status = useTavernAIStatus((s) => s.memory[session.id])
  useEffect(() => {
    setExpanded(false)
    setError('')
    setNote('')
    setLocked(false)
    setToolText('')
  }, [session.id])
  const act = async (operation: () => Promise<unknown>) => {
    setError('')
    setBusy(true)
    try {
      await operation()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  if (!state)
    return (
      <Group px="md" py="xs">
        <Button
          size="xs"
          variant="subtle"
          onClick={() => act(() => updateTavernSession(session.id, createTavernSession()))}
        >
          作为故事继续
        </Button>
        <Button size="xs" variant="subtle" onClick={() => openTavernHub('import')}>
          导入旧故事
        </Button>
      </Group>
    )
  return (
    <Stack gap="xs" px="md" py="xs" style={{ borderBottom: '1px solid var(--chatbox-border-primary)' }}>
      <Group gap="xs" wrap="wrap">
        <Button
          size="xs"
          variant={state.view === 'chat' ? 'light' : 'subtle'}
          onClick={() => act(() => updateTavernSession(session.id, { view: 'chat' }))}
        >
          对话
        </Button>
        <Button
          size="xs"
          variant={state.view === 'novel' ? 'light' : 'subtle'}
          onClick={() => act(() => updateTavernSession(session.id, { view: 'novel' }))}
        >
          阅读
        </Button>
        <Button size="xs" variant="subtle" onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起剧情工具' : '剧情工具与记忆'}
        </Button>
        <Button size="xs" variant="subtle" onClick={() => openTavernHub('story', session.id)}>
          故事设定
        </Button>
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      {expanded && (
        <div style={{ maxHeight: '42vh', overflowY: 'auto' }}>
          <Stack gap="sm">
            {state.origin && (
              <Text size="xs" c="dimmed">
                分支来源：{state.origin.name}
              </Text>
            )}
            <Group>
              <Button
                size="xs"
                variant="light"
                disabled={busy}
                onClick={() =>
                  act(() => sendTavernInstruction(session.id, '继续。自然承接上一段剧情，保持人物性格与故事连续性。'))
                }
              >
                继续故事
              </Button>
              <Button
                size="xs"
                variant="light"
                disabled={busy}
                onClick={() =>
                  act(() =>
                    sendTavernInstruction(
                      session.id,
                      '探索当前地点，描写环境、人物发现和可互动的线索，结合已有剧情自然推进。'
                    )
                  )
                }
              >
                探索
              </Button>
              <Button
                size="xs"
                variant="light"
                disabled={busy}
                onClick={() =>
                  act(() =>
                    sendTavernInstruction(
                      session.id,
                      '在当前剧情中安排一个合理的随机事件。事件须符合世界规则和人物性格，并自然延续正文。'
                    )
                  )
                }
              >
                随机事件
              </Button>
            </Group>
            <TextInput
              label="人物互动 / 自定义玩法指令"
              value={toolText}
              onChange={(e) => setToolText(e.currentTarget.value)}
              placeholder="例如：让沈舟和林霁讨论刚发现的线索"
            />
            <Button
              size="xs"
              variant="light"
              disabled={!toolText.trim() || busy}
              onClick={() =>
                act(async () => {
                  await sendTavernInstruction(session.id, toolText)
                  setToolText('')
                })
              }
            >
              发送玩法指令
            </Button>
            <Select
              label="我的参与方式"
              value={state.participation}
              data={[
                { value: 'director', label: '导演：讲述接下来发生什么' },
                { value: 'character', label: '角色：以人物身份参与' },
              ]}
              onChange={(value) =>
                value &&
                act(() => updateTavernSession(session.id, { participation: value as 'director' | 'character' }))
              }
            />
            {state.participation === 'character' && (
              <>
                {!!state.characters.length && (
                  <Select
                    label="从故事人物中选择我的身份"
                    data={state.characters.map((c) => ({ value: c.id, label: c.name }))}
                    value={null}
                    onChange={(id) => {
                      const character = state.characters.find((c) => c.id === id)
                      if (character)
                        void act(() =>
                          updateTavernSession(session.id, { userName: character.name, userPersona: character.text })
                        )
                    }}
                  />
                )}
                <TextInput
                  label="我扮演的角色名"
                  value={state.userName}
                  onChange={(e) => void updateTavernSession(session.id, { userName: e.currentTarget.value })}
                />
                <Textarea
                  label="我的角色设定"
                  key={`${session.id}-${state.userName}`}
                  defaultValue={state.userPersona}
                  autosize
                  minRows={2}
                  onBlur={(e) => void updateTavernSession(session.id, { userPersona: e.currentTarget.value })}
                />
              </>
            )}
            <Select
              label="故事记忆"
              value={state.memoryMode}
              data={[
                { value: 'auto', label: '自动整理（每6次完整回复，可随时手动整理）' },
                { value: 'manual', label: '只在我点击时整理' },
              ]}
              onChange={(value) =>
                value && act(() => updateTavernSession(session.id, { memoryMode: value as 'auto' | 'manual' }))
              }
            />
            <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
              {getTavernMemory(state, session.messages) || '还没有记忆。人物关系和剧情状态会保存在这里。'}
            </Text>
            {status === 'failed' && <Alert color="yellow">自动整理失败；故事仍已保存，可以手动重试。</Alert>}
            <Button
              size="xs"
              variant="light"
              loading={status === 'working'}
              onClick={() => act(() => updateTavernMemory(session.id, true))}
            >
              现在整理剧情与人物关系
            </Button>
            {state.memoryHistory.length > 0 && (
              <Textarea
                label="编辑当前剧情记忆（失焦保存）"
                key={state.memoryHistory.at(-1)!.anchorId}
                defaultValue={state.memoryHistory.at(-1)!.text}
                autosize
                minRows={3}
                maxRows={10}
                onBlur={(e) => {
                  const text = e.currentTarget.value
                  void act(() =>
                    updateTavernSession(session.id, {
                      memoryHistory: state.memoryHistory.map((m, i) =>
                        i === state.memoryHistory.length - 1 ? { ...m, text } : m
                      ),
                    })
                  )
                }}
              />
            )}
            {state.memoryNotes.map((item) => (
              <Group key={item.id} align="start">
                <Text size="sm" style={{ whiteSpace: 'pre-wrap', flex: 1 }}>
                  {item.locked ? '🔒 ' : ''}
                  {item.text}
                </Text>
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={() =>
                    act(() =>
                      updateTavernSession(session.id, {
                        memoryNotes: state.memoryNotes.filter((n) => n.id !== item.id),
                      })
                    )
                  }
                >
                  移除
                </Button>
              </Group>
            ))}
            <Textarea
              label="手动记录 / 固定事实"
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
              autosize
              minRows={2}
            />
            <Checkbox label="锁定为固定事实" checked={locked} onChange={(e) => setLocked(e.currentTarget.checked)} />
            <Button
              size="xs"
              variant="light"
              disabled={!note.trim() || busy}
              onClick={() =>
                act(async () => {
                  const anchor = session.messages.filter((m) => !m.isSummary && !m.isForkMarker).at(-1)
                  await updateTavernSession(session.id, {
                    memoryNotes: [
                      ...state.memoryNotes,
                      { id: uuid(), text: note.trim(), locked, anchorId: anchor?.id },
                    ],
                  })
                  setNote('')
                })
              }
            >
              保存记录
            </Button>
            <Group>
              <Button
                size="xs"
                variant="subtle"
                onClick={() =>
                  act(() =>
                    platform.exporter.exportTextFile(`${session.name}-正文.txt`, exportStoryText(session, false))
                  )
                }
              >
                导出正文
              </Button>
              <Button
                size="xs"
                variant="subtle"
                onClick={() =>
                  act(() =>
                    platform.exporter.exportTextFile(`${session.name}-完整对话.txt`, exportStoryText(session, true))
                  )
                }
              >
                导出完整对话
              </Button>
            </Group>
          </Stack>
        </div>
      )}
    </Stack>
  )
}

export function NovelReader({ session }: { session: Session }) {
  const bottom = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  useEffect(() => setError(''), [session.id])
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [session.messages.length, session.messages.at(-1)?.contentParts])
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 20px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        {error && <Alert color="red">{error}</Alert>}
        {session.messages
          .filter((m) => !m.isSummary && !m.isForkMarker && m.role !== 'system')
          .map((message, index) => (
            <article key={message.id} style={{ marginBottom: 28 }}>
              {message.role === 'user' ? (
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 13, opacity: 0.65 }}>
                    导演指令 · {getMessageText(message).slice(0, 32)}
                  </summary>
                  <Text mt="sm" style={{ whiteSpace: 'pre-wrap' }}>
                    {getMessageText(message)}
                  </Text>
                </details>
              ) : (
                <div style={{ lineHeight: 1.9, fontSize: 17 }}>
                  <Markdown
                    sessionId={session.id}
                    uniqueId={message.id}
                    generating={message.generating}
                    hiddenCodeActions
                    enableMermaidRendering={false}
                  >
                    {getMessageText(message) || (message.generating ? '正在续写……' : '')}
                  </Markdown>
                </div>
              )}
              {message.error && <Alert color="red">{String(message.error)}</Alert>}
              {!message.generating && (
                <Group mt="xs" gap="xs">
                  <Button
                    size="xs"
                    variant="subtle"
                    onClick={() =>
                      void NiceModal.show('message-edit', {
                        sessionId: session.id,
                        msg: message,
                        hideSaveAndResend: true,
                      })
                    }
                  >
                    编辑
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    onClick={() => {
                      void createIndependentStoryBranch(session.id, message.id).catch((e) => setError(e.message))
                    }}
                  >
                    从这里开分支
                  </Button>
                </Group>
              )}
            </article>
          ))}
        <div ref={bottom} />
      </div>
    </div>
  )
}
