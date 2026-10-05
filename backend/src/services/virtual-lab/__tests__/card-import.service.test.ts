import { parseCardDocument, validateCard, resolveCardKey, buildCardWallEntries, type LearnerCard } from '../card-import.service';

function emptyIndex() {
  return { byKey: new Map<string, string>(), refs: new Map<string, string[]>(), seenInDoc: new Set<string>() };
}

function card(over: Partial<LearnerCard> = {}): LearnerCard {
  return {
    cardKey: 'w6-math-01',
    persona: { nameHint: '高一学生', background: '县城重点高中高一在读，函数基础薄弱' },
    story: {
      visibleOpening: '我这次月考函数只考了 58 分，家长会后天就要开了，我真的不知道从哪补起。',
      followUps: ['你平时函数作业完成情况如何？', '考试时是想不到方法还是算错？', '每天能拿出多少时间补？'],
      goalSeed: { domain: '高中数学·函数', budget: { dailyMinutes: 60, horizonDays: 30, expectedHours: 30 } },
    },
    source: { kind: 'web', ref: 'https://example.com/note/math-01' },
    ...over,
  };
}

describe('card-import：parseCardDocument', () => {
  it('解析 yaml 的 cards 数组', () => {
    const r = parseCardDocument('cards:\n  - cardKey: a-01\n    persona:\n      background: x\n', 'yaml');
    expect(r.parseError).toBeUndefined();
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].cardKey).toBe('a-01');
  });

  it('解析 json 的 cards 数组', () => {
    const r = parseCardDocument(JSON.stringify({ cards: [{ cardKey: 'a-01' }] }), 'json');
    expect(r.parseError).toBeUndefined();
    expect(r.cards[0].cardKey).toBe('a-01');
  });

  it('缺 cards 数组时报错', () => {
    expect(parseCardDocument('foo: 1\n', 'yaml').parseError).toContain('cards');
  });

  it('语法错误时报错而非抛出', () => {
    const r = parseCardDocument('cards: [1,2', 'json');
    expect(r.parseError).toBeTruthy();
    expect(r.cards).toEqual([]);
  });
});

describe('card-import：validateCard', () => {
  it('合规卡 → ok', () => {
    const r = validateCard(card(), emptyIndex());
    expect(r.status).toBe('ok');
    expect(r.errors).toEqual([]);
  });

  it('cardKey 非法 / 缺失 → error', () => {
    expect(validateCard(card({ cardKey: '' }), emptyIndex()).errors.join()).toContain('cardKey 必填');
    expect(validateCard(card({ cardKey: '中文 key' }), emptyIndex()).errors.join()).toContain('cardKey');
  });

  it('文件内 cardKey 重复 → 第二个报 error', () => {
    const idx = emptyIndex();
    expect(validateCard(card(), idx).status).toBe('ok');
    expect(validateCard(card(), idx).errors.join()).toContain('文件内 cardKey 重复');
  });

  it('库内已存在 → exists 且带 existingProfileId', () => {
    const idx = emptyIndex();
    idx.byKey.set('w6-math-01', 'prof-1');
    const r = validateCard(card(), idx);
    expect(r.status).toBe('exists');
    expect(r.existingProfileId).toBe('prof-1');
  });

  it('persona.background 缺失 → error（此人是谁必须给）', () => {
    const r = validateCard(card({ persona: { nameHint: 'x' } }), emptyIndex());
    expect(r.status).toBe('error');
    expect(r.errors.join()).toContain('background');
  });

  it('source.kind=web 但 ref 非 http → error（假来源事故防线）', () => {
    const r = validateCard(card({ source: { kind: 'web', ref: '红书笔记截图' } }), emptyIndex());
    expect(r.errors.join()).toContain('http');
  });

  it('source.kind=synthetic 但给了 URL → 告警而非放行伪造链接', () => {
    const r = validateCard(card({ source: { kind: 'synthetic', ref: 'https://example.com/a' } }), emptyIndex());
    expect(r.status).toBe('warn');
    expect(r.warnings.join()).toContain('确认标注是否正确');
  });

  it('source.kind 缺失 / 非法 → error', () => {
    expect(validateCard(card({ source: {} }), emptyIndex()).errors.join()).toContain('source.kind 必填');
    expect(validateCard(card({ source: { kind: 'foo' as 'web' } }), emptyIndex()).errors.join()).toContain('非法');
  });

  it('同源引用撞车 → 同源预警（跨波重渲染高发的确定性哨兵）', () => {
    const idx = emptyIndex();
    idx.refs.set('https://example.com/post/1', ['w5-cook-03']);
    const r = validateCard(card({ source: { kind: 'web', ref: 'https://example.com/post/1' } }), idx);
    expect(r.warnings.join()).toContain('同源预警');
    expect(r.warnings.join()).toContain('w5-cook-03');
  });

  it('预算不自洽（expectedHours 与 daily×days 偏差 >50%）→ 告警', () => {
    const r = validateCard(
      card({ story: { ...card().story, goalSeed: { budget: { dailyMinutes: 60, horizonDays: 30, expectedHours: 200 } } } }),
      emptyIndex()
    );
    expect(r.warnings.join()).toContain('预算不自洽');
  });

  it('预算自洽 → 无预算告警', () => {
    const r = validateCard(card(), emptyIndex());
    expect(r.warnings.join()).not.toContain('预算');
  });

  it('followUps 非 3 条 → 告警（角色卡故事池契约）', () => {
    const r = validateCard(card({ story: { ...card().story, followUps: ['只有一条'] } }), emptyIndex());
    expect(r.warnings.join()).toContain('followUps');
  });

  it('开场白过短 → 长度告警', () => {
    const r = validateCard(card({ story: { ...card().story, visibleOpening: '想学数学' } }), emptyIndex());
    expect(r.warnings.join()).toContain('visibleOpening 长度');
  });

  it('自带资料：缺 title / 缺正文 → error', () => {
    const noTitle = validateCard(card({ materials: [{ kind: 'book', title: '', content: 'x' }] } as Partial<LearnerCard> as LearnerCard), emptyIndex());
    expect(noTitle.errors.join()).toContain('title 必填');
    const noBody = validateCard(card({ materials: [{ kind: 'book', title: '某书' }] } as Partial<LearnerCard> as LearnerCard), emptyIndex());
    expect(noBody.errors.join()).toContain('content 与 outline 至少给一个');
  });

  it('自带资料：kind 非法 → error；合法 outline 卡通过', () => {
    const badKind = validateCard(card({ materials: [{ kind: 'video' as 'book', title: '某课', outline: ['第1章'] }] } as Partial<LearnerCard> as LearnerCard), emptyIndex());
    expect(badKind.errors.join()).toContain('kind 非法');
    const ok = validateCard(card({ materials: [{ kind: 'book', title: '《统计学习基础》', outline: ['第1章 监督学习', '第2章 线性模型'] }] } as Partial<LearnerCard> as LearnerCard), emptyIndex());
    expect(ok.errors).toEqual([]);
  });
});

