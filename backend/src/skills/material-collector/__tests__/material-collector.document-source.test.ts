/**
 * P0-a / P0-b（2026-09-22）：查询定向抽取参数透传 + 文档型来源优先。
 * 背景：实测"找《3-6岁儿童学习与发展指南》"时，排序只看域名权威度，
 * 导致"官方域的通知页"压过"非官方域的全文 PDF"。
 */
import { collectMaterialPack, documentSourceScore, rankSources, type MaterialCollectorDeps } from '../index';

describe('P0-b 文档型来源优先', () => {
  it('全文 PDF 排在官方域的「印发通知」页前面', () => {
    const ranked = rankSources([
      { url: 'http://www.moe.gov.cn/srcsite/notice.html', title: '教育部关于印发《3-6岁儿童学习与发展指南》的通知' },
      { url: 'https://www.unicef.cn/media/8456/file/guide.pdf', title: '《3—6岁儿童学习与发展指南》.pdf' },
    ] as never);
    expect(ranked[0].url).toContain('.pdf');
  });

  it('documentSourceScore 分级：文档型 =2，命中"全文/附件/下载" =1，其余 =0', () => {
    expect(documentSourceScore('https://a.com/x.pdf')).toBe(2);
    expect(documentSourceScore('https://a.com/page', '《指南》全文下载')).toBe(1);
    expect(documentSourceScore('https://a.com/page', '关于印发指南的通知')).toBe(0);
  });
});

describe('P0-a 查询定向抽取参数透传', () => {
  it('fetchWeb 收到 query / chunksPerSource / extractDepth', async () => {
    let seen: Record<string, unknown> | null = null;
    const deps: Partial<MaterialCollectorDeps> = {
      searchWeb: (async () => ({ results: [{ url: 'https://a.com/x', title: '指南' }] })) as never,
      fetchWeb: (async (request: Record<string, unknown>) => {
        seen = request;
        return {
          results: [{ url: 'https://a.com/x', finalUrl: 'https://a.com/x', title: 'x', text: `正文${'补充。'.repeat(40)}` }],
          errors: [],
        };
      }) as never,
      extract: (async () => ({
        status: 'ok',
        keyPoints: [{ text: '要点', quote: '正文', sourceUrl: 'https://a.com/x' }],
        sections: [{ id: 's-1', title: '章节', summary: '摘要' }],
      })) as never,
    };

    await collectMaterialPack(
      { title: '3-6岁儿童学习与发展指南', publisher: '教育部', kind: 'standard' } as never,
      { maxSources: 1, deps, verifyQuotes: false }
    );

    const request = seen as unknown as { query?: string; chunksPerSource?: number; extractDepth?: string };
    expect(request.query).toContain('3-6岁儿童学习与发展指南');
    expect(request.chunksPerSource).toBe(3);
    expect(request.extractDepth).toBe('advanced');
  });
});
