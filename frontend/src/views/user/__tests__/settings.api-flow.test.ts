/**
 * 学员端「API 接入」流程对齐管理台（2026-11-08 走查）
 *
 * 管理台（admin-redesign/ApiConfig.vue）在 11-05~11-07 三轮走查里定下的三条口径，
 * 学员端 /user/settings 的 API 接入区此前都还是旧流程：
 *   ① 「获取模型」只拉列表不落盘，要再点一次「保存配置」——管理台判例「用户流程是
 *      填地址和 key → 获取模型，不该再要求点一次保存」（获取即保存）；
 *   ② 「保存配置」永远可点——管理台判例「脏了才出现，用户看不出这颗按钮存在」，
 *      改为常驻、无未保存改动时禁用 + title 说明；
 *   ③ 内置模式收起态只有一句「无需填写端点或密钥」，已保存的端点/密钥状态不显示，
 *      读成「之前配的全丢了」——补一段已保存事实摘要。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../Settings.vue'), 'utf8').replace(/\r\n/g, '\n');

describe('API 接入流程对齐管理台', () => {
  it('获取即保存：loadModels 成功后直接落盘，不要求再点一次保存', () => {
    expect(source).toMatch(/const saved = await saveApiConfig\(\{ silent: true \}\)/);
    expect(source).toMatch(/已保存配置，获取到 \$\{models\.length\} 个可用模型/);
  });

  it('保存常驻 + 脏检查：无未保存改动时禁用并给 title 说明', () => {
    expect(source).toContain(':disabled="busy || !formDirty"');
    expect(source).toContain("'没有未保存的改动'");
    /* 脏检查的判定域：端点/两个模型选择/新填的 Key（留空沿用不算改动） */
    expect(source).toMatch(/apiConfig\.endpoint !== savedSnapshot\.value\.endpoint/);
    expect(source).toMatch(/!!apiConfig\.apiKey\.trim\(\)/);
  });

  it('保存成功后刷新快照（否则保存按钮永远亮着）', () => {
    expect(source).toMatch(/snapshotSaved\(\);\n    return true;/);
    expect(source).toMatch(/snapshotSaved\(\);\n  } catch \{/);
  });

  it('内置模式收起态带已保存端点/密钥摘要（不再读成「配过的全丢了」）', () => {
    expect(source).toContain('已保存端点');
    expect(source).toContain("hasSavedApiKey ? '密钥已配置' : '未配置密钥'");
  });
});
