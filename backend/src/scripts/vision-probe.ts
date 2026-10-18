/**
 * vision:probe —— 模型视觉能力探针（2026-10-18 #123）。
 *
 * 背景：网关端点不提供能力声明（`GET /v1/models` 只有 supported_endpoint_types），
 * 「这个模型能不能读图」只能由本仓注册表声明（llm-providers.json `vision: true`）+ 本脚本实测把关。
 *
 * 用法：
 *   npm --prefix backend run vision:probe                      # 探测注册表里所有声明 vision 的模型
 *   npm --prefix backend run vision:probe -- --model=deepseek-v4.1-flash
 *   npm --prefix backend run vision:probe -- --image=./some.png   # 用真实图片（png/jpg/jpeg/webp）
 *
 * 判据（对内置确定性图案：左红块 / 中绿块（只有上半）/ 右蓝块（最宽））：
 *   1. 三种颜色都读到（中英文任一）；2. 提到「最宽/更宽」；3. 提到中间块「更短/半高/只有上半」。
 * 三项全中 = PASS；否则 FAIL（原文照打，便于人工复核）。
 *
 * 走真实调用链（getAPIGateway）：既验证网关多模态组装，也验证视觉闸门：
 * 未声明 vision 的模型会在此被明确拒绝（MODEL_VISION_UNSUPPORTED），而不是静默丢图或上游 400。
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { deflateSync } from 'zlib';
import { getAPIGateway } from '../gateway/api-gateway';
import { MODEL_MAP } from '../config/models.config';

// ---------- 极简 PNG 编码（无依赖：zlib + CRC32；仅 8-bit RGB truecolor） ----------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 确定性图案（400×144）：左红块（**最窄** 60px）/ 中绿块（**最宽** 220px）/ 右蓝块（120px），全部等高。
 * 四个"只有图里才有"的事实：颜色顺序（红→绿→蓝）、最宽在中间、最窄在左、蓝比红宽。
 * 不用"左右等宽"作为事实：等宽属于难以判定的细粒度比较，模型（含真实视觉模型）会读飘；
 * 60/220/120 的宽窄三档差异大、判据稳。
 */
export function buildProbeImagePng(): Buffer {
  const width = 400;
  const height = 144;
  return encodePng(width, height, (x: number) => {
    if (x < 60) return [220, 40, 40]; // 左：红（最窄）
    if (x < 280) return [40, 200, 60]; // 中：绿（最宽）
    return [40, 80, 230]; // 右：蓝（中间档）
  });
}

// ---------- 判据 ----------

const COLOR_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'red', re: /红|red/i },
  { label: 'green', re: /绿|green/i },
  { label: 'blue', re: /蓝|blue/i },
];

export interface VisionProbeVerdict {
  pass: boolean;
  checks: { colors: boolean; order: boolean; widestGreen: boolean; narrowestRed: boolean };
  text: string;
}

/** 对探针回答做判据（导出供单测） */
export function judgeVisionProbeAnswer(answer: string): VisionProbeVerdict {
  const text = String(answer || '');
  const positions = COLOR_PATTERNS.map(({ re }) => {
    const match = text.match(re);
    return match ? match.index ?? -1 : -1;
  });
  const colors = positions.every((index) => index >= 0);
  const order = colors && positions[0] < positions[1] && positions[1] < positions[2];
  // 最宽必须**落在绿色上**、最窄落在红色上（不是"提到了这两个词"）：对错都能判
  const widestGreen = /(绿|green)[^。；;\n]{0,24}(最宽|widest)|(最宽|widest)[^。；;\n]{0,24}(绿|green)/i.test(text);
  const narrowestRed = /(红|red)[^。；;\n]{0,24}(最窄|最细|最瘦|narrowest)|(最窄|最细|最瘦|narrowest)[^。；;\n]{0,24}(红|red)/i.test(text);
  return {
    pass: colors && order && widestGreen && narrowestRed,
    checks: { colors, order, widestGreen, narrowestRed },
    text,
  };
}

// ---------- 主流程 ----------

export function parseProbeArgs(argv: string[]): { models: string[]; image?: string; stream: boolean; historyImage: boolean } {
  const models: string[] = [];
  let image: string | undefined;
  let stream = false;
  let historyImage = false;
  for (const arg of argv) {
    if (arg.startsWith('--model=')) models.push(arg.slice('--model='.length).trim());
    else if (arg.startsWith('--image=')) image = arg.slice('--image='.length).trim();
    else if (arg === '--stream') stream = true;
    else if (arg === '--history-image') historyImage = true;
  }
  return { models, image, stream, historyImage };
}

function mimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

