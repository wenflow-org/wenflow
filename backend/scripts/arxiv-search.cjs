/* 联网检索 arxiv（只读）：把 Atom 结果压成 标题｜年份｜id｜摘要前 340 字
 * 用法：node scripts/arxiv-search.cjs 'abs:"knowledge tracing" AND abs:"graph"' 12
 */
const q = process.argv[2];
const n = process.argv[3] || '15';
const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&start=0&max_results=${n}&sortBy=relevance`;

/** 取 <tag ...>...</tag> 的内容（用 indexOf 而不是构造 RegExp，避开转义坑） */
function pick(chunk, tag) {
  const open = `<${tag}`;
  const start = chunk.indexOf(open);
  if (start < 0) return '';
  const gt = chunk.indexOf('>', start);
  if (gt < 0) return '';
  const end = chunk.indexOf(`</${tag}>`, gt);
  if (end < 0) return '';
  return chunk.slice(gt + 1, end).replace(/\s+/g, ' ').trim();
}

(async () => {
  const r = await fetch(url, { headers: { 'User-Agent': 'wenflow-research/1.0' } });
  const xml = await r.text();
  console.log(`# query=${q}  http=${r.status}  bytes=${xml.length}`);
  const entries = xml.split('<entry>').slice(1);
  if (entries.length === 0) {
    console.log(xml.slice(0, 400));
    return;
  }
  for (const e of entries) {
    const id = pick(e, 'id').replace(/^https?:\/\/arxiv\.org\/abs\//, '');
    const year = (pick(e, 'published') || '').slice(0, 4);
    console.log(`\n- ${pick(e, 'title')}  |  ${year}  |  ${id}`);
    console.log(`  ${pick(e, 'summary').slice(0, 340)}`);
  }
})().catch((err) => console.error('FAIL', err.message));
