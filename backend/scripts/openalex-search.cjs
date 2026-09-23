/* 联网检索 OpenAlex（只读）：标题｜年份｜被引｜来源｜摘要前 320 字
 * 用法：node scripts/openalex-search.cjs "knowledge component granularity" 10
 */
const qRaw = process.argv[2];
const n = process.argv[3] || '10';
// 前缀 title: → 按标题检索（全库全文检索太吵）；否则用通配 search
const isTitle = qRaw.startsWith('title:');
const q = isTitle ? qRaw.slice(6) : qRaw;
const url = isTitle
  ? `https://api.openalex.org/works?filter=title.search:${encodeURIComponent(q)}&per-page=${n}&mailto=research@example.com&sort=cited_by_count:desc`
  : `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${n}&mailto=research@example.com&sort=relevance_score:desc`;

/** OpenAlex 摘要是倒排索引，得还原 */
function abstractOf(inv) {
  if (!inv || typeof inv !== 'object') return '';
  const slots = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const pos of positions) slots[pos] = word;
  }
  return slots.filter(Boolean).join(' ');
}

(async () => {
  const r = await fetch(url, { headers: { 'User-Agent': 'wenflow-research/1.0 (research@example.com)' } });
  const j = await r.json();
  console.log(`# query=${q}  http=${r.status}  total=${j?.meta?.count}`);
  for (const w of j.results || []) {
    const venue = w?.primary_location?.source?.display_name || '(no venue)';
    console.log(`\n- ${w.title}  |  ${w.publication_year}  |  被引 ${w.cited_by_count}  |  ${venue}`);
    const abs = abstractOf(w.abstract_inverted_index);
    if (abs) console.log(`  ${abs.slice(0, process.argv[4] === 'full' ? 2000 : 320)}`);
  }
})().catch((e) => console.error('FAIL', e.message));
