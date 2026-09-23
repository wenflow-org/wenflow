/**
 * 回归：候选源「资料名对不上」时**必须继续尝试下一条**。
 * 真实案例（2026-09-22，3-6 岁儿童学习与发展指南）：首选候选是《印发通知》而非《指南》正文，
 * 抽取器正确地返回 not_found，但此前 `if (candidate) break` 让后面的正确候选源永不被尝试，
 * 最终只剩一句泛化的"无有效引文"（真实原因被吞）。
 */
import { collectMaterialPack, type MaterialCollectorDeps } from '../index';

describe('material-collector 候选源重试', () => {
  it('首选源返回 not_found ⇒ 继续下一条；把抽取诊断带出来；最终能出 pack', async () => {
    const deps: Partial<MaterialCollectorDeps> = {
      searchWeb: (async () => ({
        results: [
          { url: 'https://a.example.com/notice', title: '关于印发《指南》的通知' },
          { url: 'https://b.example.com/full', title: '《指南》正文' },
        ],
      })) as never,
      fetchWeb: (async (request: { urls: string[] }) => ({
        results: request.urls.map((url) => ({
          url,
          finalUrl: url,
          title: url,
          text: `正文内容：健康、语言、社会、科学、艺术。${'补充说明。'.repeat(30)}`,
        })),
        errors: [],
      })) as never,
      extract: (async (input: { source: { url: string } }) =>
        input.source.url.includes('notice')
          ? { status: 'not_found', keyPoints: null, notes: ['这是印发通知，不是资料正文，拒绝冒充'] }
          : {
              status: 'ok',
              title: '《指南》正文',
              keyPoints: [{ text: '五个领域：健康/语言/社会/科学/艺术', quote: '健康、语言、社会、科学、艺术', sourceUrl: input.source.url }],
              sections: [{ id: 's-1', title: '五个领域', summary: '…' }],
            }) as never,
    };

    const result = await collectMaterialPack({ title: '3-6岁儿童学习与发展指南' } as never, {
      maxSources: 2,
      deps,
      verifyQuotes: false,
    });

    expect(result.status).not.toBe('not_found');
    const keyPoints = (result as unknown as { pack?: { keyPoints?: unknown[] } }).pack?.keyPoints ?? [];
    expect(keyPoints.length).toBeGreaterThan(0);
    const notes = ((result as unknown as { notes?: string[] }).notes ?? []).join(' | ');
    expect(notes).toContain('抽取诊断');           // 真实原因不再被吞
    expect(notes).toContain('继续尝试下一条来源');   // 确实重试了下一条
  });
});
