import { buildSkillOutcome, noneTransition } from '../outcome';

describe('SkillOutcome scaffold', () => {
  it('builds v1 outcome with null transition by default', () => {
    const outcome = buildSkillOutcome({
      skillId: 'skill:peer-reinforcement',
      artifact: { message: 'hi', strategy: 'feynman', followUpQuestions: [] },
      quality: 'model',
    });

    expect(outcome.schemaVersion).toBe('skill-outcome/v1');
    expect(outcome.meta.skillId).toBe('skill:peer-reinforcement');
    expect(outcome.meta.quality).toBe('model');
    expect(outcome.transition).toBeNull();
    expect(outcome.artifact).toEqual({
      message: 'hi',
      strategy: 'feynman',
      followUpQuestions: [],
    });
  });

  it('noneTransition marks non-durable independent artifacts', () => {
    const t = noneTransition('discussion-generated');
    expect(t.kind).toBe('none');
    expect(t.durable).toBe(false);
    expect(t.axes?.transitionKind).toBe('none');
    expect(t.phase).toBe('discussion-generated');
  });

  it('keeps the staged three-axis vocabulary aligned with the migration baseline', () => {
    const outcome = buildSkillOutcome({
      skillId: 'skill:session-wrapup',
      artifact: { summary: 'done' },
      transition: {
        kind: 'append',
        axes: {
          inputSource: 'evidence-snapshot',
          transitionKind: 'append',
          durableOwner: 'teaching-session',
        },
      },
    });

    expect(outcome.transition).toEqual(expect.objectContaining({ kind: 'append' }));
    expect(outcome.transition?.axes).toEqual({
      inputSource: 'evidence-snapshot',
      transitionKind: 'append',
      durableOwner: 'teaching-session',
    });
  });
});
