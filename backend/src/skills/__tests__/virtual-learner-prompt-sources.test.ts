import { loadPromptFile } from '../../composers/prompt-files/loader'
import { VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT } from '../simulation-persona-designer'
import { VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT } from '../simulation-scenario-designer'
import { VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT } from '../simulation-goal-dialogue'
import { VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT } from '../simulation-learn-turn'
import { VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT } from '../simulation-path-evaluate'
import { VIRTUAL_LEARNER_REFEREE_PROMPT } from '../simulation-referee'
import { VIRTUAL_LEARNER_ACTOR_AUDITOR_PROMPT } from '../simulation-actor-audit'

const SKILL_PROMPT_CASES: Array<[string, string]> = [
  ['simulation-persona-designer', VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT],
  ['simulation-scenario-designer', VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT],
  ['simulation-goal-dialogue', VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT],
  ['simulation-learn-turn', VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT],
  ['simulation-path-evaluate', VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT],
  ['simulation-referee', VIRTUAL_LEARNER_REFEREE_PROMPT],
  ['simulation-actor-audit', VIRTUAL_LEARNER_ACTOR_AUDITOR_PROMPT],
]

describe('virtual-learner skill prompt dual-source consistency', () => {
  it.each(SKILL_PROMPT_CASES)('%s 的 PROMPT 常量 = prompts/skill.<id>.md 编译产物', (skillId, prompt) => {
    const file = loadPromptFile(`skill:${skillId}`)
    expect(file?.systemPrompt).toBeTruthy()
    expect(prompt).toBe(file?.systemPrompt)
    expect(prompt.length).toBeGreaterThan(200)
  })
})

describe('goal 模拟器离场语义（2026-11-11 告别死循环）', () => {
  it('编译产物带 shouldEnd 字段与离场/不复读规则', () => {
    const prompt = VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT
    expect(prompt).toContain('shouldEnd')
    expect(prompt).toContain('像真人一样会离场')
    expect(prompt).toContain('不会站在门口再答一轮')
    expect(prompt).toContain('不要每轮都写小作文')
  })
})
