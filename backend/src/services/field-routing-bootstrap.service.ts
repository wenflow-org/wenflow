import type { PrismaClient } from '../generated/system-client';
import {
  ensureGoalFieldRoutings,
  GOAL_FIELD_ROUTING_CONTRACTS,
  GOAL_FIELD_ROUTING_FIELDS,
  GOAL_FIELD_ROUTINGS
} from '../scripts/seed-goal-field-routings';
import {
  ensurePathFieldRoutings,
  PATH_FIELD_ROUTING_CONTRACTS,
  PATH_FIELD_ROUTING_FIELDS,
  PATH_FIELD_ROUTINGS
} from '../scripts/seed-path-field-routings';
import {
  ensureLearningFieldRoutings,
  LEARNING_FIELD_ROUTING_CONTRACTS,
  LEARNING_FIELD_ROUTING_FIELDS,
  LEARNING_FIELD_ROUTINGS
} from '../scripts/seed-execution-field-routings';
import {
  ensureProfileFieldRoutings,
  PROFILE_FIELD_ROUTING_CONTRACTS,
  PROFILE_FIELD_ROUTING_FIELDS,
  PROFILE_FIELD_ROUTINGS
} from '../scripts/seed-learner-field-routings';

const contractGroups = [
  GOAL_FIELD_ROUTING_CONTRACTS,
  PATH_FIELD_ROUTING_CONTRACTS,
  LEARNING_FIELD_ROUTING_CONTRACTS,
  PROFILE_FIELD_ROUTING_CONTRACTS
];
const fieldGroups = [
  GOAL_FIELD_ROUTING_FIELDS,
  PATH_FIELD_ROUTING_FIELDS,
  LEARNING_FIELD_ROUTING_FIELDS,
  PROFILE_FIELD_ROUTING_FIELDS
];
const routingGroups = [
  GOAL_FIELD_ROUTINGS,
  PATH_FIELD_ROUTINGS,
  LEARNING_FIELD_ROUTINGS,
  PROFILE_FIELD_ROUTINGS
];

export const FIELD_ROUTING_SEED_MANIFEST = {
  contractAgentIds: contractGroups.flat().map(item => item.agentId),
  fieldIds: fieldGroups.flat().map(item => item.fieldId),
  routings: routingGroups.flat().map(item => ({ agentId: item.agentId, fieldId: item.fieldId }))
};

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`${label} seed 定义存在重复键`);
}

assertUnique(FIELD_ROUTING_SEED_MANIFEST.contractAgentIds, 'agent_contracts');
assertUnique(FIELD_ROUTING_SEED_MANIFEST.fieldIds, 'field_definitions');
assertUnique(
  FIELD_ROUTING_SEED_MANIFEST.routings.map(item => `${item.agentId}\0${item.fieldId}`),
  'agent_field_routings'
);

export interface FieldRoutingBootstrapDependencies {
  database: PrismaClient;
  ensureGoal?: typeof ensureGoalFieldRoutings;
  ensurePath?: typeof ensurePathFieldRoutings;
  ensureLearning?: typeof ensureLearningFieldRoutings;
  ensureProfile?: typeof ensureProfileFieldRoutings;
}

export async function bootstrapFieldRoutings(dependencies: FieldRoutingBootstrapDependencies) {
  const goal = await (dependencies.ensureGoal || ensureGoalFieldRoutings)(dependencies.database);
  const path = await (dependencies.ensurePath || ensurePathFieldRoutings)(dependencies.database);
  const learning = await (dependencies.ensureLearning || ensureLearningFieldRoutings)(dependencies.database);
  const profile = await (dependencies.ensureProfile || ensureProfileFieldRoutings)(dependencies.database);
  return { goal, path, learning, profile };
}
