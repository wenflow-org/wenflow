export type RuntimeContextMode =
  | 'state-refresh'
  | 'thread-context'
  | 'snapshot-context'
  | 'simulation-refresh';

export type RuntimeContextUpdateMode =
  | 'none'
  | 'state-refresh'
  | 'thread-state'
  | 'simulation-refresh';

export type RuntimeStateOwner = 'runtime' | 'model' | 'orchestrator' | 'none';
export type RuntimeOutputEnvelope = 'adapter' | 'model';
export type RuntimeBusinessStatus = 'succeeded' | 'partial' | 'blocked' | 'failed';

export interface RuntimeContract {
  version: 'prompt-runtime-contract/v1';
  contextMode: RuntimeContextMode;
  businessState: {
    domain: string;
    phases: string[];
    defaultPhase: string;
    terminalPhases: string[];
    statusValues: RuntimeBusinessStatus[];
  };
  contextUpdate: {
    mode: RuntimeContextUpdateMode;
    stateOwner: RuntimeStateOwner;
    description?: string;
  };
  /**
   * adapter: LLM 按旧业务 JSON 输出，runtime adapter 包装为统一 envelope。
   * model: LLM 直接输出 artifact/businessState/contextUpdate envelope。
   */
  outputEnvelope: RuntimeOutputEnvelope;
}

const CONTEXT_MODES: RuntimeContextMode[] = [
  'state-refresh',
  'thread-context',
  'snapshot-context',
  'simulation-refresh',
];

const CONTEXT_UPDATE_MODES: RuntimeContextUpdateMode[] = [
  'none',
  'state-refresh',
  'thread-state',
  'simulation-refresh',
];

const STATE_OWNERS: RuntimeStateOwner[] = ['runtime', 'model', 'orchestrator', 'none'];
const OUTPUT_ENVELOPES: RuntimeOutputEnvelope[] = ['adapter', 'model'];
const STATUS_VALUES: RuntimeBusinessStatus[] = ['succeeded', 'partial', 'blocked', 'failed'];

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const next = value
    .map((item) => asString(item, ''))
    .filter(Boolean);
  return next.length > 0 ? Array.from(new Set(next)) : fallback;
}

function pickOne<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function inferContextMode(skillId: string, archetype: string): RuntimeContextMode {
  if (skillId === 'goal-conversation') return 'state-refresh';
  if (['teaching-turn', 'peer-reinforcement', 'session-wrapup'].includes(skillId)) return 'thread-context';
  if (/^virtual-learner-(goal-dialogue|learn-turn|path-evaluator)/.test(skillId)) return 'simulation-refresh';
  if (archetype === 'conversational') return 'thread-context';
  return 'snapshot-context';
}

function inferContextUpdate(mode: RuntimeContextMode): RuntimeContextUpdateMode {
  if (mode === 'state-refresh') return 'state-refresh';
  if (mode === 'thread-context') return 'thread-state';
  if (mode === 'simulation-refresh') return 'simulation-refresh';
  return 'none';
}

function inferStateOwner(mode: RuntimeContextMode): RuntimeStateOwner {
  if (mode === 'state-refresh') return 'runtime';
  if (mode === 'thread-context') return 'orchestrator';
  if (mode === 'simulation-refresh') return 'orchestrator';
  return 'none';
}

function inferDomain(skillId: string): string {
  if (skillId === 'goal-conversation') return 'goal-conversation';
  if (['teaching-turn', 'peer-reinforcement', 'session-wrapup'].includes(skillId)) return 'teaching';
  if (['path-scene-framing', 'path-planning', 'stage-designer'].includes(skillId)) return 'path-generation';
  if (skillId.startsWith('virtual-learner-')) return 'virtual-learner';
  if (skillId.includes('knowledge') || skillId.includes('pattern') || skillId.includes('profile') || skillId.includes('concept')) return 'learner-model';
  if (skillId.includes('guidance')) return 'guidance';
  if (skillId.includes('label')) return 'labeling';
  return skillId;
}

