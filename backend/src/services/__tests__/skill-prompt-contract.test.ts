import {
  buildDefaultSkillPromptContract,
  lintDeclaredSkillPromptContract,
  normalizeSkillPromptContract,
} from '../skill-prompt-contract'
import { loadAllPromptFiles } from '../../composers/prompt-files/loader'
import { normalizeRuntimeContract } from '../prompt-lab/runtime-contract'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

describe('Skill Prompt Contract v2', () => {
  it('区分 normalization 与 code-only，而不滥用 archetype', () => {
    // 默认推断：无特例的 LLM skill 走 generation/json/json（prompt-compiler 特例已于 2026-08 退役）
    expect(buildDefaultSkillPromptContract({
      skillId: 'stage-designer',
      archetype: 'generator'
    })).toEqual(expect.objectContaining({
      artifactKind: 'generation',
      input: expect.objectContaining({ transport: 'json' }),
      output: expect.objectContaining({ media: 'json' })
    }))

    expect(buildDefaultSkillPromptContract({
      skillId: 'structured-output-parser',
      archetype: 'code-only'
    })).toEqual(expect.objectContaining({
      executionMode: 'code-only',
      interactionMode: 'none',
      output: expect.objectContaining({ media: 'none', envelope: 'none' })
    }))
  })

  it('拒绝 LLM prompt 把完整 Context Envelope 自动暴露给模型', () => {
    const result = lintDeclaredSkillPromptContract({
      version: 'skill-prompt-contract/v2',
      executionMode: 'llm',
      artifactKind: 'extraction',
      interactionMode: 'snapshot',
      input: { transport: 'json', schemaSource: 'skill-definition' },
      output: { media: 'json', schemaSource: 'runtime-validator', envelope: 'adapter' },
      context: { envelope: 'none', delivery: 'none', modelExposure: 'none' },
      failurePolicy: 'best-effort'
    }, {
      skillId: 'dialogue-concept-extractor',
      archetype: 'extractor'
    })

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROMPT_CONTRACT_CONTEXT_POLICY' })
    ]))
  })

  it('所有 File-as-Truth Skill Prompt 都声明合法 v2 契约（v4 编译产物除外）', () => {
    const files = loadAllPromptFiles().filter(file => file.agentId.startsWith('skill:'))
    expect(files.length).toBeGreaterThan(0)

    // v4 编译产物（frontmatter 携带 coreHash）不声明 v2 契约，经核心文件链校验（lint v4 分支 + core:check）
    const v4Files = files.filter(file => file.coreHash)
    expect(v4Files.map(file => file.agentId)).toContain('skill:goal-conversation')
    const v2Files = files.filter(file => !file.coreHash)

    for (const file of v2Files) {
      const runtimeContract = file.runtimeContract === undefined
        ? undefined
        : normalizeRuntimeContract(file.runtimeContract, {
            skillId: file.agentId,
            archetype: file.archetype
          })
      const result = lintDeclaredSkillPromptContract(file.promptContract, {
        skillId: file.agentId,
        archetype: file.archetype,
        runtimeContract
      })
      expect(result.issues.filter(issue => issue.level === 'error')).toEqual([])
    }
  })

  it('fields 归一化：键名排序、非法条目剔除、缺省不声明', () => {
    const normalized = normalizeSkillPromptContract({
      fields: {
        reply: { direction: 'output', visibility: 'user-visible', export: 'renderHints' },
        state: { direction: 'state', visibility: 'handoff', owner: 'runtime' },
        bogus: { direction: 'sideways', visibility: 'internal' },
        junk: 'not-an-object',
      },
    }, { skillId: 'goal-conversation', archetype: 'conversational' })

    expect(Object.keys(normalized.fields!)).toEqual(['reply', 'state'])
    expect(normalized.fields!.quickReplies).toBeUndefined()
    expect(normalized.fields!.reply).toEqual({ direction: 'output', visibility: 'user-visible', export: 'renderHints' })
    expect(normalized.fields!.state).toEqual({ direction: 'state', visibility: 'handoff', owner: 'runtime' })

    const withoutFields = normalizeSkillPromptContract({}, { skillId: 'goal-conversation', archetype: 'conversational' })
    expect(withoutFields.fields).toBeUndefined()
  })

  it('fields lint：轴向误用与 stateOwner 不一致只告警，非法枚举报错', () => {
    const runtimeContract = normalizeRuntimeContract({
      version: 'prompt-runtime-contract/v1',
      contextMode: 'state-refresh',
      businessState: {
        domain: 'goal-conversation',
        phases: ['understanding', 'ready'],
        defaultPhase: 'understanding',
        terminalPhases: ['ready'],
        statusValues: ['succeeded', 'partial', 'blocked', 'failed'],
      },
      contextUpdate: { mode: 'state-refresh', stateOwner: 'runtime' },
      outputEnvelope: 'adapter',
    }, { skillId: 'goal-conversation', archetype: 'conversational' })

    const result = lintDeclaredSkillPromptContract({
      version: 'skill-prompt-contract/v2',
      executionMode: 'llm',
      artifactKind: 'conversation',
      interactionMode: 'turn',
      input: { transport: 'json', schemaSource: 'skill-definition' },
      output: { media: 'json', schemaSource: 'runtime-validator', envelope: 'adapter' },
      context: { envelope: 'context-envelope/v1', delivery: 'sidecar', modelExposure: 'projected' },
      failurePolicy: 'retry',
      fields: {
        state: { direction: 'state', visibility: 'handoff', owner: 'orchestrator' },
        reply: { direction: 'output', visibility: 'user-visible', export: 'renderHints' },
        task: { direction: 'input', visibility: 'internal', owner: 'runtime' },
        bad: { direction: 'sideways', visibility: 'internal' },
      },
    }, { skillId: 'goal-conversation', archetype: 'conversational', runtimeContract })

    const codes = result.issues.map((issue) => `${issue.level}:${issue.code}`)
    expect(codes).toContain('error:INVALID_PROMPT_CONTRACT_FIELD')
    expect(codes).toContain('warning:PROMPT_CONTRACT_FIELD_AXIS_MISUSE')
    expect(codes).toContain('warning:PROMPT_CONTRACT_STATE_OWNER_MISMATCH')
    expect(result.contract.fields!.state.owner).toBe('orchestrator')
  })

  it('试点 skill 的 fields 声明零告警（goal-conversation / teaching-turn）', () => {
    // v4：契约真相源 = 平台层 manifest（runtime 经 ACTIVE metadata → manifest → default 链解析）；
    // goal-conversation 已切换 v4 编译产物，frontmatter 不再携带 promptContract，两者统一从 manifest 对账
    for (const skillId of ['goal-conversation', 'teaching-turn']) {
      const raw = fs.readFileSync(path.join(process.cwd(), '../prompts/manifests', `${skillId}.yaml`), 'utf-8')
      const manifest = yaml.load(raw) as any
      const runtimeContract = manifest.runtimeContract === undefined
        ? undefined
        : normalizeRuntimeContract(manifest.runtimeContract, {
            skillId,
            archetype: manifest.archetype
          })
      const result = lintDeclaredSkillPromptContract(manifest.promptContract, {
        skillId,
        archetype: manifest.archetype,
        runtimeContract
      })
      expect(result.issues).toEqual([])
      expect(Object.keys(result.contract.fields!).length).toBeGreaterThan(0)
    }
  })
})