const PROBE_QUESTION =
  '看这张图，只描述你实际看到的画面，分三点简答：'
  + '(1) 从左到右有哪些颜色的色块？'
  + '(2) 哪个色块最宽？'
  + '(3) 哪个色块最窄？'
  + '不要猜测用途。';

/** 走真实网关调用：请求/身份/上下文由调用方组装好，本函数只转发（网关内含视觉闸门与上游请求组装）。 */
type GatewayLike = { execute: (...args: unknown[]) => Promise<{ choices?: Array<{ message?: { content?: string } }> }> };

async function dispatchProbeRequest(gateway: unknown, request: unknown, caller: unknown, context: unknown) {
  return (gateway as GatewayLike).execute(request, caller, context);
}

/** 对单个模型发一次带图请求；返回判据结果或闸门/上游错误 */
async function runProbeForModel(
  model: string,
  imageDataUrl: string,
  options: { stream?: boolean; historyImage?: boolean } = {}
): Promise<VisionProbeVerdict | { error: string }> {
  const probeRequest = {
    model,
    temperature: 0,
    max_tokens: 400,
    // 默认非流式（探针要的是确定性）；--stream 复现真实链路（callPrompt 默认全流）
    ...(options.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    ...(options.historyImage
      // 课堂真实形态：图片挂在**历史 assistant 消息**上（教师板书图），当前轮 user 提问
      ? {
          messages: [
            { role: 'user', content: '老师，我们看这个。' },
            {
              role: 'assistant',
              content: [
                { type: 'text', text: '看这张图' },
                { type: 'text', text: '【课堂配图】核对框架' },
                { type: 'image_url', image_url: { url: imageDataUrl } },
              ],
            },
            { role: 'user', content: [{ type: 'text', text: PROBE_QUESTION }] },
          ],
        }
      : {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: PROBE_QUESTION },
                { type: 'image_url', image_url: { url: imageDataUrl } },
              ],
            },
          ],
        }),
  };
  const caller = { skillId: 'vision-probe', action: 'vision-capability-probe' };
  const context = { traceId: `vision-probe-${process.pid}-${model}` };
  try {
    const response = await dispatchProbeRequest(getAPIGateway(), probeRequest, caller, context);
    const answer = response?.choices?.[0]?.message?.content || '';
    return judgeVisionProbeAnswer(answer);
  } catch (error: unknown) {
    const record = (error ?? {}) as { code?: string; name?: string; message?: string };
    return { error: `${record.code || record.name || 'ERROR'}: ${record.message || String(error)}` };
  }
}

async function main(): Promise<void> {
  const { models: requested, image, stream, historyImage } = parseProbeArgs(process.argv.slice(2));
  const declared = Array.from(MODEL_MAP.values()).filter((model) => model.vision === true).map((model) => model.id);
  const targets = requested.length > 0 ? requested : declared;
  if (targets.length === 0) {
    console.error('[vision:probe] 注册表里没有任何声明 vision 的模型；用 --model=<id> 指定待测模型');
    process.exitCode = 1;
    return;
  }

  const probeImageDataUrl = image
    ? `data:${mimeFromPath(image)};base64,${readFileSync(image).toString('base64')}`
    : `data:image/png;base64,${buildProbeImagePng().toString('base64')}`;
  console.log(`[vision:probe] 探针图片：${image ? image : '内置确定性图案（左红最窄 60px / 中绿最宽 220px / 右蓝 120px，等高）'}`);
  console.log(`[vision:probe] 待测模型：${targets.join(', ')}`);

  let failed = 0;
  for (const model of targets) {
    const startedAt = Date.now();
    const result = await runProbeForModel(model, probeImageDataUrl, { stream, historyImage });
    const elapsed = Date.now() - startedAt;
    if ('error' in result) {
      failed += 1;
      console.error(`[vision:probe] FAIL ${model}（${elapsed}ms）→ ${result.error}`);
      continue;
    }
    const checks = result.checks;
    console.log(
      `[vision:probe] ${result.pass ? 'PASS' : 'FAIL'} ${model}（${elapsed}ms）`
      + ` 颜色=${checks.colors ? '√' : '×'} 顺序=${checks.order ? '√' : '×'}`
      + ` 最宽=绿${checks.widestGreen ? '√' : '×'} 最窄=红${checks.narrowestRed ? '√' : '×'}`
    );
    console.log(`[vision:probe]   回答原文：${result.text.replace(/\s+/g, ' ').slice(0, 500)}`);
    if (!result.pass) failed += 1;
  }
  console.log(failed === 0
    ? `[vision:probe] 全部通过（${targets.length} 个模型）`
    : `[vision:probe] ${failed}/${targets.length} 个模型未通过`);
  process.exitCode = failed === 0 ? 0 : 1;
}

// 直接运行时执行；被 import（如单测）时只暴露纯函数，不发起真实调用
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`[vision:probe] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