function inferPhases(skillId: string, domain: string): { phases: string[]; defaultPhase: string; terminalPhases: string[] } {
  if (skillId === 'goal-conversation') {
    return {
      phases: ['understanding', 'proposing', 'ready', 'completed'],
      defaultPhase: 'understanding',
      terminalPhases: ['ready', 'completed'],
    };
  }
  if (skillId === 'teaching-turn') {
    return {
      phases: ['turn-generated', 'checkpoint-pending', 'completion-candidate', 'turn-blocked'],
      defaultPhase: 'turn-generated',
      terminalPhases: ['completion-candidate'],
    };
  }
  if (skillId === 'peer-reinforcement') {
    return {
      phases: ['discussion-generated', 'discussion-completed'],
      defaultPhase: 'discussion-generated',
      terminalPhases: ['discussion-completed'],
    };
  }
  if (skillId === 'session-wrapup') {
    return {
      phases: ['wrapup-generated', 'session-finalized'],
      defaultPhase: 'wrapup-generated',
      terminalPhases: ['session-finalized'],
    };
  }
  if (skillId === 'path-scene-framing') {
    return { phases: ['input-framed'], defaultPhase: 'input-framed', terminalPhases: ['input-framed'] };
  }
  if (skillId === 'path-planning') {
    return { phases: ['core-path-generated', 'path-generation-failed'], defaultPhase: 'core-path-generated', terminalPhases: ['core-path-generated'] };
  }
  if (skillId === 'stage-designer') {
    return { phases: ['stage-designed', 'stage-design-failed'], defaultPhase: 'stage-designed', terminalPhases: ['stage-designed'] };
  }
  if (skillId === 'adaptive-guidance-copy') {
    return { phases: ['guidance-generated'], defaultPhase: 'guidance-generated', terminalPhases: ['guidance-generated'] };
  }
  if (skillId === 'session-knowledge-distiller') {
    return { phases: ['knowledge-distilled'], defaultPhase: 'knowledge-distilled', terminalPhases: ['knowledge-distilled'] };
  }
  if (skillId === 'dialogue-concept-extractor') {
    return { phases: ['concept-extracted'], defaultPhase: 'concept-extracted', terminalPhases: ['concept-extracted'] };
  }
  if (skillId === 'learning-pattern-distiller') {
    return { phases: ['pattern-distilled'], defaultPhase: 'pattern-distilled', terminalPhases: ['pattern-distilled'] };
  }
  if (skillId === 'goal-profile-inference') {
    return { phases: ['profile-inferred'], defaultPhase: 'profile-inferred', terminalPhases: ['profile-inferred'] };
  }
  if (skillId === 'label-generator') {
    return { phases: ['label-generated'], defaultPhase: 'label-generated', terminalPhases: ['label-generated'] };
  }
  if (skillId === 'prompt-compiler') {
    return { phases: ['prompt-compiled'], defaultPhase: 'prompt-compiled', terminalPhases: ['prompt-compiled'] };
  }
  if (domain === 'virtual-learner') {
    return { phases: ['simulation-step-completed'], defaultPhase: 'simulation-step-completed', terminalPhases: ['simulation-step-completed'] };
  }
  return { phases: ['completed'], defaultPhase: 'completed', terminalPhases: ['completed'] };
}

export function buildDefaultRuntimeContract(skillId: string, archetype = ''): RuntimeContract {
  const normalizedSkillId = skillId.replace(/^skill:/, '');
  const contextMode = inferContextMode(normalizedSkillId, archetype);
  const domain = inferDomain(normalizedSkillId);
  const phaseSpec = inferPhases(normalizedSkillId, domain);
  return {
    version: 'prompt-runtime-contract/v1',
    contextMode,
    businessState: {
      domain,
      phases: phaseSpec.phases,
      defaultPhase: phaseSpec.defaultPhase,
      terminalPhases: phaseSpec.terminalPhases,
      statusValues: STATUS_VALUES,
    },
    contextUpdate: {
      mode: inferContextUpdate(contextMode),
      stateOwner: inferStateOwner(contextMode),
    },
    outputEnvelope: 'adapter',
  };
}

