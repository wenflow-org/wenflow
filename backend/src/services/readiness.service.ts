import { decryptSecret } from '../utils/secret-crypto';
import { FIELD_ROUTING_SEED_MANIFEST } from './field-routing-bootstrap.service';

export interface ReadinessResult {
  ready: boolean;
  checks: {
    mainDatabase: 'ok' | 'failed';
    systemDatabase: 'ok' | 'failed';
    corePrompts: 'ok' | 'failed';
    aiConfiguration: 'ok' | 'failed';
    fieldRouting: 'ok' | 'failed';
    gatewayRegistry: 'ok' | 'failed';
  };
}

interface MainDatabase {
  users: { findFirst(args: any): Promise<unknown> };
  learning_paths: { findFirst(args: any): Promise<unknown> };
  domain_event_outbox: { findFirst(args: any): Promise<unknown> };
}

interface SystemDatabase {
  platform_api_configs: { findFirst(args: any): Promise<any> };
  agent_prompts: { findMany(args: any): Promise<Array<{ agentId: string }>> };
  agent_contracts: { count(args: any): Promise<number> };
  field_definitions: { count(args: any): Promise<number> };
  agent_field_routings: { count(args: any): Promise<number> };
  agent_registrations: { count(): Promise<number> };
  skill_registrations: { count(): Promise<number> };
}

const CRITICAL_PROMPT_IDS = [
  'skill:goal-conversation',
  'skill:path-planning',
  'skill:stage-designer',
  'skill:learning-turn',
  'skill:session-wrapup'
] as const;

export class ReadinessService {
  constructor(
    private readonly mainDatabase: MainDatabase,
    private readonly systemDatabase: SystemDatabase,
    private readonly timeoutMs = 2000,
    private readonly isDraining: () => boolean = () => false
  ) {}

  async check(): Promise<ReadinessResult> {
    const checks: ReadinessResult['checks'] = {
      mainDatabase: 'failed',
      systemDatabase: 'failed',
      corePrompts: 'failed',
      aiConfiguration: 'failed',
      fieldRouting: 'failed',
      gatewayRegistry: 'failed'
    };

    if (this.isDraining()) return { ready: false, checks };

    await this.withTimeout(Promise.all([
      this.checkMainDatabase(checks),
      this.checkSystemDatabase(checks)
    ])).catch(() => undefined);

    return {
      ready: Object.values(checks).every(value => value === 'ok'),
      checks
    };
  }

  private async checkMainDatabase(checks: ReadinessResult['checks']) {
    try {
      await Promise.all([
        this.mainDatabase.users.findFirst({ select: { id: true } }),
        this.mainDatabase.learning_paths.findFirst({ select: { id: true } }),
        this.mainDatabase.domain_event_outbox.findFirst({ select: { id: true } })
      ]);
      checks.mainDatabase = 'ok';
    } catch {
      checks.mainDatabase = 'failed';
    }
  }

  private async checkSystemDatabase(checks: ReadinessResult['checks']) {
    try {
      const [activePrompts, contractCount, fieldCount, routingCount, agentCount, skillCount, platformConfig] = await Promise.all([
        this.systemDatabase.agent_prompts.findMany({
          where: {
            agentId: { in: [...CRITICAL_PROMPT_IDS] },
            status: 'ACTIVE'
          },
          select: { agentId: true }
        }),
        this.systemDatabase.agent_contracts.count({
          where: { agentId: { in: FIELD_ROUTING_SEED_MANIFEST.contractAgentIds } }
        }),
        this.systemDatabase.field_definitions.count({
          where: { fieldId: { in: FIELD_ROUTING_SEED_MANIFEST.fieldIds } }
        }),
        this.systemDatabase.agent_field_routings.count({
          where: { OR: FIELD_ROUTING_SEED_MANIFEST.routings }
        }),
        this.systemDatabase.agent_registrations.count(),
        this.systemDatabase.skill_registrations.count(),
        this.systemDatabase.platform_api_configs.findFirst({
          where: { id: 'platform' },
          select: { apiUrl: true, apiKey: true, defaultModel: true }
        })
      ]);
      checks.systemDatabase = 'ok';
      const activePromptIds = new Set(activePrompts.map(prompt => prompt.agentId));
      checks.corePrompts = CRITICAL_PROMPT_IDS.every(agentId => activePromptIds.has(agentId)) ? 'ok' : 'failed';
      checks.aiConfiguration = this.hasValidAIConfiguration(platformConfig) ? 'ok' : 'failed';
      checks.fieldRouting = contractCount === FIELD_ROUTING_SEED_MANIFEST.contractAgentIds.length
        && fieldCount === FIELD_ROUTING_SEED_MANIFEST.fieldIds.length
        && routingCount === FIELD_ROUTING_SEED_MANIFEST.routings.length
        ? 'ok' : 'failed';
      checks.gatewayRegistry = agentCount > 0 && skillCount > 0 ? 'ok' : 'failed';
    } catch {
      checks.systemDatabase = 'failed';
    }
  }

  private hasValidAIConfiguration(config: any): boolean {
    const endpoint = String(config?.apiUrl || process.env.AI_API_URL || '').trim();
    let apiKey = '';
    try {
      apiKey = String(
        decryptSecret(config?.apiKey, 'system.platform_api_configs.apiKey')
        || process.env.AI_API_KEY
        || ''
      ).trim();
    } catch {
      return false;
    }
    const model = String(config?.defaultModel || process.env.AI_MODEL || '').trim();
    if (!endpoint || !apiKey || !model) return false;

    try {
      const url = new URL(endpoint);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error('readiness timeout')), this.timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
