import dotenv from 'dotenv';
import systemPrisma from '../config/system-database';
import { pathAgentRuntimeDefinition } from '../skills/path-planning/definition';
import { goalConversationRuntimeDefinition } from '../skills/goal-conversation/definition';
import { learningTurnRuntimeDefinition } from '../skills/learning-turn/definition';
import { peerRuntimeDefinition } from '../skills/peer-reinforcement/definition';
import { sessionWrapupRuntimeDefinition } from '../skills/session-wrapup/definition';
import { learnerModelRuntimeDefinition } from '../agents/learner-model-agent/definition';
import { pathSceneFramingRuntimeDefinition } from '../skills/path-scene-framing/definition';
import { stageDesignerRuntimeDefinition } from '../skills/stage-designer/definition';
import { virtualLearnerPersonaDesignerRuntimeDefinition } from '../skills/virtual-learner-persona-designer/definition';
import { virtualLearnerScenarioDesignerRuntimeDefinition } from '../skills/virtual-learner-scenario-designer/definition';
import { goalAgentRuntimeDefinition as goalOrchestratorRuntimeDefinition } from '../coordinators/goal.definition';
import { pathAgentRuntimeDefinition as pathOrchestratorRuntimeDefinition } from '../coordinators/path.definition';
import { AITeachingCoordinatorRuntimeDefinition } from '../coordinators/ai-teaching.definition';
import { learnerAgentRuntimeDefinition as learnerOrchestratorRuntimeDefinition } from '../coordinators/learner.definition';
import { simulationAgentRuntimeDefinition as simulationOrchestratorRuntimeDefinition } from '../coordinators/simulation.definition';

dotenv.config();

async function main() {
  await systemPrisma.agent_definitions.deleteMany({
    where: {
      id: 'skill:peer-reinforcement',
      managedByCode: true,
    }
  });

  const definitions = [
    pathAgentRuntimeDefinition,
    goalConversationRuntimeDefinition,
    learnerModelRuntimeDefinition,
    learningTurnRuntimeDefinition,
    peerRuntimeDefinition,
    sessionWrapupRuntimeDefinition,
    pathSceneFramingRuntimeDefinition,
    stageDesignerRuntimeDefinition,
    virtualLearnerPersonaDesignerRuntimeDefinition,
    virtualLearnerScenarioDesignerRuntimeDefinition,
  ];

  const orchestratorDefinitions = [
    goalOrchestratorRuntimeDefinition,
    pathOrchestratorRuntimeDefinition,
    AITeachingCoordinatorRuntimeDefinition,
    learnerOrchestratorRuntimeDefinition,
    simulationOrchestratorRuntimeDefinition,
  ];

  for (const definition of definitions) {
    await systemPrisma.agent_definitions.upsert({
      where: { id: definition.id },
      update: {
        displayName: definition.displayName,
        description: definition.description || null,
        category: definition.category,
        inputSchema: definition.inputSchema ? JSON.stringify(definition.inputSchema) : null,
        outputSchema: definition.outputSchema ? JSON.stringify(definition.outputSchema) : null,
        variableBindings: definition.variableBindings ? JSON.stringify(definition.variableBindings) : null,
        capabilities: definition.capabilities ? JSON.stringify(definition.capabilities) : null,
        defaultMaxTokens: definition.defaultMaxTokens ?? null,
        defaultTemperature: definition.defaultTemperature ?? null,
        source: definition.source || 'code',
        managedByCode: definition.managedByCode ?? true,
        updatedAt: new Date(),
      },
      create: {
        id: definition.id,
        displayName: definition.displayName,
        description: definition.description || null,
        category: definition.category,
        inputSchema: definition.inputSchema ? JSON.stringify(definition.inputSchema) : null,
        outputSchema: definition.outputSchema ? JSON.stringify(definition.outputSchema) : null,
        variableBindings: definition.variableBindings ? JSON.stringify(definition.variableBindings) : null,
        capabilities: definition.capabilities ? JSON.stringify(definition.capabilities) : null,
        defaultMaxTokens: definition.defaultMaxTokens ?? null,
        defaultTemperature: definition.defaultTemperature ?? null,
        source: definition.source || 'code',
        managedByCode: definition.managedByCode ?? true,
      }
    });
  }

  for (const orchestrator of orchestratorDefinitions) {
    await systemPrisma.orchestrator_definitions.upsert({
      where: { id: orchestrator.id },
      update: {
        displayName: orchestrator.displayName,
        description: orchestrator.description || null,
        category: orchestrator.category,
        steps: JSON.stringify(orchestrator.steps),
        variableGraph: orchestrator.variableGraph ? JSON.stringify(orchestrator.variableGraph) : null,
        source: orchestrator.source || 'code',
        managedByCode: orchestrator.managedByCode ?? true,
        updatedAt: new Date(),
      },
      create: {
        id: orchestrator.id,
        displayName: orchestrator.displayName,
        description: orchestrator.description || null,
        category: orchestrator.category,
        steps: JSON.stringify(orchestrator.steps),
        variableGraph: orchestrator.variableGraph ? JSON.stringify(orchestrator.variableGraph) : null,
        source: orchestrator.source || 'code',
        managedByCode: orchestrator.managedByCode ?? true,
      }
    });
  }

  console.log(JSON.stringify({ success: true, definitionCount: definitions.length, orchestratorCount: orchestratorDefinitions.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await systemPrisma.$disconnect();
  });

