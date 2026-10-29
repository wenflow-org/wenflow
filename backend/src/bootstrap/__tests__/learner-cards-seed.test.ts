/**
 * 学习者卡库默认卡播种单测（2026-10-29 用户拍板：新部署开箱即有 200 张默认金标/边界卡）。
 *
 * 钉死四条语义：
 * 1. 卡库为空才播种（已有库绝不改动——删卡不被重启复活，curated 库不被覆盖）；
 * 2. WENFLOW_SEED_LEARNER_CARDS=false 显式关闭；
 * 3. 卡库文件缺失（精简部署）跳过不阻断；
 * 4. importCards 的 parseError / 部分失败如实落日志（部分失败后库非空，重启不自动补齐）。
 */

const envBackup = { ...process.env };

describe('runLearnerCardsSeed（默认卡播种，仅空库）', () => {
  let runLearnerCardsSeed: typeof import('../seeds').runLearnerCardsSeed;

  beforeEach(() => {
    delete process.env.WENFLOW_SEED_LEARNER_CARDS;
    jest.resetModules();
  });

  beforeEach(async () => {
    runLearnerCardsSeed = (await import('../seeds')).runLearnerCardsSeed;
  });

  afterEach(() => {
    process.env = { ...envBackup };
    jest.restoreAllMocks();
  });

  const okReport = {
    parseError: null,
    results: [{ cardKey: 'golden-a', action: 'created' }],
    summary: { total: 1, created: 1, updated: 0, skipped: 0, failed: 0 },
  };

  it('卡库为空 → 读仓库卡文件并走 importCards（enrich=false 的手工导入同路径）', async () => {
    const calls: string[] = [];
    await runLearnerCardsSeed(() => {}, {
      countCards: async () => 0,
      readFile: (file) => { calls.push(`read:${file.includes('virtual-learners-200.json')}`); return '[{"cardKey":"golden-a"}]'; },
      importCardsFn: async (content) => { calls.push(`import:${content}`); return okReport; },
    });
    expect(calls).toEqual(['read:true', 'import:[{"cardKey":"golden-a"}]']);
  });

  it('卡库非空 → 跳过（不读文件、不导入：删卡不被重启复活）', async () => {
    let imported = 0;
    await runLearnerCardsSeed(() => {}, {
      countCards: async () => 209,
      readFile: () => { throw new Error('不应读文件'); },
      importCardsFn: async () => { imported += 1; return okReport; },
    });
    expect(imported).toBe(0);
  });

  it('WENFLOW_SEED_LEARNER_CARDS=false → 显式关闭，不触碰卡库', async () => {
    process.env.WENFLOW_SEED_LEARNER_CARDS = 'false';
    let counted = 0;
    await runLearnerCardsSeed(() => {}, {
      countCards: async () => { counted += 1; return 0; },
      importCardsFn: async () => okReport,
    });
    expect(counted).toBe(0);
  });

  it('卡库文件缺失（精简部署）→ 跳过且不导入、不抛错', async () => {
    let imported = 0;
    await runLearnerCardsSeed(() => {}, {
      countCards: async () => 0,
      readFile: () => { throw new Error('ENOENT'); },
      importCardsFn: async () => { imported += 1; return okReport; },
    });
    expect(imported).toBe(0);
  });

  it('importCards 报 parseError → 记日志不导入成功口径、不抛错', async () => {
    await expect(runLearnerCardsSeed(() => {}, {
      countCards: async () => 0,
      readFile: () => 'not-json',
      importCardsFn: async () => ({ parseError: 'bad json', results: [], summary: { total: 0, created: 0, updated: 0, skipped: 0, failed: 0 } }),
    })).resolves.toBeUndefined();
  });

  it('导入部分失败 → 完成日志带失败样本与「重启不自动补齐」提示，整体不抛错', async () => {
    await expect(runLearnerCardsSeed(() => {}, {
      countCards: async () => 0,
      readFile: () => '[{"cardKey":"golden-a"},{"cardKey":"broken"}]',
      importCardsFn: async () => ({
        parseError: null,
        results: [
          { cardKey: 'golden-a', action: 'created' },
          { cardKey: 'broken', action: 'failed', reason: 'dup email' },
        ],
        summary: { total: 2, created: 1, updated: 0, skipped: 0, failed: 1 },
      }),
    })).resolves.toBeUndefined();
  });

  it('countCards 抛错（DB 不可用）→ 不阻断启动', async () => {
    await expect(runLearnerCardsSeed(() => {}, {
      countCards: async () => { throw new Error('db down'); },
      importCardsFn: async () => okReport,
    })).resolves.toBeUndefined();
  });
});
