/**
 * 预制学习者的**附件夹具注入**：VL 跑批时，在起 Goal 对话之前把预设声明的夹具文件
 * 落成该用户的「已上传资料」，用于覆盖「附件 → 路径 → 任务 → 课堂（materialRefs）」这条链。
 *
 * 口径：
 *   - 夹具来自预设的 `fixtureMaterials: [{ file, note }]`（见 `virtual-learners/presets.yaml`），
 *     随 profile JSON 落库（`virtual_learner_profiles.profile.fixtureMaterials`）；
 *   - **幂等**：同名同大小已存在则跳过（重复跑批不会堆副本）；
 *   - **fail-open**：单份失败只告警，不阻断跑批（与 VL 其它 best-effort 一致）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger';
import prisma from '../config/database';
import { listMaterials } from '../services/materials/material-store';
import { saveUploadedMaterial } from '../services/materials/material-upload.service';

export interface FixtureMaterialSpec {
  file: string;
  note?: string | null;
}

export interface FixtureUploadResult {
  uploaded: string[];
  skipped: string[];
  errors: Array<{ file: string; message: string }>;
}

/** 仓库根目录（夹具路径按仓库相对路径书写，如 `text/xxx.pptx`）。 */
function repoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

/**
 * 注入一组夹具（纯 IO + 落盘，不读 DB ⇒ 可单测）。
 * 已存在同名同大小的资料 → 跳过（幂等）。
 */
export async function ensureFixtureMaterialsUploaded(input: {
  userId: string;
  fixtures: FixtureMaterialSpec[] | null | undefined;
}): Promise<FixtureUploadResult> {
  const result: FixtureUploadResult = { uploaded: [], skipped: [], errors: [] };
  const fixtures = Array.isArray(input.fixtures) ? input.fixtures : [];
  if (!fixtures.length) return result;

  let existingNames = new Set<string>();
  try {
    existingNames = new Set(listMaterials(input.userId).map((record) => `${record.name}|${record.size}`));
  } catch {
    // 列表失败不阻断：当作"都没上传过"，由 saveUploadedMaterial 自己处理
  }

  for (const fixture of fixtures) {
    const file = String(fixture?.file || '').trim();
    if (!file) continue;
    const absolute = path.isAbsolute(file) ? file : path.join(repoRoot(), file);
    try {
      const buffer = fs.readFileSync(absolute);
      const name = path.basename(file);
      if (existingNames.has(`${name}|${buffer.byteLength}`)) {
        result.skipped.push(name);
        continue;
      }
      const saved = await saveUploadedMaterial({ userId: input.userId, originalName: name, buffer });
      if (saved.ok) {
        result.uploaded.push(name);
        existingNames.add(`${name}|${buffer.byteLength}`);
      } else {
        result.errors.push({ file: name, message: saved.message || String(saved.reason || '被拒收') });
      }
    } catch (error) {
      result.errors.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (result.uploaded.length || result.errors.length) {
    logger.info('[vlab-fixtures] 附件夹具注入完成', {
      userId: input.userId,
      uploaded: result.uploaded,
      skipped: result.skipped.length,
      errors: result.errors,
    });
  }
  return result;
}

/** 读该虚拟学习者 profile 里声明的夹具（读不到 → 空数组）。 */
export async function loadProfileFixtureMaterials(virtualProfileId: string): Promise<FixtureMaterialSpec[]> {
  try {
    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { id: virtualProfileId },
      select: { profile: true },
    });
    if (!profile?.profile) return [];
    const parsed = JSON.parse(profile.profile) as Record<string, unknown>;
    const fixtures = parsed?.fixtureMaterials;
    if (!Array.isArray(fixtures)) return [];
    const specs: FixtureMaterialSpec[] = [];
    for (const item of fixtures) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const file = String(record.file || '').trim();
      if (!file) continue;
      specs.push({ file, note: record.note ? String(record.note) : null });
    }
    return specs;
  } catch (error) {
    logger.warn('[vlab-fixtures] 读取夹具声明失败（跳过注入）', {
      virtualProfileId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** 跑批入口用：按会话的 VL 身份注入夹具（fail-open）。 */
export async function ensureFixtureMaterialsForVirtualSession(session: {
  userId: string;
  virtualProfileId?: string | null;
}): Promise<FixtureUploadResult> {
  if (!session?.userId || !session?.virtualProfileId) {
    return { uploaded: [], skipped: [], errors: [] };
  }
  try {
    const fixtures = await loadProfileFixtureMaterials(String(session.virtualProfileId));
    return await ensureFixtureMaterialsUploaded({ userId: session.userId, fixtures });
  } catch (error) {
    logger.warn('[vlab-fixtures] 夹具注入失败（不阻断跑批）', {
      userId: session.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { uploaded: [], skipped: [], errors: [] };
  }
}
