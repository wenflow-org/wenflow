import { loadPromptFile } from '../../composers/prompt-files/loader'
import { VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT } from '../virtual-learner-persona-designer'
import { VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT } from '../virtual-learner-scenario-designer'
import { VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT } from '../virtual-learner-goal-dialogue-simulator'
import { VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT } from '../virtual-learner-learn-turn-simulator'
import { VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT } from '../virtual-learner-path-evaluator'
import { VIRTUAL_LEARNER_REFEREE_PROMPT } from '../virtual-learner-referee'
import { VIRTUAL_LEARNER_ACTOR_AUDITOR_PROMPT } from '../virtual-learner-actor-auditor'

const SKILL_PROMPT_CASES: Array<[string, string]> = [
  ['virtual-learner-persona-designer', VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT],
  ['virtual-learner-scenario-designer', VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT],
  ['virtual-learner-goal-dialogue-simulator', VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT],
  ['virtual-learner-learn-turn-simulator', VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT],
  ['virtual-learner-path-evaluator', VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT],
  ['virtual-learner-referee', VIRTUAL_LEARNER_REFEREE_PROMPT],
  ['virtual-learner-actor-auditor', VIRTUAL_LEARNER_ACTOR_AUDITOR_PROMPT],
]

describe('virtual-learner skill prompt dual-source consistency', () => {
  it.each(SKILL_PROMPT_CASES)('%s 的 PROMPT 常量 = prompts/skill.<id>.md 编译产物', (skillId, prompt) => {
    const file = loadPromptFile(`skill:${skillId}`)
    expect(file?.systemPrompt).toBeTruthy()
    expect(prompt).toBe(file?.systemPrompt)
    expect(prompt.length).toBeGreaterThan(200)
  })
})
