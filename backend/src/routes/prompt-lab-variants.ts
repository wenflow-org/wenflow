/**
 * Prompt Lab · A/B 实验变体子路由（2026-10-24 架构优化批 1：routes/prompt-lab.ts 拆分迁出）。
 *
 * 语义：ACTIVE 行集合 = 唯一基线（variant=NULL）+ 若干实验臂（variant 非空）。
 * 分流在运行时按 selectionKey 稳定分桶（agentConfigService.pickActivePromptRow）；
 * 归因走 prompt_call_logs.systemPromptVariant + systemPromptVersion（每次调用都落）。
 * 内容仍受 File-as-Truth 约束：变体只能克隆既有版本行；晋级会把该内容写回文件（同 rollback 协议）。
 * 由 prompt-lab 主路由 `router.use(...)` 挂载（同前缀 /api/admin/prompt-lab）。
 */
import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';
import { logger } from '../utils/logger';
import { withSystemTransaction } from '../utils/with-transaction';
import { getAPIGateway } from '../gateway/api-gateway';
import { promptCache } from '../services/cache/prompt-cache.service';
import { compileCoreFile } from '../services/prompt-lab/core-compiler';
import { resolveCoreSnapshot } from '../services/prompt-lab/core-version-snapshot';
import { writeTextPreservingEol } from '../utils/write-text-preserving-eol';
import { assertValidSkillId } from '../services/prompt-lab/manifest';
import {
  BACKUPS_DIR,
  VARIANT_KEY_RE,
  serializePublish,
  findActivePromptBriefFull,
  nextPromptVersionNumber,
} from '../services/prompt-lab/publish-flow';
import {
  findPromptVersionRow,
  findActivePromptBrief,
  listActivePromptRows,
  findPromptRowById,
  createPromptVariantRow,
  updatePromptVariantWeight,
  archivePromptRow,
  promoteVariantToBaselineTx,
  variantCallMetrics,
} from '../services/prompt-lab/prompt-lab-versions.repo';
import { setAuditAction, setAuditBefore, setAuditAfter } from '../middleware/audit-context';
import { PROMPTS_DIR } from '../composers/prompt-files/loader';
import { CORE_FILES_DIR } from '../services/prompt-lab/core-file-loader';

const router = Router();

/** GET /api/prompt-lab/variants/:skillId —— 基线 + 变体臂 + 近 7 天指标 */
router.get('/variants/:skillId', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const agentId = `skill:${skillId}`;
    const rows = await listActivePromptRows(agentId);
    const metrics = await variantCallMetrics(agentId, skillId, Date.now() - 7 * 24 * 3600 * 1000);
    const brief = (r: (typeof rows)[number]) => ({
      id: r.id,
      version: r.version,
      name: r.name,
      variant: r.variant,
      trafficWeight: r.trafficWeight,
      coreHash: r.coreHash,
      coreVersion: r.coreVersion,
      createdBy: r.createdBy,
      publishedAt: r.publishedAt,
      metrics: metrics[String(r.version)] ?? { calls: 0, successRate: null, avgDurationMs: null },
    });
    res.json({
      success: true,
      skillId,
      agentId,
      baseline: rows.filter((r) => !r.variant).map(brief)[0] ?? null,
      variants: rows.filter((r) => !!r.variant).sort((a, b) => String(a.variant).localeCompare(String(b.variant))).map(brief),
      bucketHashNote: '分桶键 = sha1(agentId + "\\n" + selectionKey) 前 8 hex % 100；selectionKey 优先 userId',
    });
  } catch (error) {
    res.status(500).json({ error: '读取变体失败', details: (error as Error).message });
  }
});

/**
 * POST /api/prompt-lab/variants/:skillId
 * body: { variant, weight, sourceVersion? } —— 克隆源版本（默认当前基线）为实验臂。
 * 内容零改写：只复制既有行；新内容必须先经协议发布链成为某个版本。
 */
