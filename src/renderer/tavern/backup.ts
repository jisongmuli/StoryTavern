import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import { SessionSchema } from '@shared/types/session'
import { TavernLibrarySchema } from '@shared/tavern/types'
import { copyStoryMessages } from '@shared/tavern/copy'
import { backupProviderSettings, restoreProviderProfiles } from '@shared/tavern/profiles'
import { ModelProviderType } from '@shared/types/provider'
import { ProviderSettingsSchema } from '@shared/types/settings'
import { getSystemProviders } from '@shared/providers'
import { rendererApplication } from '@/app/renderer-application'
import platform from '@/platform'
import { settingsStore } from '@/stores/settingsStore'
import { collectSessionResourceReferences, restoreSessionResourceKeys } from '@/packages/backup/resources'
import { hydrateTavernLibrary, useTavernLibrary, mutateTavernLibrary } from './library'

export const TavernBackupSchema = z.object({
  format: z.literal('chatbox-tavern'),
  version: z.literal(1),
  exportedAt: z.string(),
  library: TavernLibrarySchema,
  sessions: z.array(SessionSchema),
  blobs: z.record(z.string(), z.string()),
  providers: z.record(z.string(), ProviderSettingsSchema),
  providerDefinitions: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.nativeEnum(ModelProviderType),
        isCustom: z.boolean().optional(),
      })
    )
    .default([]),
})

export async function exportTavernBackup(includeKeys: boolean): Promise<void> {
  await hydrateTavernLibrary()
  const metas = await platform.getSessionMetaStorage().getAllIncludingHidden()
  const sessions = []
  const blobs: Record<string, string> = {}
  for (const meta of metas) {
    const session = await rendererApplication.sessionQueryBridge.getSession(meta.id)
    if (!session) throw new Error(`无法读取「${meta.name}」，请修复后再备份，以免遗漏。`)
    sessions.push(session)
    for (const resource of collectSessionResourceReferences(session).references) {
      if (blobs[resource.storageKey] !== undefined) continue
      const value = await platform.getStoreBlob(resource.storageKey)
      if (value === null) throw new Error(`「${session.name}」的附件缺失，完整备份已停止。`)
      blobs[resource.storageKey] = value
    }
  }
  const state = settingsStore.getState()
  const providers = Object.fromEntries(
    Object.entries(state.providers || {}).map(([id, provider]) => [id, backupProviderSettings(provider, includeKeys)])
  )
  const backup = TavernBackupSchema.parse({
    format: 'chatbox-tavern',
    version: 1,
    exportedAt: new Date().toISOString(),
    library: useTavernLibrary.getState().library,
    sessions,
    blobs,
    providers,
    providerDefinitions: [...getSystemProviders(), ...(state.customProviders || [])].map(
      ({ id, name, type, isCustom }) => ({ id, name, type, isCustom })
    ),
  })
  await platform.exporter.exportTextFile(
    `酒馆完整备份-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(backup)
  )
}

export async function importTavernBackup(file: File): Promise<number> {
  if (file.size > 512 * 1024 * 1024) throw new Error('备份超过512MB，请分开导入。')
  // Validate every session and asset before writing anything. Import only adds copies.
  const backup = TavernBackupSchema.parse(JSON.parse(await file.text()))
  for (const items of [backup.sessions, backup.library.assets, backup.library.sourceFiles])
    if (new Set(items.map((item) => item.id)).size !== items.length)
      throw new Error('备份中有重复编号，请重新从原设备导出。尚未导入任何数据。')
  const resourceMap = new Map<string, string>()
  for (const key of Object.keys(backup.blobs)) resourceMap.set(key, `tavern-import-${uuid()}`)
  const sourceMap = new Map(backup.library.sourceFiles.map((source) => [source.id, uuid()]))
  const assetMap = new Map(backup.library.assets.map((asset) => [asset.id, uuid()]))
  const restoredProviders = restoreProviderProfiles(
    settingsStore.getState(),
    backup.providers,
    backup.providerDefinitions,
    new Set(getSystemProviders().map((provider) => provider.id))
  )
  for (const [key, value] of Object.entries(backup.blobs)) await platform.setStoreBlob(resourceMap.get(key)!, value)
  await mutateTavernLibrary((library) => {
    library.sourceFiles.push(
      ...backup.library.sourceFiles.map((source) => ({ ...source, id: sourceMap.get(source.id)! }))
    )
    library.assets.push(
      ...backup.library.assets.map((asset) => ({
        ...asset,
        id: assetMap.get(asset.id)!,
        name: `${asset.name} · 导入副本`,
        worldId: asset.worldId ? assetMap.get(asset.worldId) : undefined,
      }))
    )
    return { library, result: undefined }
  })
  const created = new Map<string, string>()
  const copies = new Map(backup.sessions.map((source) => [source.id, copyStoryMessages(source)]))
  for (const source of backup.sessions) {
    const session = restoreSessionResourceKeys(copies.get(source.id)!.session, resourceMap)
    if (session.tavern?.importSource?.sourceId)
      session.tavern.importSource.sourceId = sourceMap.get(session.tavern.importSource.sourceId)
    if (session.tavern) {
      for (const asset of [...session.tavern.worlds, ...session.tavern.characters]) {
        asset.id = assetMap.get(asset.id) || asset.id
        if (asset.worldId) asset.worldId = assetMap.get(asset.worldId) || asset.worldId
      }
      if (session.tavern.speakingCharacterId)
        session.tavern.speakingCharacterId =
          assetMap.get(session.tavern.speakingCharacterId) || session.tavern.speakingCharacterId
    }
    if (session.settings?.provider)
      session.settings.provider =
        restoredProviders.providerIds.get(session.settings.provider) || session.settings.provider
    const { id, ...payload } = session
    const copy = await rendererApplication.sessions.createSession({
      ...payload,
      name: `${session.name} · 导入副本`,
      hidden: false,
      archivedAt: undefined,
    })
    created.set(id, copy.id)
  }
  for (const old of backup.sessions) {
    if (old.tavern?.origin && created.has(old.tavern.origin.sessionId))
      await rendererApplication.sessions.updateSession(created.get(old.id)!, (current) => ({
        ...current!,
        tavern: {
          ...current!.tavern!,
          origin: {
            ...old.tavern!.origin!,
            sessionId: created.get(old.tavern!.origin!.sessionId)!,
            messageId:
              copies.get(old.tavern!.origin!.sessionId)!.messageIds.get(old.tavern!.origin!.messageId) ||
              old.tavern!.origin!.messageId,
          },
        },
      }))
  }
  settingsStore.setState({ providers: restoredProviders.providers, customProviders: restoredProviders.customProviders })
  return created.size
}
