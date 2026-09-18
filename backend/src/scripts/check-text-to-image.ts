/**
 * image:check —— 文生图冒烟脚本（验证外挂能力 text-to-image 可真实调用）。
 *
 * 用法：
 *   npm --prefix backend run image:check
 *   npm --prefix backend run image:check -- "一只红苹果，白底棚拍" 1024x1024
 *
 * 退出码：成功 0；失败 1（并打印 ImageError 的 code，便于区分未配置 / 上游故障）。
 */

import 'dotenv/config';
import { generateImages, ImageError } from '../services/image';

function readArgs(): { prompt: string; size?: string } {
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  return {
    prompt: positional[0]?.trim() || 'a red apple on a white table, studio photo',
    size: positional[1]?.trim(),
  };
}

async function main(): Promise<void> {
  const { prompt, size } = readArgs();
  const startedAt = Date.now();
  const result = await generateImages({ prompt, size });

  console.log(
    `[image:check] OK provider=${result.provider} model=${result.model} 生成 ${result.images.length} 张` +
      `（尝试链 ${result.attempts.join(' -> ') || '-'}，${Date.now() - startedAt}ms）`
  );
  for (const [index, image] of result.images.entries()) {
    if (image.url) console.log(`  #${index + 1} url=${image.url}`);
    else if (image.b64Json) console.log(`  #${index + 1} b64_json（${image.b64Json.length} 字符）`);
    else console.log(`  #${index + 1} （空）`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof ImageError) {
    console.error(`[image:check] FAIL ${error.code}: ${error.message}`);
  } else {
    console.error(`[image:check] FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
});
