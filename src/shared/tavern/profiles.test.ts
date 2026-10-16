import { describe, expect, it } from 'vitest'
import { ModelProviderType } from '../types/provider'
import { backupProviderSettings, restoreProviderProfiles } from './profiles'

describe('portable model profiles', () => {
  it('omits all credential forms from a backup without keys', () => {
    const source = {
      apiHost: 'https://example.test',
      apiKey: 'private',
      oauth: { accessToken: 'private' },
      accessKey: 'private',
      secretKey: 'private',
      sessionToken: 'private',
    }
    expect(backupProviderSettings(source, false)).toEqual({ apiHost: source.apiHost })
    expect(backupProviderSettings(source, true)).toEqual(source)
    expect(source.apiKey).toBe('private')
  })
  it('keeps working credentials and merges missing model choices', () => {
    const result = restoreProviderProfiles(
      { providers: { deepseek: { apiKey: 'current', models: [{ modelId: 'old' }] } } },
      { deepseek: { apiKey: 'imported', apiHost: 'https://api.deepseek.com', models: [{ modelId: 'new' }] } },
      [],
      new Set(['deepseek'])
    )
    expect(result.providers.deepseek.apiKey).toBe('current')
    expect(result.providers.deepseek.apiHost).toBe('https://api.deepseek.com')
    expect(result.providers.deepseek.models?.map((model) => model.modelId)).toEqual(['old', 'new'])
    expect(result.customProviders).toEqual([])
  })
  it('imports different endpoints as copies so imported conversations retain their model route', () => {
    const definition = { id: 'relay', name: '中转', type: ModelProviderType.OpenAI, isCustom: true as const }
    const current = {
      providers: { relay: { apiHost: 'https://first.test', apiKey: 'first' } },
      customProviders: [definition],
    }
    const result = restoreProviderProfiles(
      current,
      { relay: { apiHost: 'https://second.test', apiKey: 'second' } },
      [definition],
      new Set()
    )
    const copiedId = result.providerIds.get('relay')!
    expect(copiedId).not.toBe('relay')
    expect(result.providers.relay).toEqual(current.providers.relay)
    expect(result.providers[copiedId].apiHost).toBe('https://second.test')
    expect(result.customProviders).toHaveLength(2)
  })
})
