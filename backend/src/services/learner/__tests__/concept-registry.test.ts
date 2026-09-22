import {
  ConceptRegistryService,
  type ConceptRegistryDeps,
} from '../concept-registry.service';

/**
 * 内存假 deps：只实现唯一索引语义（userId+aliasNorm / userId+canonicalLabel），
 * 与 prisma 的 `@@unique` 行为对齐——测试不打 DB。
 */
function makeDeps() {
  const concepts = new Map<string, { id: string; userId: string; canonicalLabel: string; level: string }>();
  const aliases = new Map<string, { id: string; conceptId: string; userId: string; aliasNorm: string; aliasRaw: string; source: string }>();
  const calls = { createConcept: 0, createAlias: 0 };
  let seq = 0;

  const deps: ConceptRegistryDeps = {
    async findAlias(userId, aliasNorm) {
      const hit = aliases.get(`${userId}\u0000${aliasNorm}`);
      return hit ? { conceptId: hit.conceptId } : null;
    },
    async findConcept(userId, canonicalLabel) {
      for (const c of concepts.values()) {
        if (c.userId === userId && c.canonicalLabel === canonicalLabel) return { id: c.id };
      }
      return null;
    },
    async createConcept(data) {
      calls.createConcept += 1;
      const id = data.id || `cpt_${++seq}`;
      concepts.set(id, { id, userId: data.userId, canonicalLabel: data.canonicalLabel, level: data.level });
      return { id };
    },
    async createAlias(data) {
      const key = `${data.userId}\u0000${data.aliasNorm}`;
      if (aliases.has(key)) throw new Error('UNIQUE constraint failed: concept_aliases.userId, concept_aliases.aliasNorm');
      calls.createAlias += 1;
      aliases.set(key, { id: data.id, conceptId: data.conceptId, userId: data.userId, aliasNorm: data.aliasNorm, aliasRaw: data.aliasRaw, source: data.source });
      return { id: data.id };
    },
  };
  return { deps, concepts, aliases, calls };
}

describe('ConceptRegistryService.resolveConcept（身份解析）', () => {
  it('首次解析创建概念 + 别名，created=true', async () => {
    const { deps, concepts, aliases } = makeDeps();
    const svc = new ConceptRegistryService(deps);
    const r = await svc.resolveConcept('u1', '识别半联动点');
    expect(r?.created).toBe(true);
    expect(concepts.size).toBe(1);
    expect(aliases.size).toBe(1);
    expect([...concepts.values()][0].level).toBe('kc');
  });

  it('同一文本二次解析命中别名，created=false 且不再建概念', async () => {
    const { deps, concepts, calls } = makeDeps();
    const svc = new ConceptRegistryService(deps);
    const a = await svc.resolveConcept('u1', '识别半联动点');
    const b = await svc.resolveConcept('u1', '识别半联动点');
    expect(b?.conceptId).toBe(a?.conceptId);
    expect(b?.created).toBe(false);
    expect(concepts.size).toBe(1);
    expect(calls.createConcept).toBe(1);
  });

  it('机械归一化等价变体落到同一概念（引号/空白/冒号从句/尾部标点）', async () => {
    const { deps, concepts } = makeDeps();
    const svc = new ConceptRegistryService(deps);
    const base = await svc.resolveConcept('u1', '靠动作先发生取胜');
    // 引号只是强调 → 归一后同键
    const quoted = await svc.resolveConcept('u1', '靠「动作先发生取胜」');
    // 多余空白 → 压缩后同键
    const spaced = await svc.resolveConcept('u1', '靠动作先发生取胜  ');
    // 尾部标点 → 去掉后同键
    const punctuated = await svc.resolveConcept('u1', '靠动作先发生取胜。');
    expect(quoted?.conceptId).toBe(base?.conceptId);
    expect(spaced?.conceptId).toBe(base?.conceptId);
    expect(punctuated?.conceptId).toBe(base?.conceptId);
    expect(concepts.size).toBe(1);
  });

  it('冒号后的解释性从句被截断 → 与主体同身份', async () => {
    const { deps, concepts } = makeDeps();
    const svc = new ConceptRegistryService(deps);
    const a = await svc.resolveConcept('u1', '离开前翻页立好');
    const b = await svc.resolveConcept('u1', '离开前翻页立好：动作先于评价');
    expect(b?.conceptId).toBe(a?.conceptId);
    expect(concepts.size).toBe(1);
  });

  it('createIfMissing=false 时未命中返回 null（只读校验用）', async () => {
    const { deps, concepts } = makeDeps();
    const svc = new ConceptRegistryService(deps);
    expect(await svc.resolveConcept('u1', '全新概念', { createIfMissing: false })).toBeNull();
    expect(concepts.size).toBe(0);
  });

  it('空/空白/未定义入参返回 null，不建任何行', async () => {
    const { deps, concepts, aliases } = makeDeps();
    const svc = new ConceptRegistryService(deps);
    expect(await svc.resolveConcept('u1', '')).toBeNull();
    expect(await svc.resolveConcept('u1', '   ')).toBeNull();
    expect(await svc.resolveConcept('u1', undefined)).toBeNull();
    expect(await svc.resolveConcept('', '识别半联动点')).toBeNull();
    expect(concepts.size).toBe(0);
    expect(aliases.size).toBe(0);
  });

  it('身份按用户隔离：同名文本对不同用户是不同概念', async () => {
    const { deps, concepts } = makeDeps();
    const svc = new ConceptRegistryService(deps);
    const a = await svc.resolveConcept('u1', '皮亚杰认知发展阶段');
    const b = await svc.resolveConcept('u2', '皮亚杰认知发展阶段');
    expect(a?.conceptId).not.toBe(b?.conceptId);
    expect(concepts.size).toBe(2);
  });

  it('并发登记冲突（unique 抛错）时重读，不抛给调用方', async () => {
    const { deps } = makeDeps();
    // 竞态窗口：首次 findAlias 未命中、createAlias 撞 unique，随后重读命中别处抢先登记的同一别名
    let firstLookup = true;
    const racy: ConceptRegistryDeps = {
      ...deps,
      async findAlias() {
        if (firstLookup) { firstLookup = false; return null; }
        return { conceptId: 'cpt_raced' };
      },
      async createAlias() {
        throw new Error('UNIQUE constraint failed: concept_aliases.userId, concept_aliases.aliasNorm');
      },
    };
    const svc = new ConceptRegistryService(racy);
    const r = await svc.registerAlias({ userId: 'u1', conceptId: 'cpt_mine', aliasRaw: '竞态概念' });
    expect(r).toEqual({ conceptId: 'cpt_raced', registered: false });
  });
});