export function normalizeRuntimeContract(
  value: unknown,
  options: { skillId: string; archetype?: string }
): RuntimeContract {
  const base = buildDefaultRuntimeContract(options.skillId, options.archetype || '');
  const candidate = value && typeof value === 'object' ? value as any : {};
  const businessState = candidate.businessState && typeof candidate.businessState === 'object'
    ? candidate.businessState
    : {};
  const contextUpdate = candidate.contextUpdate && typeof candidate.contextUpdate === 'object'
    ? candidate.contextUpdate
    : {};
  const phases = asStringArray(businessState.phases, base.businessState.phases);
  const terminalPhases = asStringArray(businessState.terminalPhases, base.businessState.terminalPhases)
    .filter((phase) => phases.includes(phase));
  const defaultPhase = phases.includes(asString(businessState.defaultPhase, ''))
    ? asString(businessState.defaultPhase, '')
    : phases.includes(base.businessState.defaultPhase)
      ? base.businessState.defaultPhase
      : phases[0];

  return {
    version: 'prompt-runtime-contract/v1',
    contextMode: pickOne(candidate.contextMode, CONTEXT_MODES, base.contextMode),
    businessState: {
      domain: asString(businessState.domain, base.businessState.domain),
      phases,
      defaultPhase,
      terminalPhases: terminalPhases.length > 0 ? terminalPhases : [defaultPhase],
      statusValues: asStringArray(businessState.statusValues, base.businessState.statusValues)
        .filter((status): status is RuntimeBusinessStatus => STATUS_VALUES.includes(status as RuntimeBusinessStatus)),
    },
    contextUpdate: {
      mode: pickOne(contextUpdate.mode, CONTEXT_UPDATE_MODES, base.contextUpdate.mode),
      stateOwner: pickOne(contextUpdate.stateOwner, STATE_OWNERS, base.contextUpdate.stateOwner),
      ...(asString(contextUpdate.description, '') ? { description: asString(contextUpdate.description, '') } : {}),
    },
    outputEnvelope: pickOne(candidate.outputEnvelope, OUTPUT_ENVELOPES, base.outputEnvelope),
  };
}

export function buildBusinessStateSkeleton(contract: RuntimeContract) {
  return {
    domain: contract.businessState.domain,
    phase: contract.businessState.defaultPhase,
    status: contract.businessState.statusValues.join(' | '),
    confidence: 'number(0-1, optional)',
    isTerminal: contract.businessState.terminalPhases.includes(contract.businessState.defaultPhase),
    nextAction: 'string | null, optional',
    reason: 'string | null, optional',
  };
}

export function buildContextUpdateSkeleton(contract: RuntimeContract) {
  return {
    mode: contract.contextUpdate.mode,
    stateOwner: contract.contextUpdate.stateOwner,
    nextState: contract.contextUpdate.mode === 'none' ? null : 'object | null',
  };
}

export function renderRuntimeContractSection(contract: RuntimeContract): string {
  const envelopeHint = contract.outputEnvelope === 'model'
    ? '模型必须直接输出 artifact / businessState / contextUpdate 三段式 envelope。'
    : '模型保持本 Prompt 的业务 JSON 输出；运行时 adapter 会映射为 artifact / businessState / contextUpdate 三段式 envelope。';

  return [
    '### 统一运行契约',
    envelopeHint,
    '',
    `- contextMode: ${contract.contextMode}`,
    `- businessState.domain: ${contract.businessState.domain}`,
    `- businessState.phases: ${contract.businessState.phases.join(' | ')}`,
    `- businessState.defaultPhase: ${contract.businessState.defaultPhase}`,
    `- businessState.terminalPhases: ${contract.businessState.terminalPhases.join(' | ')}`,
    `- contextUpdate.mode: ${contract.contextUpdate.mode}`,
    `- contextUpdate.stateOwner: ${contract.contextUpdate.stateOwner}`,
    '',
    '运行时 envelope 目标结构：',
    '```json',
    JSON.stringify({
      artifact: contract.outputEnvelope === 'model' ? 'object' : 'raw output mapped by runtime adapter',
      businessState: buildBusinessStateSkeleton(contract),
      contextUpdate: buildContextUpdateSkeleton(contract),
    }, null, 2),
    '```',
  ].join('\n');
}