router.post('/variants/:skillId', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const agentId = `skill:${skillId}`;
    const variant = String(req.body?.variant || '').trim();
    const weight = Number(req.body?.weight);
    const sourceVersion = req.body?.sourceVersion == null ? null : Number(req.body.sourceVersion);
    if (!VARIANT_KEY_RE.test(variant)) {
      return res.status(400).json({ error: 'variant 需为 1-8 位字母/数字/_-（如 B、B2）' });
    }
    if (!Number.isInteger(weight) || weight < 1 || weight > 99) {
      return res.status(400).json({ error: 'weight 需为 1-99 的整数（百分比）' });
    }

    await serializePublish(agentId, async () => {
      const active = await listActivePromptRows(agentId);
      if (!active.some((r) => !r.variant)) {
        return res.status(409).json({ error: '该 skill 没有 ACTIVE 基线版本，先发布一次再建变体' });
      }
      if (active.some((r) => r.variant === variant)) {
        return res.status(409).json({ error: `变体 ${variant} 已存在（同 agent 变体键唯一）` });
      }
      if (active.filter((r) => !!r.variant).length >= 4) {
        return res.status(409).json({ error: '实验臂上限 4 个（避免分流碎片化）' });
      }
      const source = sourceVersion == null
        ? await findActivePromptBriefFull(agentId)
        : await findPromptVersionRow(agentId, sourceVersion);
      if (!source) {
        return res.status(404).json({ error: `源版本不存在: ${sourceVersion == null ? '当前基线' : `v${sourceVersion}`}` });
      }
      const maxVersion = await nextPromptVersionNumber(agentId);
      const created = await createPromptVariantRow({
        id: uuidv4(),
        agentId,
        version: maxVersion,
        name: `${skillId} v${maxVersion} [变体${variant}]`,
        description: source.description ?? null,
        systemPrompt: source.systemPrompt,
        temperature: source.temperature ?? null,
        maxTokens: source.maxTokens ?? null,
        metadata: source.metadata ?? null,
        coreHash: source.coreHash ?? null,
        coreVersion: source.coreVersion ?? null,
        variant,
        trafficWeight: weight,
        createdBy: 'prompt-lab-variant',
      });
      try {
        promptCache.clearAgentCache(agentId);
        promptCache.clearAgentCache(skillId);
      } catch { /* 缓存清理失败不阻断 */ }
      setAuditAction(res, 'prompt-lab-variant-create', { targetType: 'skill', targetId: skillId });
      setAuditAfter(res, { variant, weight, fromVersion: source.version, newVersion: created.version, promptId: created.id });
      return res.json({ success: true, skillId, variant, weight, fromVersion: source.version, promptId: created.id, version: created.version });
    });
  } catch (error) {
    res.status(500).json({ error: '创建变体失败', details: (error as Error).message });
  }
});

/** PATCH /api/prompt-lab/variants/:id —— 调权重 */
router.patch('/variants/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const weight = Number(req.body?.weight);
    if (!Number.isInteger(weight) || weight < 1 || weight > 99) {
      return res.status(400).json({ error: 'weight 需为 1-99 的整数（百分比）' });
    }
    const row = await findPromptRowById(id);
    if (!row || !row.variant) return res.status(404).json({ error: '变体不存在' });
    if (row.status !== 'ACTIVE') return res.status(409).json({ error: '变体已停止，不能再调权重' });
    await updatePromptVariantWeight(id, weight);
    try {
      promptCache.clearAgentCache(row.agentId);
    } catch { /* ignore */ }
    setAuditAction(res, 'prompt-lab-variant-weight', { targetType: 'skill', targetId: row.agentId });
    res.json({ success: true, id, variant: row.variant, weight });
  } catch (error) {
    res.status(500).json({ error: '调整权重失败', details: (error as Error).message });
  }
});

/** POST /api/prompt-lab/variants/:id/stop —— 停止实验臂（ARCHIVED，历史留档） */
router.post('/variants/:id/stop', async (req, res) => {
  try {
    const id = String(req.params.id);
    const row = await findPromptRowById(id);
    if (!row || !row.variant) return res.status(404).json({ error: '变体不存在' });
    if (row.status !== 'ACTIVE') return res.status(409).json({ error: '变体已停止' });
    await archivePromptRow(id);
    try {
      promptCache.clearAgentCache(row.agentId);
    } catch { /* ignore */ }
    setAuditAction(res, 'prompt-lab-variant-stop', { targetType: 'skill', targetId: row.agentId });
    setAuditBefore(res, { variant: row.variant, version: row.version, weight: row.trafficWeight });
    res.json({ success: true, id, variant: row.variant, stopped: true });
  } catch (error) {
    res.status(500).json({ error: '停止变体失败', details: (error as Error).message });
  }
});

