import {
  buildDefaultSkillPromptContract,
  lintDeclaredSkillPromptContract,
} from '../skill-prompt-contract'
import { loadAllPromptFiles } from '../../composers/prompt-files/loader'
import { normalizeRuntimeContract } from '../prompt-lab/runtime-contract'

describe('Skill Prompt Contract v2', () => {
  it('区分 normalization、compilation 与 code-only，而不滥用 archetype', () => {
    expect(buildDefaultSkillPromptContract({
      skillId: 'path-scene-framing',
      archetype: 'generator'
    })).toEqual(expect.objectContaining({
      artifactKind: 'normalization',
      input: expect.objectContaining({ transport: 'json' })
    }))

    expect(buildDefaultSkillPromptContract({
      skillId: 'prompt-compiler',
      archetype: 'generator'
    })).toEqual(expect.objectContaining({
      artifactKind: 'compilation',
      input: expect.objectContaining({ transport: 'yaml' }),
      output: expect.objectContaining({ media: 'markdown' })
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

  it('所有 File-as-Truth Skill Prompt 都声明合法 v2 契约', () => {
    const files = loadAllPromptFiles().filter(file => file.agentId.startsWith('skill:'))
    expect(files).toHaveLength(25)

    for (const file of files) {
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
})
