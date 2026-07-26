import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parsePromptFile, scanPromptFiles, serializePromptFile } from '../loader';

describe('prompt file loader', () => {
  it('round-trips nested runtimeContract frontmatter', () => {
    const runtimeContract = {
      version: 'prompt-runtime-contract/v1',
      contextMode: 'thread-context',
      businessState: {
        domain: 'teaching',
        phases: ['turn-generated', 'completed'],
        defaultPhase: 'turn-generated',
        terminalPhases: ['completed'],
        statusValues: ['succeeded', 'partial'],
      },
      contextUpdate: {
        mode: 'thread-state',
        stateOwner: 'orchestrator',
        description: 'preserve nested field',
      },
      outputEnvelope: 'adapter',
    };
    const raw = [
      '---',
      'agentId: skill:test',
      'name: default-skill-test',
      'acceptableAgentIds: []',
      'runtimeContract:',
      '  version: prompt-runtime-contract/v1',
      '  contextMode: thread-context',
      '  businessState:',
      '    domain: teaching',
      '    phases:',
      '      - turn-generated',
      '      - completed',
      '    defaultPhase: turn-generated',
      '    terminalPhases:',
      '      - completed',
      '    statusValues:',
      '      - succeeded',
      '      - partial',
      '  contextUpdate:',
      '    mode: thread-state',
      '    stateOwner: orchestrator',
      '    description: preserve nested field',
      '  outputEnvelope: adapter',
      '---',
      '',
      'System prompt',
    ].join('\n');

    const parsed = parsePromptFile('D:/prompts/skill.test.md', raw);
    const serialized = serializePromptFile(parsed);
    const roundTripped = parsePromptFile('D:/prompts/skill.test.md', serialized);

    expect(parsed.runtimeContract).toEqual(runtimeContract);
    expect(roundTripped.runtimeContract).toEqual(runtimeContract);
  });

  it('round-trips Skill Prompt Contract v2 frontmatter', () => {
    const raw = [
      '---',
      'agentId: skill:test',
      'name: default-skill-test',
      'archetype: extractor',
      'acceptableAgentIds: []',
      'promptContract:',
      '  version: skill-prompt-contract/v2',
      '  executionMode: llm',
      '  artifactKind: extraction',
      '  interactionMode: snapshot',
      '  input: { transport: json, schemaSource: skill-definition }',
      '  output: { media: json, schemaSource: runtime-validator, envelope: adapter }',
      '  context: { envelope: context-envelope/v1, delivery: sidecar, modelExposure: projected }',
      '  failurePolicy: best-effort',
      '---',
      '',
      'System prompt',
    ].join('\n');

    const parsed = parsePromptFile('D:/prompts/skill.test.md', raw);
    const roundTripped = parsePromptFile(
      'D:/prompts/skill.test.md',
      serializePromptFile(parsed)
    );

    expect(parsed.acceptableAgentIds).toEqual([]);
    expect(roundTripped.acceptableAgentIds).toEqual([]);
    expect(roundTripped.promptContract).toEqual(parsed.promptContract);
  });

  it('continues scanning after an individual YAML frontmatter error', () => {
    const promptsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-prompt-loader-'));
    try {
      fs.writeFileSync(path.join(promptsDir, 'skill.valid.md'), [
        '---',
        'agentId: skill:valid',
        'name: default-skill-valid',
        '---',
        '',
        'Valid system prompt',
      ].join('\n'));
      fs.writeFileSync(path.join(promptsDir, 'skill.invalid.md'), [
        '---',
        'agentId: [unclosed',
        '---',
        '',
        'Invalid system prompt',
      ].join('\n'));
      fs.writeFileSync(path.join(promptsDir, '_ignored.md'), 'Ignored helper');

      const result = scanPromptFiles(promptsDir);

      expect(result.files.map((file) => file.agentId)).toEqual(['skill:valid']);
      expect(result.diagnostics).toEqual([expect.objectContaining({
        filePath: path.join(promptsDir, 'skill.invalid.md'),
        code: 'frontmatter-parse-error',
      })]);
    } finally {
      fs.rmSync(promptsDir, { recursive: true, force: true });
    }
  });
});
