export interface ReadinessResult {
  ready: boolean;
  checks: {
    mainDatabase: 'ok' | 'failed';
    systemDatabase: 'ok' | 'failed';
    corePrompts: 'ok' | 'failed';
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
  platform_api_configs: { findFirst(args: any): Promise<unknown> };
  agent_prompts: { findFirst(args: any): Promise<unknown> };
  agent_contracts: { count(args: any): Promise<number> };
  field_definitions: { count(args: any): Promise<number> };
  agent_field_routings: { count(args: any): Promise<number> };
  agent_registrations: { count(): Promise<number> };
  skill_registrations: { count(): Promise<number> };
}

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
      const [activePrompt, contractCount, fieldCount, routingCount, agentCount, skillCount] = await Promise.all([
        this.systemDatabase.agent_prompts.findFirst({
          where: { status: 'ACTIVE' },
          select: { id: true }
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
        this.systemDatabase.platform_api_configs.findFirst({ select: { id: true } })
      ]);
      checks.systemDatabase = 'ok';
      checks.corePrompts = activePrompt ? 'ok' : 'failed';
      checks.fieldRouting = contractCount === FIELD_ROUTING_SEED_MANIFEST.contractAgentIds.length
        && fieldCount === FIELD_ROUTING_SEED_MANIFEST.fieldIds.length
        && routingCount === FIELD_ROUTING_SEED_MANIFEST.routings.length
        ? 'ok' : 'failed';
      checks.gatewayRegistry = agentCount > 0 && skillCount > 0 ? 'ok' : 'failed';
    } catch {
      checks.systemDatabase = 'failed';
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
import { FIELD_ROUTING_SEED_MANIFEST } from './field-routing-bootstrap.service';