/**
 * POST /api/prompt-lab/variants/:id/promote —— 晋级为基线（内容写回文件，同回滚协议）。
 * 晋级 = 把该变体内容变成唯一基线：文件 SSOT 写回 → 变体转基线 → 旧基线归档；其余实验臂继续服役。
 */
router.post('/variants/:id/promote', async (req, res) => {
  try {
    const id = String(req.params.id);
    const row = await findPromptRowById(id);
    if (!row || !row.variant) return res.status(404).json({ error: '变体不存在' });
    if (row.status !== 'ACTIVE') return res.status(409).json({ error: '变体已停止，不能晋级' });
    const skillId = assertValidSkillId(row.agentId.replace(/^skill:/, ''));
    const agentId = row.agentId;

    // 与回滚同协议：内容必须可由 coreSnapshot 确定性重建（禁止 DB 单边内容成为文件 SSOT）
    const snapshot = resolveCoreSnapshot(row.metadata, skillId);
    if (!snapshot.core || !snapshot.raw) {
      return res.status(409).json({ error: '变体缺少可验证的 core 快照，拒绝晋级', code: 'VARIANT_CORE_SNAPSHOT_REQUIRED' });
    }
    const compiled = compileCoreFile(snapshot.core, { coreVersion: row.coreVersion ?? 1 });
    if (row.coreHash && row.coreHash !== compiled.coreHash) {
      return res.status(409).json({ error: '变体 coreHash 与 coreSnapshot 不一致，拒绝晋级', code: 'VARIANT_CORE_HASH_MISMATCH' });
    }
    if (row.systemPrompt.trim() !== compiled.body.trim()) {
      return res.status(409).json({ error: '变体内容不可由 coreSnapshot 确定性重建，拒绝晋级', code: 'VARIANT_PROMPT_MISMATCH' });
    }

    await serializePublish(agentId, async () => {
      const activeBefore = await findActivePromptBrief(agentId);
      setAuditAction(res, 'prompt-lab-variant-promote', { targetType: 'skill', targetId: skillId });
      setAuditBefore(res, activeBefore ?? null);

      // 1) 文件回写（SSOT 恢复）
      const prodPath = path.join(PROMPTS_DIR, `skill.${skillId}.md`);
      const corePath = path.join(CORE_FILES_DIR, `${skillId}.yaml`);
      try {
        const backupsDir = path.join(BACKUPS_DIR, skillId);
        await fs.mkdir(backupsDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        await fs.copyFile(prodPath, path.join(backupsDir, `${ts}.md`));
        await fs.copyFile(corePath, path.join(backupsDir, `core-${ts}.yaml`));
      } catch { /* 备份失败不阻塞 */ }
      await writeTextPreservingEol(corePath, snapshot.raw);
      await writeTextPreservingEol(prodPath, compiled.prompt);

      // 2) ACTIVE 翻转：变体转基线 → 旧基线归档
      await withSystemTransaction(async (tx) => {
        await promoteVariantToBaselineTx(tx, id);
        await tx.agent_prompts.updateMany({
          where: { agentId, status: 'ACTIVE', variant: null, id: { not: id } },
          data: { status: 'ARCHIVED', updatedAt: new Date() },
        });
      });

      // 3) 缓存清理
      try {
        promptCache.clearAgentCache(agentId);
        promptCache.clearAgentCache(skillId);
        getAPIGateway().invalidateCache(undefined, undefined, skillId);
        getAPIGateway().invalidateCache(undefined, agentId);
      } catch (cacheErr: any) {
        logger.warn('Failed to invalidate prompt/gateway cache:', { error: cacheErr?.message || String(cacheErr) });
      }

      setAuditAfter(res, { id, version: row.version, variantPromoted: row.variant, status: 'ACTIVE' });
      return res.json({ success: true, skillId, promoted: true, variant: row.variant, version: row.version });
    });
  } catch (error) {
    console.error('Variant promote error:', error);
    res.status(500).json({ error: '晋级变体失败', details: (error as Error).message });
  }
});

export default router;