describe('card-import：resolveCardKey（历史卡身份回退）', () => {
  it('优先 profile.cardKey（卡库导入写入）', () => {
    expect(resolveCardKey({ cardKey: 'w6-math-01' }, ['w6', 'rw-life-01'])).toBe('w6-math-01');
  });

  it('回退 personaSeed.scenarioCard.personaId（批量导入卡）', () => {
    const p = { personaSeed: { scenarioCard: { personaId: 'rw-life-01' } } };
    expect(resolveCardKey(p, ['w6', 'rw-life-01', '生活'])).toBe('rw-life-01');
  });

  it('tags 回退跳过波次标签 w5/w6（否则整波卡撞成同一个 key）', () => {
    expect(resolveCardKey({}, ['w6', 'rw-school-26'])).toBe('rw-school-26');
    expect(resolveCardKey({}, ['w5'])).toBeNull();
    expect(resolveCardKey({}, ['w6', 'w5'])).toBeNull();
  });

  it('nameHint 符合 cardKey 形态时才回退', () => {
    expect(resolveCardKey({ personaSeed: { nameHint: 'rw-cook-03' } }, [])).toBe('rw-cook-03');
    expect(resolveCardKey({ personaSeed: { nameHint: '高三学生小张' } }, [])).toBeNull();
  });
});

describe('card-import：卡墙索引映射（buildCardWallEntries，2026-10-05 卡库改版）', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'prof-1',
    userId: 'user-1',
    profile: JSON.stringify({
      personaSeed: {
        nameHint: '高一学生',
        scenarioCard: { cardKey: 'w6-math-01', opening: '我这次月考函数只考了 58 分。', sourceKind: 'web' },
      },
      cardKey: 'w6-math-01',
    }),
    tags: JSON.stringify(['w6-math-01', '数学', '函数']),
    learningGoal: '高中数学·函数',
    knowledgeLevel: 'beginner',
    presetKey: null,
    users: { name: '小陈', email: 'c1@vl.local' },
    ...over,
  });

  it('解析 personaSeed.scenarioCard 展示字段；preset 按 presetKey 判定', () => {
    const [a] = buildCardWallEntries([row()]);
    expect(a.cardKey).toBe('w6-math-01');
    expect(a.name).toBe('高一学生');
    expect(a.opening).toContain('58 分');
    expect(a.sourceKind).toBe('web');
    expect(a.preset).toBe(false);
    expect(a.userId).toBe('user-1');
  });

  it('name 回退链：nameHint → displayName → cardKey → email；坏 JSON 降级占位不抛', () => {
    const noHint = buildCardWallEntries([row({ profile: JSON.stringify({ personaSeed: { scenarioCard: { cardKey: 'k-1' } } }) })])[0];
    expect(noHint.name).toBe('小陈');
    const bad = buildCardWallEntries([row({ profile: '{oops' })])[0];
    // 坏 JSON 也从 tags 兜底出 key（跳过波次标签的同款过滤），占位展示更准确
    expect(bad.cardKey).toBe('w6-math-01');
    expect(bad.name).toBe('小陈');
  });

  it('scenarioCard 缺 cardKey 的存量卡由 tags[0] 兜底（导入时恒写入）', () => {
    const legacy = buildCardWallEntries([row({
      profile: JSON.stringify({ personaSeed: { nameHint: '老卡' } }),
      tags: JSON.stringify(['legacy-key-01', '标签']),
    })])[0];
    expect(legacy.cardKey).toBe('legacy-key-01');
  });

  it('预置卡 preset=true', () => {
    const [p] = buildCardWallEntries([row({ presetKey: 'retiree-photography' })]);
    expect(p.preset).toBe(true);
  });
});
