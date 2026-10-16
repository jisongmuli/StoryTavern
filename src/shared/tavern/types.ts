import { z } from 'zod'

export const LoreEntrySchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  text: z.string(),
  keys: z.array(z.string()).default([]),
  secondaryKeys: z.array(z.string()).default([]),
  constant: z.boolean().default(false),
  enabled: z.boolean().default(true),
  selective: z.boolean().default(false),
  selectiveLogic: z.number().optional(),
  caseSensitive: z.boolean().default(false),
  wholeWords: z.boolean().default(false),
  scanDepth: z.number().int().min(0).optional(),
  order: z.number().default(100),
  position: z.enum(['before', 'after']).default('after'),
  probability: z.number().min(0).max(100).default(100),
  raw: z.unknown().optional(),
})
export const TavernAssetSchema = z.object({
  id: z.string(),
  kind: z.enum(['world', 'character']),
  name: z.string().min(1),
  text: z.string(),
  sourceText: z.string().optional(),
  revision: z.number().int().min(1).default(1),
  updatedAt: z.number(),
  archived: z.boolean().default(false),
  worldId: z.string().optional(),
  replyLength: z.number().int().min(1).max(20000).optional(),
  greeting: z.string().default(''),
  alternateGreetings: z.array(z.string()).default([]),
  examples: z.string().default(''),
  systemPrompt: z.string().default(''),
  postHistory: z.string().default(''),
  creatorNotes: z.string().default(''),
  avatar: z.string().optional(),
  entries: z.array(LoreEntrySchema).default([]),
  scanDepth: z.number().int().min(0).default(4),
  recursiveScanning: z.boolean().default(false),
  raw: z.unknown().optional(),
})
export const TavernMemoryNoteSchema = z.object({
  id: z.string(),
  text: z.string(),
  locked: z.boolean().default(false),
  anchorId: z.string().optional(),
})
export const TavernMemorySnapshotSchema = z.object({
  anchorId: z.string(),
  text: z.string(),
  createdAt: z.number(),
})
export const TavernSessionSchema = z.object({
  version: z.literal(1).default(1),
  mode: z.enum(['narrator', 'character']).default('narrator'),
  participation: z.enum(['director', 'character']).default('director'),
  userName: z.string().default('我'),
  userPersona: z.string().default(''),
  replyLength: z.number().int().min(1).max(20000).default(3000),
  style: z.string().default('第三人称。自然承接剧情，重视人物对白与行动，避免重复和套路。'),
  view: z.enum(['chat', 'novel']).default('chat'),
  worlds: z.array(TavernAssetSchema).default([]),
  characters: z.array(TavernAssetSchema).default([]),
  speakingCharacterId: z.string().optional(),
  memoryMode: z.enum(['auto', 'manual']).default('auto'),
  memoryNotes: z.array(TavernMemoryNoteSchema).default([]),
  memoryHistory: z.array(TavernMemorySnapshotSchema).default([]),
  origin: z.object({ sessionId: z.string(), messageId: z.string(), name: z.string() }).optional(),
  importSource: z.object({ name: z.string(), format: z.string(), sourceId: z.string().optional() }).optional(),
})
export const TavernLibrarySchema = z.object({
  version: z.literal(1).default(1),
  assets: z.array(TavernAssetSchema).default([]),
  sourceFiles: z
    .array(z.object({ id: z.string(), name: z.string(), format: z.string(), content: z.string() }))
    .default([]),
})
export type LoreEntry = z.infer<typeof LoreEntrySchema>
export type TavernAsset = z.infer<typeof TavernAssetSchema>
export type TavernMemoryNote = z.infer<typeof TavernMemoryNoteSchema>
export type TavernSession = z.infer<typeof TavernSessionSchema>
export type TavernLibrary = z.infer<typeof TavernLibrarySchema>

export const DEFAULT_STORY_STYLE = '第三人称。自然承接剧情，重视人物对白与行动，避免重复和套路。'
export function createTavernSession(patch: Partial<TavernSession> = {}): TavernSession {
  return TavernSessionSchema.parse(patch)
}
