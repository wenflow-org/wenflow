
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  Serializable: 'Serializable'
});

exports.Prisma.Agent_lab_configsScalarFieldEnum = {
  id: 'id',
  agentName: 'agentName',
  model: 'model',
  temperature: 'temperature',
  maxTokens: 'maxTokens',
  baseURL: 'baseURL',
  apiKey: 'apiKey',
  systemPrompt: 'systemPrompt',
  extraConfig: 'extraConfig',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.Agent_model_configsScalarFieldEnum = {
  id: 'id',
  agentId: 'agentId',
  tier: 'tier',
  model: 'model',
  endpoint: 'endpoint',
  apiKey: 'apiKey',
  temperature: 'temperature',
  maxTokens: 'maxTokens',
  priority: 'priority',
  enabled: 'enabled',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  reasoningEffort: 'reasoningEffort',
  thinkingMode: 'thinkingMode'
};

exports.Prisma.Agent_promptsScalarFieldEnum = {
  id: 'id',
  agentId: 'agentId',
  version: 'version',
  name: 'name',
  description: 'description',
  systemPrompt: 'systemPrompt',
  temperature: 'temperature',
  maxTokens: 'maxTokens',
  model: 'model',
  status: 'status',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  metadata: 'metadata',
  useCount: 'useCount',
  avgLatency: 'avgLatency',
  successRate: 'successRate',
  publishedAt: 'publishedAt'
};

exports.Prisma.Agent_definitionsScalarFieldEnum = {
  id: 'id',
  displayName: 'displayName',
  description: 'description',
  category: 'category',
  inputSchema: 'inputSchema',
  outputSchema: 'outputSchema',
  variableBindings: 'variableBindings',
  capabilities: 'capabilities',
  defaultMaxTokens: 'defaultMaxTokens',
  defaultTemperature: 'defaultTemperature',
  schemaVersion: 'schemaVersion',
  source: 'source',
  managedByCode: 'managedByCode',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.Orchestrator_definitionsScalarFieldEnum = {
  id: 'id',
  displayName: 'displayName',
  description: 'description',
  category: 'category',
  steps: 'steps',
  variableGraph: 'variableGraph',
  source: 'source',
  managedByCode: 'managedByCode',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.Agent_registrationsScalarFieldEnum = {
  id: 'id',
  name: 'name',
  type: 'type',
  category: 'category',
  description: 'description',
  version: 'version',
  config: 'config',
  inputSchema: 'inputSchema',
  outputSchema: 'outputSchema',
  capabilities: 'capabilities',
  subscribes: 'subscribes',
  publishes: 'publishes',
  callCount: 'callCount',
  successRate: 'successRate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  endpoint: 'endpoint'
};

exports.Prisma.Platform_api_configsScalarFieldEnum = {
  id: 'id',
  apiUrl: 'apiUrl',
  apiKey: 'apiKey',
  availableModels: 'availableModels',
  defaultModel: 'defaultModel',
  defaultReasoningModel: 'defaultReasoningModel',
  defaultEvaluationModel: 'defaultEvaluationModel',
  connectionStatus: 'connectionStatus',
  lastCheckedAt: 'lastCheckedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  defaultTemperature: 'defaultTemperature',
  defaultMaxTokens: 'defaultMaxTokens',
  reasoningEndpoint: 'reasoningEndpoint',
  lightEndpoint: 'lightEndpoint',
  chatModels: 'chatModels',
  reasoningModels: 'reasoningModels',
  lightModels: 'lightModels'
};

exports.Prisma.Skill_model_configsScalarFieldEnum = {
  id: 'id',
  skillId: 'skillId',
  tier: 'tier',
  model: 'model',
  thinkingMode: 'thinkingMode',
  reasoningEffort: 'reasoningEffort',
  endpoint: 'endpoint',
  apiKey: 'apiKey',
  temperature: 'temperature',
  maxTokens: 'maxTokens',
  requestTimeoutMs: 'requestTimeoutMs',
  enabled: 'enabled',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.Skill_registrationsScalarFieldEnum = {
  id: 'id',
  name: 'name',
  version: 'version',
  category: 'category',
  description: 'description',
  inputSchema: 'inputSchema',
  outputSchema: 'outputSchema',
  endpoint: 'endpoint',
  callCount: 'callCount',
  successRate: 'successRate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.Field_definitionsScalarFieldEnum = {
  id: 'id',
  fieldId: 'fieldId',
  stage: 'stage',
  promptRole: 'promptRole',
  valueType: 'valueType',
  snakeName: 'snakeName',
  camelName: 'camelName',
  description: 'description',
  enumValues: 'enumValues',
  schemaVersion: 'schemaVersion',
  source: 'source',
  managedByCode: 'managedByCode',
  systemLocked: 'systemLocked',
  structureLocked: 'structureLocked',
  bindings: 'bindings',
  metadata: 'metadata',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.Agent_contractsScalarFieldEnum = {
  id: 'id',
  agentId: 'agentId',
  stage: 'stage',
  displayName: 'displayName',
  description: 'description',
  schemaVersion: 'schemaVersion',
  source: 'source',
  managedByCode: 'managedByCode',
  metadata: 'metadata',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.Agent_field_routingsScalarFieldEnum = {
  id: 'id',
  agentId: 'agentId',
  fieldId: 'fieldId',
  render: 'render',
  handoff: 'handoff',
  internalFlag: 'internalFlag',
  accumulate: 'accumulate',
  visibilityPreset: 'visibilityPreset',
  ordering: 'ordering',
  notes: 'notes',
  source: 'source',
  managedByCode: 'managedByCode',
  systemLocked: 'systemLocked',
  structureLocked: 'structureLocked',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.Node_config_changesScalarFieldEnum = {
  id: 'id',
  changeType: 'changeType',
  targetTable: 'targetTable',
  targetId: 'targetId',
  agentId: 'agentId',
  fieldId: 'fieldId',
  before: 'before',
  after: 'after',
  actorId: 'actorId',
  actorRole: 'actorRole',
  reason: 'reason',
  createdAt: 'createdAt'
};

exports.Prisma.Prompt_eval_casesScalarFieldEnum = {
  id: 'id',
  agentId: 'agentId',
  caseId: 'caseId',
  name: 'name',
  description: 'description',
  messagesJson: 'messagesJson',
  previousStateJson: 'previousStateJson',
  expectationsJson: 'expectationsJson',
  enabled: 'enabled',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.Prompt_eval_runsScalarFieldEnum = {
  id: 'id',
  agentId: 'agentId',
  promptVersionId: 'promptVersionId',
  promptVersion: 'promptVersion',
  promptSource: 'promptSource',
  mode: 'mode',
  caseCount: 'caseCount',
  totalRuns: 'totalRuns',
  summaryJson: 'summaryJson',
  resultsJson: 'resultsJson',
  durationMs: 'durationMs',
  triggeredBy: 'triggeredBy',
  createdAt: 'createdAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};


exports.Prisma.ModelName = {
  agent_lab_configs: 'agent_lab_configs',
  agent_model_configs: 'agent_model_configs',
  agent_prompts: 'agent_prompts',
  agent_definitions: 'agent_definitions',
  orchestrator_definitions: 'orchestrator_definitions',
  agent_registrations: 'agent_registrations',
  platform_api_configs: 'platform_api_configs',
  skill_model_configs: 'skill_model_configs',
  skill_registrations: 'skill_registrations',
  field_definitions: 'field_definitions',
  agent_contracts: 'agent_contracts',
  agent_field_routings: 'agent_field_routings',
  node_config_changes: 'node_config_changes',
  prompt_eval_cases: 'prompt_eval_cases',
  prompt_eval_runs: 'prompt_eval_runs'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
