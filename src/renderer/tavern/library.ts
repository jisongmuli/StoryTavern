import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { TavernAssetSchema, TavernLibrarySchema, type TavernAsset, type TavernLibrary } from '@shared/tavern/types'
import platform from '@/platform'

export const TAVERN_LIBRARY_KEY = 'tavern-library-v1'
let writes: Promise<unknown> = Promise.resolve()
let hydration: Promise<void> | undefined
type State = { library: TavernLibrary; hydrated: boolean }
export const useTavernLibrary = create<State>(() => ({ library: TavernLibrarySchema.parse({}), hydrated: false }))

export async function hydrateTavernLibrary(): Promise<void> {
  if (!hydration)
    hydration = (async () => {
      const raw = await platform.getStoreValue(TAVERN_LIBRARY_KEY)
      const library = TavernLibrarySchema.parse(raw || {})
      useTavernLibrary.setState({ library, hydrated: true })
    })().catch((error) => {
      hydration = undefined
      throw error
    })
  return hydration
}

export function mutateTavernLibrary<T>(
  operation: (library: TavernLibrary) => { library: TavernLibrary; result: T }
): Promise<T> {
  const pending = writes
    .catch(() => undefined)
    .then(async () => {
      await hydrateTavernLibrary()
      const change = operation(structuredClone(useTavernLibrary.getState().library))
      const library = TavernLibrarySchema.parse(change.library)
      await platform.setStoreValue(TAVERN_LIBRARY_KEY, library)
      useTavernLibrary.setState({ library })
      return change.result
    })
  writes = pending
  return pending
}

export async function saveTavernAsset(input: TavernAsset): Promise<TavernAsset> {
  return mutateTavernLibrary((library) => {
    const existing = library.assets.find((asset) => asset.id === input.id)
    const asset = TavernAssetSchema.parse({
      ...input,
      revision: existing ? existing.revision + 1 : input.revision,
      updatedAt: Date.now(),
      sourceText: input.sourceText ?? existing?.sourceText ?? input.text,
    })
    library.assets = [...library.assets.filter((item) => item.id !== asset.id), asset]
    return { library, result: asset }
  })
}

export async function archiveTavernAsset(asset: TavernAsset, archived: boolean): Promise<void> {
  await saveTavernAsset({ ...asset, archived })
}

export async function saveImportSource(name: string, format: string, content: string): Promise<string> {
  return mutateTavernLibrary((library) => {
    const id = uuid()
    library.sourceFiles.push({ id, name, format, content })
    return { library, result: id }
  })
}
