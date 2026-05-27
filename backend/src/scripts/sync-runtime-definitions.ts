import dotenv from 'dotenv';
import prisma from '../config/database';
import { pathAgentRuntimeDefinition } from '../agents/path-agent/definition';
import { goalConversationRuntimeDefinition } from '../agents/goal-conversation-agent/definition';
import { teachingTurnRuntimeDefinition } from '../agents/teaching-turn-agent/definition';
import { peerRuntimeDefinition } from '../agents/peer-agent/definition';
import { sessionWrapupRuntimeDefinition } from '../agents/session-wrapup-agent/definition';
import { learnerModelRuntimeDefinition } from '../agents/learner-model-agent/definition';
import { pathSceneFramingRuntimeDefinition } from '../skills/path-scene-framing/definition';
import { stageDesignerRuntimeDefinition } from '../skills/stage-designer/definition';
import { virtualLearnerScenarioDesignerRuntimeDefinition } from '../skills/virtual-learner-scenario-designer/definition';
import { pathOrchestratorRuntimeDefinition } from '../orchestrators/definition';
import { aiTeachingOrchestratorRuntimeDefinition } from '../orchestrators/ai-teaching.definition';

dotenv.config();

async function main() {
  await prisma.agent_definitions.deleteMany({
    where: {
      id: 'peer-agent',
      managedByCode: true,
    }
  });

  const definitions = [
    pathAgentRuntimeDefinition,
    goalConversationRuntimeDefinition,
    learnerModelRuntimeDefinition,
    teachingTurnRuntimeDefinition,
    peerRuntimeDefinition,
    sessionWrapupRuntimeDefinition,
    pathSceneFramingRuntimeDefinition,
    stageDesignerRuntimeDefinition,
    virtualLearnerScenarioDesignerRuntimeDefinition,
  ];

  const orchestratorDefinitions = [
    pathOrchestratorRuntimeDefinition,
    aiTeachingOrchestratorRuntimeDefinition,
  ];

  for (const definition of definitions) {
    await prisma.agent_definitions.upsert({
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
    await prisma.orchestrator_definitions.upsert({
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
    await prisma.$disconnect();
  });
