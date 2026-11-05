/**
 * #177 平台默认归一化（File-as-Truth）：平台三档默认指向 llm-providers.json 目录外时，
 * 归一化回目录声明默认；文件 defaults 自身也目录外时退到目录内首个可用模型。
 * 这是「目录外默认不得在运行期生效」的根因防护（启动期 + 目录热重载后都跑本函数）。
 */
export {}

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-normalize-'))
const tempConfig = path.join(tmpDir, 'llm-providers.json')

function writeRegistry(defaults: { chat: string; reasoning: string }): void {
  fs.writeFileSync(
    tempConfig,
    JSON.stringify({
      providers: {
        platform: {
          name: '平台',
          models: {
            'good-chat': { tier: 'chat' },
            'good-reason': { tier: 'reasoning', supportsThinking: true },
          },
        },
      },
      defaults,
    }),
    'utf-8'
  )
}

function prismaStub(record: Record<string, unknown>) {
  const update = jest.fn().mockResolvedValue(undefined)
  return {
    update,
    prisma: {
      platform_api_configs: {
        findUnique: async () => record,
        update,
      },
    },
  }
}

describe('#177 平台默认归一化', () => {
  beforeAll(() => {
    process.env.LLM_PROVIDERS_CONFIG = tempConfig
  })

  afterAll(() => {
    delete process.env.LLM_PROVIDERS_CONFIG
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('平台默认指向目录外 → 归一化回文件声明默认', async () => {
    writeRegistry({ chat: 'good-chat', reasoning: 'good-reason' })
    const { reloadLlmProvidersIfChanged } = await import('../../config/models.config')
    reloadLlmProvidersIfChanged(true)
    const { normalizePlatformModelDefaults } = await import('../seed-skill-model-configs')
    const { prisma, update } = prismaStub({
      defaultModel: 'judge-outside',
      defaultReasoningModel: 'good-reason',
      defaultEvaluationModel: '',
      chatModels: null,
      reasoningModels: null,
      lightModels: null,
    })

    const fixed = await normalizePlatformModelDefaults(prisma)

    expect(fixed).toBe(1)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ defaultModel: 'good-chat' }) })
    )
  })

  it('文件 defaults 自身也目录外 → 归一化目标退到目录内首个模型', async () => {
    writeRegistry({ chat: 'bad-chat', reasoning: 'bad-reason' })
    const { reloadLlmProvidersIfChanged } = await import('../../config/models.config')
    reloadLlmProvidersIfChanged(true)
    const { normalizePlatformModelDefaults } = await import('../seed-skill-model-configs')
    const { prisma, update } = prismaStub({
      defaultModel: 'judge-outside',
      defaultReasoningModel: 'judge-outside',
      defaultEvaluationModel: 'judge-outside',
      chatModels: null,
      reasoningModels: null,
      lightModels: null,
    })

    await normalizePlatformModelDefaults(prisma)

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          defaultModel: 'good-chat',
          defaultReasoningModel: 'good-reason',
          defaultEvaluationModel: 'good-chat',
        }),
      })
    )
  })

  it('默认值本身目录内 → 不改写（不覆盖合法配置）', async () => {
    writeRegistry({ chat: 'good-chat', reasoning: 'good-reason' })
    const { reloadLlmProvidersIfChanged } = await import('../../config/models.config')
    reloadLlmProvidersIfChanged(true)
    const { normalizePlatformModelDefaults } = await import('../seed-skill-model-configs')
    const { prisma, update } = prismaStub({
      defaultModel: 'good-chat',
      defaultReasoningModel: 'good-reason',
      defaultEvaluationModel: 'good-chat',
      chatModels: null,
      reasoningModels: null,
      lightModels: null,
    })

    const fixed = await normalizePlatformModelDefaults(prisma)

    expect(fixed).toBe(0)
    expect(update).not.toHaveBeenCalled()
  })
})
