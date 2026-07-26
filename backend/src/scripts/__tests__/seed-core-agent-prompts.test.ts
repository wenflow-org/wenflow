import {
  buildPromptFileRuntimeContractMetadata,
  mapPromptFileToCoreAgentPromptSeed,
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
