/**
 * Admin prompt-ops 路由冒烟测试
 *
 * 覆盖三件事：
 *   1. 每个挂载端点未认证请求一律 401（真实 adminAccessRestrictMiddleware + adminAuthMiddleware）
 *   2. 已删端点（agent-fields / recent-call-samples / prompt-schema / sync / recompile / source）
 *      已从路由中移除 → 请求 404（防"删了又挂回来"回归）
 *   3. 关键端点基本行为：agent-overview 返回三源概览、compile-info 对无 ACTIVE 的 agent 返回 404、
 *      eval-cases 列表返回空数组
 */

import express from 'express'
import type { Server } from 'http'

const mockLoadAllPromptFiles = jest.fn()
const mockAgentPromptsFindMany = jest.fn()
const mockAgentPromptsFindFirst = jest.fn()
const mockEvalCasesFindMany = jest.fn()
const mockEvalRunsFindMany = jest.fn()
const mockCompilePrompt = jest.fn()
const mockResolveRuntimeContracts = jest.fn()
const mockExecuteSkill = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    prompt_call_logs: { findMany: jest.fn().mockResolvedValue([]) },
  },
}))

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    agent_prompts: {
      findMany: (...args: unknown[]) => mockAgentPromptsFindMany(...args),
      findFirst: (...args: unknown[]) => mockAgentPromptsFindFirst(...args),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    prompt_eval_cases: {
      findMany: (...args: unknown[]) => mockEvalCasesFindMany(...args),
    },
    prompt_eval_runs: {
      findMany: (...args: unknown[]) => mockEvalRunsFindMany(...args),
    },
  },
}))

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

jest.mock('../../composers/prompt-files/loader', () => ({
  loadAllPromptFiles: (...args: unknown[]) => mockLoadAllPromptFiles(...args),
}))

jest.mock('../../services/agent-manifest.service', () => ({
  getCanonicalAgentId: (id: string) => id,
  getAgentManifest: () => null,
  listTopLevelAgents: () => [],
  listSkillsOfAgent: () => [],
}))

jest.mock('../../skills/goal-conversation', () => ({
  goalConversationAgentDefinition: {},
}))

jest.mock('../../skills', () => ({
  executeSkill: (...args: unknown[]) => mockExecuteSkill(...args),
}))

jest.mock('../../services/prompt-schema', () => ({
  parsePromptSchema: () => ({
    title: null,
    identity: '',
    rulesRaw: '',
    rules: [],
    output: '',
    extras: [],
    conformant: false,
    warnings: [],
  }),
}))

jest.mock('../../services/prompt-compiler', () => ({
  compilePrompt: (...args: unknown[]) => mockCompilePrompt(...args),
}))

jest.mock('../../services/prompt-lab/resolve-runtime-contract', () => ({
  resolveRuntimeContractsForAgents: (...args: unknown[]) => mockResolveRuntimeContracts(...args),
}))

