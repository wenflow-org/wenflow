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
  ensureExecutionFieldRoutings,
  EXECUTION_FIELD_ROUTING_CONTRACTS,
  EXECUTION_FIELD_ROUTING_FIELDS,
  EXECUTION_FIELD_ROUTINGS
} from '../scripts/seed-execution-field-routings';
import {
  ensureLearnerFieldRoutings,
  LEARNER_FIELD_ROUTING_CONTRACTS,
  LEARNER_FIELD_ROUTING_FIELDS,
  LEARNER_FIELD_ROUTINGS
} from '../scripts/seed-learner-field-routings';

const contractGroups = [
  GOAL_FIELD_ROUTING_CONTRACTS,
  PATH_FIELD_ROUTING_CONTRACTS,
  EXECUTION_FIELD_ROUTING_CONTRACTS,
  LEARNER_FIELD_ROUTING_CONTRACTS
];
const fieldGroups = [
  GOAL_FIELD_ROUTING_FIELDS,
  PATH_FIELD_ROUTING_FIELDS,
  EXECUTION_FIELD_ROUTING_FIELDS,
  LEARNER_FIELD_ROUTING_FIELDS
];
const routingGroups = [
  GOAL_FIELD_ROUTINGS,
  PATH_FIELD_ROUTINGS,
  EXECUTION_FIELD_ROUTINGS,
  LEARNER_FIELD_ROUTINGS
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
  ensureExecution?: typeof ensureExecutionFieldRoutings;
  ensureLearner?: typeof ensureLearnerFieldRoutings;
}

export async function bootstrapFieldRoutings(dependencies: FieldRoutingBootstrapDependencies) {
  const goal = await (dependencies.ensureGoal || ensureGoalFieldRoutings)(dependencies.database);
  const path = await (dependencies.ensurePath || ensurePathFieldRoutings)(dependencies.database);
  const execution = await (dependencies.ensureExecution || ensureExecutionFieldRoutings)(dependencies.database);
  const learner = await (dependencies.ensureLearner || ensureLearnerFieldRoutings)(dependencies.database);
  return { goal, path, execution, learner };
}