describe('ConceptRegistryService.registerAlias（归并升格入口）', () => {
  it('把自由文本别名挂到既有 canonical 概念上，registered=true', async () => {
    const { deps, aliases } = makeDeps();
    const svc = new ConceptRegistryService(deps);
    const r = await svc.registerAlias({ userId: 'u1', conceptId: 'cpt_x', aliasRaw: '回来后第一手落到哪里', source: 'consolidator' });
    expect(r).toEqual({ conceptId: 'cpt_x', registered: true });
    expect([...aliases.values()][0].source).toBe('consolidator');
  });

  it('幂等：同别名重复登记不新增行，返回既有概念', async () => {
    const { deps, aliases, calls } = makeDeps();
    const svc = new ConceptRegistryService(deps);
    await svc.registerAlias({ userId: 'u1', conceptId: 'cpt_x', aliasRaw: '同一别名' });
    const second = await svc.registerAlias({ userId: 'u1', conceptId: 'cpt_y', aliasRaw: '同一别名' });
    expect(second).toEqual({ conceptId: 'cpt_x', registered: false });
    expect(aliases.size).toBe(1);
    expect(calls.createAlias).toBe(1);
  });

  it('登记后 resolve 同一文本命中该概念（归并立即生效）', async () => {
    const { deps } = makeDeps();
    const svc = new ConceptRegistryService(deps);
    await svc.registerAlias({ userId: 'u1', conceptId: 'cpt_canonical', aliasRaw: '回来后的第一眼第一手交给已翻开的书' });
    const resolved = await svc.resolveConcept('u1', '回来后的第一眼第一手交给已翻开的书');
    expect(resolved?.conceptId).toBe('cpt_canonical');
    expect(resolved?.created).toBe(false);
  });
});

describe('ConceptRegistryService.resolveMany（批量解析）', () => {
  it('去重后返回 aliasNorm → conceptId 映射，无效项不进结果', async () => {
    const { deps, concepts } = makeDeps();
    const svc = new ConceptRegistryService(deps);
    const map = await svc.resolveMany('u1', ['识别半联动点', '识别半联动点', '  ', '按公共键对齐拼接两个报表']);
    expect(map.size).toBe(2);
    expect(concepts.size).toBe(2);
  });
});
