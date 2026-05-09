import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getGlobalConfig } from '@/lib/global-config'
import { MODEL_CAPABILITIES } from '@/lib/llm/capabilities'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/canvas/config
 * 给画布前端用：返回当前生效的默认模型、模型能力快照、ModelRegistry 列表、
 * v1.3.0 起还包括 ProviderCredential 列表（不含 apiKey）和按用途的默认模型指针。
 *
 * 不返回任何 API Key / endpoint 内容。
 */
export async function GET() {
  const [
    // v1.2.0 keys（向后兼容）
    chatProvider, chatModel,
    imageProvider, imageModel,
    imageEditProvider, imageEditModel,
    storyboardProvider, storyboardModel,
    // v1.3.0 keys（新）
    chatDefaultModelKey,
    canvasImageDefaultModelKey,
    canvasImageEditDefaultModelKey,
    storyboardDefaultModelKey,
    registry,
    credentials,
  ] = await Promise.all([
    getGlobalConfig('chat_provider'),
    getGlobalConfig('chat_model'),
    getGlobalConfig('canvas_image_provider'),
    getGlobalConfig('canvas_image_model'),
    getGlobalConfig('canvas_image_edit_provider'),
    getGlobalConfig('canvas_image_edit_model'),
    getGlobalConfig('storyboard_provider'),
    getGlobalConfig('storyboard_model'),
    getGlobalConfig('chat_default_model_key'),
    getGlobalConfig('canvas_image_default_model_key'),
    getGlobalConfig('canvas_image_edit_default_model_key'),
    getGlobalConfig('storyboard_default_model_key'),
    prisma.modelRegistry.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    }),
    prisma.providerCredential.findMany({
      where: { isActive: true },
      orderBy: [{ provider: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        provider: true,
        name: true,
        isPrimary: true,
        purposes: true,
        modelKeys: true,
        sortOrder: true,
      },
    }),
  ])

  const capabilitiesSnapshot: Record<
    string,
    {
      supportsImageGen: boolean
      supportsImageEdit: boolean
      supportsVision: boolean
      supportsTools: boolean
      supportsStreaming: boolean
      imageSizeStyle?: string
    }
  > = {}
  for (const [model, cap] of Object.entries(MODEL_CAPABILITIES)) {
    capabilitiesSnapshot[model] = {
      supportsImageGen: cap.supportsImageGen,
      supportsImageEdit: cap.supportsImageEdit,
      supportsVision: cap.supportsVision,
      supportsTools: cap.supportsTools,
      supportsStreaming: cap.supportsStreaming,
      imageSizeStyle: cap.imageSizeStyle,
    }
  }

  const grouped: Record<string, Array<{
    key: string
    label: string
    providers: string[]
    capabilities: Record<string, unknown>
    sizes: string[] | null
    qualities: Array<{ label: string; key: string }> | null
    defaultParams: Record<string, string> | null
    tips: string | null
    sortOrder: number
  }>> = { chat: [], canvas_image: [], canvas_image_edit: [], storyboard: [] }

  for (const m of registry) {
    const list = grouped[m.category]
    if (!list) continue
    list.push({
      key: m.modelKey,
      label: m.label,
      providers: Array.isArray(m.providers) ? (m.providers as string[]) : [],
      capabilities: (m.capabilities as Record<string, unknown>) ?? {},
      sizes: (m.sizes as string[] | null) ?? null,
      qualities: (m.qualities as Array<{ label: string; key: string }> | null) ?? null,
      defaultParams: (m.defaultParams as Record<string, string> | null) ?? null,
      tips: m.tips ?? null,
      sortOrder: m.sortOrder,
    })
  }

  return NextResponse.json({
    // v1.2.0 字段，前端继续兼容（部分字段已被 defaults 取代但保留）
    chat: {
      provider: chatProvider ?? 'google',
      defaultModel: chatDefaultModelKey ?? chatModel ?? null,
    },
    image: {
      provider: imageProvider ?? 'google',
      defaultModel: canvasImageDefaultModelKey ?? imageModel ?? null,
    },
    imageEdit: {
      provider: imageEditProvider ?? imageProvider ?? 'google',
      defaultModel:
        canvasImageEditDefaultModelKey ?? imageEditModel ?? imageModel ?? null,
    },
    storyboard: {
      provider: storyboardProvider ?? 'google',
      defaultModel: storyboardDefaultModelKey ?? storyboardModel ?? null,
    },
    capabilities: capabilitiesSnapshot,
    /** ModelRegistry，按 category 分组 */
    models: grouped,
    /** v1.3.0：admin 维护的共享凭据（无 apiKey），用于前端"齿轮选凭据"UI */
    credentials,
    /** v1.3.0：每用途的默认模型 key（取自 GlobalConfig.${purpose}_default_model_key） */
    defaults: {
      chat: { modelKey: chatDefaultModelKey ?? null },
      canvas_image: { modelKey: canvasImageDefaultModelKey ?? null },
      canvas_image_edit: { modelKey: canvasImageEditDefaultModelKey ?? null },
      storyboard: { modelKey: storyboardDefaultModelKey ?? null },
    },
  })
}
