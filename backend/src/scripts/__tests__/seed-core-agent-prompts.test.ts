import {
  buildPromptFileRuntimeContractMetadata,
  mapPromptFileToCoreAgentPromptSeed,
  matchesSeedConfig,
} from '../seed-core-agent-prompts';
import type { PromptFile } from '../../composers/prompt-files/loader';

function makePromptFile(runtimeContract?: unknown): PromptFile {
  return {
    agentId: 'skill:teaching-turn',
    name: 'default-skill-teaching-turn',
    systemPrompt: 'System prompt',
    filePath: 'D:/prompts/skill.teaching-turn.md',
    archetype: 'conversational',
    ...(runtimeContract === undefined ? {} : { runtimeContract }),
  };
}

function validPromptContract() {
  return {
    version: 'skill-prompt-contract/v2',
    executionMode: 'llm',
    artifactKind: 'conversation',
    interactionMode: 'turn',
    input: { transport: 'json', schemaSource: 'skill-definition' },
    output: { media: 'json', schemaSource: 'runtime-validator', envelope: 'adapter' },
    context: { envelope: 'context-envelope/v1', delivery: 'sidecar', modelExposure: 'projected' },
    failurePolicy: 'retry',
  };
}

function validRuntimeContract() {
  return {
    version: 'prompt-runtime-contract/v1',
    contextMode: 'thread-context',
    businessState: {
      domain: 'teaching',
      phases: ['turn-generated', 'completed'],
      defaultPhase: 'turn-generated',
      terminalPhases: ['completed'],
      statusValues: ['succeeded', 'partial', 'blocked', 'failed'],
    },
    contextUpdate: {
      mode: 'thread-state',
      stateOwner: 'orchestrator',
    },
    outputEnvelope: 'adapter',
  };
}

describe('File-as-Truth runtime-contract seed snapshots', () => {
  it('maps a declared contract to prompt-file metadata', () => {
    const seed = mapPromptFileToCoreAgentPromptSeed(makePromptFile(validRuntimeContract()));

    expect(JSON.parse(seed.metadata!)).toEqual({
      promptLab: {
        source: 'prompt-file',
        runtimeContractSource: 'prompt-frontmatter',
        runtimeContract: validRuntimeContract(),
      },
    });
  });

  it('leaves seed metadata absent without a runtimeContract declaration', () => {
    const seed = mapPromptFileToCoreAgentPromptSeed(makePromptFile());

    expect(seed).not.toHaveProperty('metadata');
  });

  it('snapshots promptContract beside runtimeContract', () => {
    const file = {
      ...makePromptFile(validRuntimeContract()),
      promptContract: validPromptContract(),
    };
    const seed = mapPromptFileToCoreAgentPromptSeed(file);

    expect(JSON.parse(seed.metadata!)).toEqual({
      promptLab: {
        source: 'prompt-file',
        runtimeContractSource: 'prompt-frontmatter',
        runtimeContract: validRuntimeContract(),
        promptContractSource: 'prompt-frontmatter',
        promptContract: validPromptContract(),
      },
    });
  });

  it('rejects malformed declarations instead of normalizing them to defaults', () => {
    const invalidContract = {
      ...validRuntimeContract(),
      contextMode: 'invalid-mode',
    };

    expect(() => buildPromptFileRuntimeContractMetadata(makePromptFile(invalidContract)))
      .toThrow('Prompt skill:teaching-turn has an invalid runtimeContract.contextMode');
  });
});

describe('v4 coreHash seed snapshots', () => {
  it('passes coreHash/coreVersion through to the seed and metadata', () => {
    const file = { ...makePromptFile(), coreHash: 'abc123', coreVersion: 2 };
    const seed = mapPromptFileToCoreAgentPromptSeed(file);

    expect(seed.coreHash).toBe('abc123');
    expect(seed.coreVersion).toBe(2);
    expect(JSON.parse(seed.metadata!)).toEqual({
      promptLab: {
        source: 'prompt-file',
        coreHash: 'abc123',
        coreVersion: 2,
      },
    });
  });

  it('v4 file without contracts still gets anchor-only metadata', () => {
    const seed = mapPromptFileToCoreAgentPromptSeed({ ...makePromptFile(), coreHash: 'deadbeef' });

    expect(JSON.parse(seed.metadata!)).toEqual({
      promptLab: { source: 'prompt-file', coreHash: 'deadbeef' },
    });
    expect(seed).not.toHaveProperty('coreVersion');
  });

  it('detects coreHash-only drift via structural metadata compare', () => {
    const active = {
      systemPrompt: 'System prompt',
      temperature: 0.7,
      maxTokens: 4000,
      model: 'deepseek-chat',
      metadata: JSON.stringify({ promptLab: { coreHash: 'aaa' } }),
    };
    const seed = {
      agentId: 'skill:teaching-turn',
      name: 'default-skill-teaching-turn',
      description: 'seed',
      systemPrompt: 'System prompt',
      temperature: 0.7,
      maxTokens: 4000,
      metadata: JSON.stringify({ promptLab: { coreHash: 'bbb' } }),
    };

    expect(matchesSeedConfig(active, seed, 'deepseek-chat')).toBe(false);
  });
});

describe('matchesSeedConfig metadata drift detection', () => {
  function makeActivePrompt(metadata?: string | null) {
    return {
      systemPrompt: 'System prompt',
      temperature: 0.7,
      maxTokens: 4000,
      model: 'deepseek-chat',
      ...(metadata === undefined ? {} : { metadata }),
    };
  }

  function makeSeed(metadata?: string) {
    return {
      agentId: 'skill:teaching-turn',
      name: 'default-skill-teaching-turn',
      description: 'seed',
      systemPrompt: 'System prompt',
      temperature: 0.7,
      maxTokens: 4000,
      ...(metadata === undefined ? {} : { metadata }),
    };
  }

  it('matches when metadata is structurally equal despite key ordering', () => {
    const active = makeActivePrompt(JSON.stringify({
      promptLab: {
        runtimeContract: validRuntimeContract(),
        source: 'prompt-file',
      },
    }));
    const seed = makeSeed(JSON.stringify({
      promptLab: {
        source: 'prompt-file',
        runtimeContract: validRuntimeContract(),
      },
    }));

    expect(matchesSeedConfig(active, seed, 'deepseek-chat')).toBe(true);
  });

  it('detects contract-only drift that used to skip sync', () => {
    const driftedPromptContract = { ...validPromptContract(), failurePolicy: 'blocking' };
    const active = makeActivePrompt(JSON.stringify({
      promptLab: { promptContract: driftedPromptContract },
    }));
    const seed = makeSeed(JSON.stringify({
      promptLab: { promptContract: validPromptContract() },
    }));

    expect(matchesSeedConfig(active, seed, 'deepseek-chat')).toBe(false);
  });

  it('detects a missing metadata snapshot on the ACTIVE side', () => {
    const active = makeActivePrompt(null);
    const seed = makeSeed(JSON.stringify({
      promptLab: { promptContract: validPromptContract() },
    }));

    expect(matchesSeedConfig(active, seed, 'deepseek-chat')).toBe(false);
  });

  it('still matches when neither side carries metadata', () => {
    expect(matchesSeedConfig(makeActivePrompt(null), makeSeed(), 'deepseek-chat')).toBe(true);
    expect(matchesSeedConfig(makeActivePrompt(), makeSeed(), 'deepseek-chat')).toBe(true);
  });
});
