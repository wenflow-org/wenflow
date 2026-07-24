import dotenv from 'dotenv'
dotenv.config()

import prisma from '../src/config/database'
import { virtualLearnerGoalDialogueSimulator } from '../src/skills/virtual-learner-goal-dialogue-simulator'
import { mapSkillOutputEnvelope } from '../src/services/prompt-lab/envelope-adapter'

async function main() {
  const unit = mapSkillOutputEnvelope(
    'virtual-learner-goal-dialogue-simulator',
    { reply: 'hi', learnerState: { phaseFocus: 'understanding' } },
    { phase: 'simulation-step-completed', nextState: { phaseFocus: 'understanding' } }
  )
  console.log(
    'unit-map',
    JSON.stringify({
      phase: unit.businessState.phase,
      mode: unit.contextUpdate.mode,
      domain: unit.businessState.domain
    })
  )

  const skillResult = await virtualLearnerGoalDialogueSimulator({
    learner: {
      profile: {},
      learningGoal: '学 Excel 自动化',
      knownConcepts: [],
      struggleConcepts: [],
      personalityTraits: {}
    },
    story: { title: '周报卡住' },
    visibleContext: { history: [], lastGoalAgentMessage: '你现在卡在哪？' },
    currentPhase: 'understanding',
    previousLearnerState: null,
    frictionBudget: 'normal',
    task: { mode: 'simulate-goal-learner-turn', requirements: [] }
  } as any)

  console.log(
    'skill-probe',
    JSON.stringify({
      success: skillResult.success,
      hasEnvelope: !!skillResult.output?.runtimeEnvelope,
      phase: skillResult.output?.runtimeEnvelope?.businessState?.phase,
      mode: skillResult.output?.runtimeEnvelope?.contextUpdate?.mode,
      domain: skillResult.output?.runtimeEnvelope?.businessState?.domain,
      status: skillResult.output?.runtimeEnvelope?.businessState?.status,
      degraded: skillResult.output?.degraded === true,
      hasReply: !!skillResult.output?.reply,
      hasLearnerState: !!skillResult.output?.learnerState
    })
  )

  try {
    const profiles = await (prisma as any).virtual_learner_profiles.findMany({
      take: 3,
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, learningGoal: true }
    })
    console.log('profiles', JSON.stringify(profiles))
  } catch (error: any) {
    console.log('profiles-error', error?.message || String(error))
  }

  try {
    const sessions = await (prisma as any).virtual_learner_sessions.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, currentPhase: true, profileId: true }
    })
    console.log('sessions', JSON.stringify(sessions))
  } catch (error: any) {
    console.log('sessions-error', error?.message || String(error))
  }
}

main()
  .catch((error) => {
    console.error('probe-failed', error)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await (prisma as any).$disconnect()
    } catch {}
  })
