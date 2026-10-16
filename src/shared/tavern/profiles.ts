import { v4 as uuid } from 'uuid'
import type { CustomProviderBaseInfo, ProviderSettings } from '../types/settings'
import { ModelProviderType } from '../types/provider'

export type BackupProviderDefinition = {
  id: string
  name: string
  type: ModelProviderType
  isCustom?: boolean
}

export function backupProviderSettings(profile: ProviderSettings, includeKeys: boolean): ProviderSettings {
  const copy = structuredClone(profile)
  if (!includeKeys) {
    delete copy.apiKey
    delete copy.oauth
    delete copy.accessKey
    delete copy.secretKey
    delete copy.sessionToken
  }
  return copy
}

export function restoreProviderProfiles(
  current: { providers?: Record<string, ProviderSettings>; customProviders?: CustomProviderBaseInfo[] },
  imported: Record<string, ProviderSettings>,
  definitions: BackupProviderDefinition[],
  builtinIds: Set<string>
) {
  const providers = structuredClone(current.providers || {})
  const customProviders = structuredClone(current.customProviders || [])
  const providerIds = new Map<string, string>()
  for (const [sourceId, profile] of Object.entries(imported)) {
    const definition = definitions.find((item) => item.id === sourceId)
    const existingDefinition = customProviders.find((item) => item.id === sourceId)
    const existing = providers[sourceId]
    const differentAddress =
      existing &&
      ['apiHost', 'apiPath', 'endpoint', 'deploymentName', 'region'].some((key) => {
        const previous = existing[key as keyof ProviderSettings]
        const incoming = profile[key as keyof ProviderSettings]
        return (
          typeof previous === 'string' &&
          typeof incoming === 'string' &&
          previous.trim() &&
          incoming.trim() &&
          previous.trim().replace(/\/$/, '') !== incoming.trim().replace(/\/$/, '')
        )
      })
    const differentType = definition && existingDefinition && definition.type !== existingDefinition.type
    const conflict = differentAddress || differentType
    const id = conflict ? `tavern-import-${uuid()}` : sourceId
    providerIds.set(sourceId, id)
    if (conflict || (!builtinIds.has(id) && !existingDefinition)) {
      customProviders.push({
        id,
        name: `${definition?.name || sourceId}${conflict ? ' · 导入副本' : ''}`,
        type: definition?.type || existingDefinition?.type || ModelProviderType.OpenAI,
        isCustom: true,
      })
    }
    if (!conflict && existing) {
      const existingValues = Object.fromEntries(
        Object.entries(existing).filter(([, value]) => value !== undefined && value !== '')
      )
      providers[id] = { ...profile, ...existingValues }
      const models = [...(existing.models || [])]
      for (const model of profile.models || [])
        if (!models.some((item) => item.modelId === model.modelId)) models.push(model)
      providers[id].models = models
    } else providers[id] = structuredClone(profile)
  }
  return { providers, customProviders, providerIds }
}