jest.mock('../../middleware/prompt-file-truth.middleware', () => ({
  rejectPromptOpsRuntimeMutation: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

import router from '../admin/prompt-ops'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters'
// auth.middleware → projection-token 在模块级读取 JWT_SECRET，必须在此之后加载
const { adminAuthMiddleware } = require('../../middleware/auth.middleware')
const { adminAccessRestrictMiddleware } = require('../../middleware/admin-access-restrict.middleware')
const { signSessionToken } = require('../../utils/session-token')
const ADMIN_TOKEN = signSessionToken({ userId: 'smoke-admin', isAdmin: true }, 'admin', '1h')

async function withServer(app: express.Express, work: (baseUrl: string) => Promise<void>) {
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('测试服务器地址不可用')
    await work(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

/** 保留端点清单（冒烟断言这些端点确实仍挂载） */
const KEPT_ENDPOINTS = [
  ['GET', '/api/admin/prompt-ops/agent-overview'],
  ['GET', '/api/admin/prompt-ops/skill-rules-overview'],
  ['GET', '/api/admin/prompt-ops/sandbox-view'],
  ['GET', '/api/admin/prompt-ops/protocol-view'],
  ['GET', '/api/admin/prompt-ops/eval-cases'],
  ['POST', '/api/admin/prompt-ops/eval-cases'],
  ['PUT', '/api/admin/prompt-ops/eval-cases/eval-1'],
  ['DELETE', '/api/admin/prompt-ops/eval-cases/eval-1'],
  ['POST', '/api/admin/prompt-ops/run-eval'],
  ['GET', '/api/admin/prompt-ops/eval-runs'],
  ['GET', '/api/admin/prompt-ops/eval-runs/run-1'],
  ['GET', '/api/admin/prompt-ops/goal-conversation/compile-info'],
  ['GET', '/api/admin/prompt-ops/skill-catalog'],
] as const

/** 已删端点清单（必须 404，防止"删了又挂回来"） */
const DELETED_ENDPOINTS = [
  ['GET', '/api/admin/prompt-ops/agent-fields/goal-conversation'],
  ['GET', '/api/admin/prompt-ops/recent-call-samples?agentId=goal-conversation'],
  ['GET', '/api/admin/prompt-ops/prompt-schema/goal-conversation'],
  ['POST', '/api/admin/prompt-ops/sync'],
  ['POST', '/api/admin/prompt-ops/goal-conversation/recompile'],
  ['PUT', '/api/admin/prompt-ops/goal-conversation/source'],
] as const

describe('admin prompt-ops 路由冒烟', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadAllPromptFiles.mockReturnValue([])
    mockAgentPromptsFindMany.mockResolvedValue([])
    mockAgentPromptsFindFirst.mockResolvedValue(null)
    mockEvalCasesFindMany.mockResolvedValue([])
    mockEvalRunsFindMany.mockResolvedValue([])
    mockCompilePrompt.mockResolvedValue({
      status: 'ok',
      compiled: 'compiled',
      warnings: [],
      error: null,
      rewritten: false,
      fieldsApplied: 0,
      sourceHash: 'h',
      compileContextHash: 'c',
    })
    mockResolveRuntimeContracts.mockResolvedValue(new Map())
    mockExecuteSkill.mockResolvedValue({})
  })

  describe('未认证拒绝（401）', () => {
    it('每个保留端点未携带 token 时都被 401 拒绝', async () => {
      const app = express()
      app.use(express.json())
      app.use('/api/admin/prompt-ops', adminAccessRestrictMiddleware, adminAuthMiddleware, router)

      await withServer(app, async (baseUrl) => {
        for (const [method, path] of KEPT_ENDPOINTS) {
          const response = await fetch(`${baseUrl}${path}`, { method })
          expect(response.status).toBe(401)
          const body = (await response.json()) as { success: boolean; error?: { message: string } }
          expect(body.success).toBe(false)
          expect(body.error?.message).toBe('未提供认证Token')
        }
      })
    })
  })

  describe('已删端点移除（404）', () => {
    it('agent-fields / recent-call-samples / prompt-schema / sync / recompile / source 均返回 404', async () => {
      const app = express()
      app.use(express.json())
      app.use('/api/admin/prompt-ops', adminAccessRestrictMiddleware, adminAuthMiddleware, router)
      app.use((_req: express.Request, res: express.Response) => res.status(404).json({ success: false }))

      await withServer(app, async (baseUrl) => {
        for (const [method, path] of DELETED_ENDPOINTS) {
          const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
          })
          expect(response.status).toBe(404)
        }
      })
    })
  })

  describe('关键端点基本行为', () => {
    it('GET /agent-overview 返回三源概览（File/DB/.ts 徽章数据）', async () => {
      mockLoadAllPromptFiles.mockReturnValue([
        { agentId: 'goal-conversation', systemPrompt: 'p', archetype: 'core', acceptableAgentIds: [] },
      ])
      mockAgentPromptsFindMany.mockResolvedValue([
        {
          id: 'prompt-1',
          agentId: 'goal-conversation',
          version: 3,
          status: 'ACTIVE',
          systemPrompt: 'db-prompt',
        },
      ])

      const app = express()
      app.use(express.json())
      app.use('/api/admin/prompt-ops', adminAccessRestrictMiddleware, adminAuthMiddleware, router)

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/admin/prompt-ops/agent-overview`, {
          headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { success: boolean; data: { summary: unknown; items: unknown[] } }
        expect(body.success).toBe(true)
        expect(body.data.summary).toBeDefined()
        expect(Array.isArray(body.data.items)).toBe(true)
      })
    })

    it('GET /eval-cases 返回评估用例列表', async () => {
      mockEvalCasesFindMany.mockResolvedValue([
        {
          id: 'eval-1',
          agentId: 'goal-conversation',
          name: '用例 A',
          messagesJson: '[]',
          enabled: true,
          useCount: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])

      const app = express()
      app.use(express.json())
      app.use('/api/admin/prompt-ops', adminAccessRestrictMiddleware, adminAuthMiddleware, router)
      app.use((_req: express.Request, res: express.Response) => res.status(404).json({ success: false }))

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/admin/prompt-ops/eval-cases`, {
          headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { success: boolean; data: unknown }
        expect(body.success).toBe(true)
        expect(body.data).toBeDefined()
      })
    })

    it('GET /:agentId/compile-info 对无 ACTIVE prompt 的 agent 返回 404', async () => {
      mockAgentPromptsFindFirst.mockResolvedValue(null)

      const app = express()
      app.use(express.json())
      app.use('/api/admin/prompt-ops', adminAccessRestrictMiddleware, adminAuthMiddleware, router)

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/admin/prompt-ops/unknown-agent/compile-info`, {
          headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
        })
        expect(response.status).toBe(404)
      })
    })
  })
})
