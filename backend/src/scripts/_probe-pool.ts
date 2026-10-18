/* eslint-disable @typescript-eslint/no-explicit-any -- 探针：上游响应 JSON 载荷形状动态（对齐 probe-*.ts 先例） */
/** _probe-pool.ts — 直连平台上游探针：连打 N 次极短请求，量成功率与延迟（判定池子此刻健康度）。 */
import apiConfigService from '../services/apiConfig.service';

async function main() {
  const cfg: any = await apiConfigService.getConfig();
  const base = String(cfg.apiUrl || '').replace(/\/$/, '');
  const endpoint = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const key = String(cfg.apiKey || '');
  const model = String(process.argv[3] || 'deepseek-v4.1-flash');
  console.log(`[probe] endpoint=${endpoint} model=${model}`);
  const N = Number(process.argv[2] || 5);
  let ok = 0; const lat: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: '只回复一个词：好' }], max_tokens: 3000 }),
        signal: AbortSignal.timeout(60000),
      });
      const dt = Date.now() - t0;
      const j: any = await res.json().catch(() => ({}));
      const content = j?.choices?.[0]?.message?.content ?? ''; const fr = j?.choices?.[0]?.finish_reason; const rt = j?.usage?.completion_tokens_details?.reasoning_tokens;
      const good = res.status === 200 && String(content).trim().length > 0;
      if (good) ok++;
      lat.push(dt);
      console.log(`  #${i + 1} http=${res.status} ${(dt / 1000).toFixed(1)}s ${good ? 'OK' : 'EMPTY/ERR'} fr=${fr} rt=${rt} len=${String(content).length} "${String(content).slice(0, 30)}"`);
    } catch (e: any) {
      const dt = Date.now() - t0;
      lat.push(dt);
      console.log(`  #${i + 1} THROW ${(dt / 1000).toFixed(1)}s ${String(e?.message || e).slice(0, 60)}`);
    }
  }
  console.log(`[probe] ${ok}/${N} ok; lat median=${(lat.sort((a, b) => a - b)[Math.floor(lat.length / 2)] / 1000).toFixed(1)}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
