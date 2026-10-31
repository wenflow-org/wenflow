/**
 * Prompt Lab API Routes（HTTP 壳）
 * 提供蓝图编译、Compiler Skill 等功能。
 *
 * 2026-10-24 架构优化批 1 拆分：业务实现迁至 src/services/prompt-lab/——
 * - manifest.ts            prompts/manifests 读写与 sanitize
 * - publish-flow.ts        发布互斥/版本号段/含义冻结入口/备份目录
 * - skill-field-{shared,add,edit,delete}.ts   字段原子编辑引擎（加/改/删）
 * - ../routes/prompt-lab-variants.ts          A/B 变体子路由（本文件末尾挂载）
 * 本文件只保留路由处理器与 HTTP 错误映射；引擎导出符号再导出以兼容既有引用。
 */

import { Router, type Request } from 'express';
import { rejectPromptLabFileMutation } from '../middleware/prompt-file-truth.middleware';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';
import { logger } from '../utils/logger';
import { withSystemTransaction } from '../utils/with-transaction';
import { getAPIGateway } from '../gateway/api-gateway';
import { promptCache } from '../services/cache/prompt-cache.service';
import { parsePromptFrontmatterMeta, PROMPTS_DIR } from '../composers/prompt-files/loader';
import {
  compileCoreFile,
  checkFiveBlockStructure,
  checkFieldFreeze,
  buildV4CompileSpecText,
} from '../services/prompt-lab/core-compiler';
import { loadCoreFile, scanCoreFiles, computeCoreHash, parseCoreFile, CORE_FILES_DIR } from '../services/prompt-lab/core-file-loader';
import { normalizeCoreFormInput, serializeCoreFile, extractHeaderComment, coreFileSemanticallyEqual } from '../services/prompt-lab/core-yaml-writer';
import { readFileEol, withEol, writeTextPreservingEol } from '../utils/write-text-preserving-eol';
import { getFieldLineageWithDeclarations, classifyCoreEdit } from '../services/prompt-lab/field-lineage';
import { decideSemanticGate } from '../services/prompt-lab/semantic-freeze-judge';
import { buildV4CorePromptMetadata } from '../services/prompt-lab/core-prompt-metadata';
import { normalizeDeveloperApproval, resolveCoreSnapshot } from '../services/prompt-lab/core-version-snapshot';
import { checkInputHandoffs } from '../services/prompt-lab/input-handoff-check';
import { setAuditAction, setAuditBefore, setAuditAfter } from '../middleware/audit-context';
import {
  findActivePromptMetadata,
  listCoreVersionHistory,
  findPromptVersionRow,
  findActivePromptBrief,
  archiveOtherActivePrompts,
  activateAgentPrompt,
  listActivePromptRows,
} from '../services/prompt-lab/prompt-lab-versions.repo';
import { assertValidSkillId, loadManifest, writeManifest } from '../services/prompt-lab/manifest';
import {
  BACKUPS_DIR,
  VARIANT_KEY_RE,
  nextCoreVersion,
  serializePublish,
  runSemanticGate,
} from '../services/prompt-lab/publish-flow';
import { serializeFieldAdd, SkillFieldAddError, SkillFieldEditError } from '../services/prompt-lab/skill-field-shared';
import { addSkillFieldToCoreAndOrchestration } from '../services/prompt-lab/skill-field-add';
import { updateSkillFieldInCoreAndOrchestration } from '../services/prompt-lab/skill-field-edit';
import { deleteSkillFieldFromCoreAndOrchestration } from '../services/prompt-lab/skill-field-delete';
import promptLabVariantsRouter from './prompt-lab-variants';

// 兼容再导出：既有引用方（脚本/测试）继续从本文件取引擎符号
export {
  serializeFieldAdd,
  SkillFieldAddError,
  SkillFieldEditError,
  addSkillFieldToCoreAndOrchestration,
  updateSkillFieldInCoreAndOrchestration,
  deleteSkillFieldFromCoreAndOrchestration,
};
export type {
  SkillFieldAddRequest,
  SkillFieldAddResult,
  SkillFieldUpdateRequest,
  SkillFieldUpdateResult,
  SkillFieldDeleteResult,
  SkillFieldSnapshot,
} from '../services/prompt-lab/skill-field-shared';

const router = Router();
router.use(rejectPromptLabFileMutation);

/**
 * GET /api/prompt-lab/manifest/:skillId
 * 获取 Prompt Lab manifest
 */
router.get('/manifest/:skillId', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const { exists, manifest } = await loadManifest(skillId, '');
    res.json({ success: true, exists, data: manifest });
  } catch (error) {
    res.status(500).json({ error: '读取 manifest 失败', details: (error as Error).message });
  }
});

/**
 * PUT /api/prompt-lab/manifest/:skillId
 * 保存 Prompt Lab manifest
 */
router.put('/manifest/:skillId', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const incoming = req.body?.manifest ?? req.body ?? {};

    const { manifest: currentManifest } = await loadManifest(skillId, '');
    const nextManifest = {
      ...currentManifest,
      ...incoming,
      publish: {
        ...currentManifest.publish,
        ...(incoming.publish || {})
      },
      // runtimeDefaults 已废弃（P0-1）：不再合并/写入；参数唯一写源 = core.yaml params
      runtimeContract: {
        ...currentManifest.runtimeContract,
        ...(incoming.runtimeContract || {}),
        businessState: {
          ...currentManifest.runtimeContract.businessState,
          ...(incoming.runtimeContract?.businessState || {})
        },
        contextUpdate: {
          ...currentManifest.runtimeContract.contextUpdate,
          ...(incoming.runtimeContract?.contextUpdate || {})
        }
      },
      promptContract: {
        ...currentManifest.promptContract,
        ...(incoming.promptContract || {}),
        input: {
          ...currentManifest.promptContract.input,
          ...(incoming.promptContract?.input || {})
        },
        output: {
          ...currentManifest.promptContract.output,
          ...(incoming.promptContract?.output || {})
        },
        context: {
          ...currentManifest.promptContract.context,
          ...(incoming.promptContract?.context || {})
        }
      },
      ownership: {
        ...currentManifest.ownership,
        ...(incoming.ownership || {})
      },
      acceptableAgentIds: incoming.acceptableAgentIds ?? currentManifest.acceptableAgentIds,
      tags: incoming.tags ?? currentManifest.tags,
      notes: incoming.notes ?? currentManifest.notes
    };

    const savedManifest = await writeManifest(skillId, nextManifest, '');
    res.json({ success: true, data: savedManifest });
  } catch (error) {
    res.status(500).json({ error: '保存 manifest 失败', details: (error as Error).message });
  }
});

/**
 * GET /api/prompt-lab/compile-spec
 * 获取编译约定文档（v4 五块约定，由平台常量生成）
 */
router.get('/compile-spec', async (req, res) => {
  try {
    res.json({ success: true, data: buildV4CompileSpecText() });
  } catch (error) {
    res.status(500).json({ error: '读取失败', details: (error as Error).message });
  }
});

/**
 * POST /api/prompt-lab/compile-core
 * v4：核心文件（prompts/core/<skillId>.yaml）确定性编译预览（dry run，不写文件/DB）
 * 守门：结构合法 + 字段冻结 + 含义冻结（semanticJudge:false 可跳过第三查）
 */
router.post('/compile-core', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.body?.skillId);
    const loaded = loadCoreFile(skillId);
    if (!loaded) {
      return res.status(404).json({ error: `核心文件不存在: prompts/core/${skillId}.yaml` });
    }
    if (!loaded.core) {
      return res.status(400).json({ error: '核心文件 schema 不合法', diagnostics: loaded.diagnostics });
    }

    const coreVersion = await nextCoreVersion(`skill:${skillId}`);
    const compiled = compileCoreFile(loaded.core, { coreVersion });
    const gates: Record<string, unknown> = {
      structure: checkFiveBlockStructure(compiled.prompt),
      fieldFreeze: checkFieldFreeze(loaded.core, compiled.prompt),
      // inputs 声明 ↔ handoff 对账（advisory，不影响 gatePassed）
      inputHandoff: await checkInputHandoffs(loaded.core)
    };
    const semantic = await runSemanticGate(skillId, compiled.prompt, req.body?.semanticJudge === false);
    if (semantic) {
      gates.semantic = semantic;
      gates.semanticDecision = decideSemanticGate(semantic, { confirmUncertain: req.body?.confirmUncertain === true });
    }

    res.json({
      success: true,
      skillId,
      compiler: 'core-deterministic-v4',
      prompt: compiled.prompt,
      coreHash: compiled.coreHash,
      coreVersion: compiled.coreVersion,
      gates,
      gatePassed:
        (gates.structure as unknown[]).length === 0 &&
        (gates.fieldFreeze as unknown[]).length === 0 &&
        (!semantic || decideSemanticGate(semantic, { confirmUncertain: req.body?.confirmUncertain === true }) === 'pass')
    });
  } catch (error) {
    console.error('Core compile error:', error);
    res.status(500).json({ error: '编译失败', details: (error as Error).message });
  }
});

/**
 * POST /api/prompt-lab/publish-core
 * v4：核心文件 → 确定性编译 → 守门检查 → 发布
 * 顺序（H1 原子性）：① 全部校验（含 manifest/哈希预检）→ ② 同一事务内 DB create + 旧 ACTIVE 归档 → ③ 最后写文件（temp + rename 原子替换）
 * 说明：v4 产物为确定性渲染，不经 compilePrompt LLM 改写；不回写 skill_model_configs（路由配置不动）
 */
router.post('/publish-core', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.body?.skillId);
    const agentId = `skill:${skillId}`;
    // H2：同 skill 的发布按 agentId 串行化（进程内互斥），
    // 防止并发发布算出相同 coreVersion/version 撞 @@unique([agentId, version]) 返回 500。
    await serializePublish(agentId, async () => {
      const loaded = loadCoreFile(skillId);
      if (!loaded) {
        return res.status(404).json({ error: `核心文件不存在: prompts/core/${skillId}.yaml` });
      }
      if (!loaded.core) {
        return res.status(400).json({ error: '核心文件 schema 不合法', diagnostics: loaded.diagnostics });
      }
      const core = loaded.core;

      // 【A/B 2026-10-01】asVariant：把本次 core.yaml 的**新内容**直接发布为实验臂
      //（不替换基线、不写 skill.md——基线与文件保持 SSOT 一致；晋级经 /variants/:id/promote 写回）。
      const asVariantRaw = req.body?.asVariant;
      const asVariant = asVariantRaw && typeof asVariantRaw === 'object'
        ? { variant: String(asVariantRaw.variant || '').trim(), weight: Number(asVariantRaw.weight) }
        : null;
      if (asVariant) {
        if (!VARIANT_KEY_RE.test(asVariant.variant)) {
          return res.status(400).json({ error: 'asVariant.variant 需为 1-8 位字母/数字/_-' });
        }
        if (!Number.isInteger(asVariant.weight) || asVariant.weight < 1 || asVariant.weight > 99) {
          return res.status(400).json({ error: 'asVariant.weight 需为 1-99 的整数（百分比）' });
        }
      }

      const coreVersion = await nextCoreVersion(agentId);
      const compiled = compileCoreFile(core, { coreVersion });
      const gates: Record<string, unknown> = {
        structure: checkFiveBlockStructure(compiled.prompt),
        fieldFreeze: checkFieldFreeze(core, compiled.prompt),
        // inputs 声明 ↔ handoff 对账（advisory，不参与阻断）
        inputHandoff: await checkInputHandoffs(core)
      };
      const structuralIssues = [
        ...(gates.structure as Array<unknown>),
        ...(gates.fieldFreeze as Array<unknown>)
      ];
      if (structuralIssues.length > 0) {
        return res.status(422).json({ error: '守门检查未通过，已阻断发布', gates, issues: structuralIssues });
      }

      // 字段结构变更以 ACTIVE 版本的 coreSnapshot 为基准，而不是磁盘当前 core。
      // 这样 staging 后的重复保存也不能把 blocked/restricted 变成安全修改。
      const activeForClassification = await findActivePromptMetadata(agentId);
      let classification: ReturnType<typeof classifyCoreEdit> = {
        level: 'safe',
        messages: ['首次发布核心文件'],
      };
      if (activeForClassification) {
        const activeSnapshot = resolveCoreSnapshot(activeForClassification.metadata, skillId);
        if (!activeSnapshot.core) {
          return res.status(409).json({
            error: activeSnapshot.error,
            code: 'ACTIVE_CORE_SNAPSHOT_REQUIRED',
          });
        }
        classification = classifyCoreEdit(activeSnapshot.core, core);
      }
      const developerApproval = normalizeDeveloperApproval(req.body?.developerApproval);
      if (classification.level !== 'safe' && !developerApproval) {
        return res.status(422).json({
          error: classification.level === 'blocked'
            ? '字段删除或类型变更必须先同步消费者，并提供开发确认引用后才能发布'
            : '新增字段必须经开发确认消费者接入后才能发布',
          code: 'STRUCTURAL_CHANGE_REQUIRES_DEVELOPER_APPROVAL',
          classification,
        });
      }

      // 发布不可绕过含义冻结；结构审批未完成时不消耗 LLM judge 调用。
      const semantic = await runSemanticGate(skillId, compiled.prompt, false);
      let semanticDecision: string | null = null;
      if (semantic) {
        gates.semantic = semantic;
        semanticDecision = decideSemanticGate(semantic, { confirmUncertain: req.body?.confirmUncertain === true });
        gates.semanticDecision = semanticDecision;
        if (semanticDecision === 'block-divergent') {
          return res.status(422).json({
            error: '含义冻结未通过：编译产物与核心文件语义不等价，已阻断发布',
            gates,
            issues: semantic.findings
          });
        }
        if (semanticDecision === 'needs-confirm') {
          return res.status(409).json({
            error: '含义冻结判定不确定，需人工确认（确认无误后以 confirmUncertain: true 重新发布）',
            code: 'SEMANTIC_UNCERTAIN',
            gates,
            judgement: semantic
          });
        }
      }

      // H1 ① 全部校验前置：manifest/核心文件哈希预检在写文件、写库之前完成，
      // 失败直接阻断，杜绝"文件已写盘、DB 未写"造成的文件与 DB ACTIVE 永久分叉。
      let metadata: string;
      let metadataWarning: string | null = null;
      try {
        metadata = buildV4CorePromptMetadata({
          skillId,
          coreHash: compiled.coreHash,
          coreVersion: compiled.coreVersion,
          deltaOutput: core.deltaOutput && core.outputMedia === 'json',
          ...(developerApproval ? { developerApprovalReference: developerApproval.reference } : {}),
        });
      } catch (error) {
        return res.status(422).json({
          error: '发布前校验未通过（manifest 或核心文件哈希校验失败），未写入任何数据',
          code: 'PUBLISH_PREFLIGHT_FAILED',
          details: (error as Error).message,
        });
      }
      // manifest 缺失不再抛错（降级为警告）：metadata 携带 manifest-missing 标记
      const metadataInfo = JSON.parse(metadata) as { promptLab?: { runtimeContractSource?: string } };
      if (metadataInfo.promptLab?.runtimeContractSource === 'manifest-missing') {
        metadataWarning = `v4 skill 缺少契约 manifest（prompts/manifests/${skillId}.yaml），metadata 未携带 runtime/prompt 契约`;
        logger.warn(metadataWarning);
      }

      // 备份当前生产文件（best-effort，不阻断）
      const prodPath = path.join(PROMPTS_DIR, `skill.${skillId}.md`);
      try {
        const backupsDir = path.join(BACKUPS_DIR, skillId);
        await fs.mkdir(backupsDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        await fs.copyFile(prodPath, path.join(backupsDir, `${ts}.md`));
      } catch {
        // 备份失败不阻塞
      }

      // H1 ② 同一事务内完成 DB create + 旧 ACTIVE 归档：
      // 任一失败整体回滚，DB 内永远只有一个 ACTIVE 版本。
      if (asVariant) {
        const activeRows = await listActivePromptRows(agentId);
        if (activeRows.some((r) => r.variant === asVariant.variant)) {
          return res.status(409).json({ error: `变体 ${asVariant.variant} 已存在（同 agent 变体键唯一）` });
        }
        if (activeRows.filter((r) => r.variant).length >= 4) {
          return res.status(409).json({ error: '实验臂上限 4 个（避免分流碎片化）' });
        }
      }

      const { promptId, newVersion } = await withSystemTransaction(async (tx) => {
        const latest = await tx.agent_prompts.findFirst({
          where: { agentId },
          orderBy: { version: 'desc' },
          select: { version: true }
        });
        const nextVersion = (latest?.version ?? 0) + 1;
        const nextPromptId = uuidv4();
        if (asVariant) {
          await tx.agent_prompts.create({
            data: {
              id: nextPromptId,
              agentId,
              name: `${skillId} v${nextVersion} [变体${asVariant.variant}]`,
              systemPrompt: compiled.body,
              status: 'ACTIVE',
              version: nextVersion,
              temperature: core.params.temperature,
              maxTokens: core.params.maxTokens,
              model: null,
              description: core.identity.split('\n')[0].slice(0, 100),
              coreHash: compiled.coreHash,
              coreVersion: compiled.coreVersion,
              metadata,
              publishedAt: new Date(),
              createdBy: 'prompt-lab-core-variant',
              variant: asVariant.variant,
              trafficWeight: asVariant.weight
            }
          });
          return { promptId: nextPromptId, newVersion: nextVersion };
        }
        await tx.agent_prompts.create({
          data: {
            id: nextPromptId,
            agentId,
            name: `${skillId} v${nextVersion}`,
            systemPrompt: compiled.body,
            status: 'ACTIVE',
            version: nextVersion,
            temperature: core.params.temperature,
            maxTokens: core.params.maxTokens,
            model: null,
            description: core.identity.split('\n')[0].slice(0, 100),
            coreHash: compiled.coreHash,
            coreVersion: compiled.coreVersion,
            metadata,
            publishedAt: new Date(),
            createdBy: 'prompt-lab-core'
          }
        });
        // 旧**基线** → ARCHIVED（A/B 变体行不受发布影响，继续作为实验臂服役）
        await tx.agent_prompts.updateMany({
          where: { agentId, status: 'ACTIVE', variant: null, id: { not: nextPromptId } },
          data: { status: 'ARCHIVED' }
        });
        return { promptId: nextPromptId, newVersion: nextVersion };
      });

      // 变体发布不写盘：skill.md 仍是基线编译产物（yaml 的「待编译」状态属预期，晋级时写回）
      if (!asVariant) {
      // H1 ③ 最后写盘：temp 文件 + rename 原子替换，避免写一半留下半截文件；
      // 与 PROMPTS_DIR 同目录保证 rename 不跨卷。
      const tmpPath = path.join(PROMPTS_DIR, `.skill.${skillId}.md.${process.pid}.tmp`);
      try {
        // #11：沿用现有生产文件 EOL（Windows 检出为 CRLF），避免写回 LF 产生行尾噪音
        const prodEol = await readFileEol(prodPath);
        await fs.writeFile(tmpPath, withEol(compiled.prompt, prodEol), 'utf-8');
        await fs.rename(tmpPath, prodPath);
      } catch (fileError) {
        await fs.unlink(tmpPath).catch(() => {});
        throw fileError;
      }
      }

      try {
        promptCache.clearAgentCache(agentId);
        promptCache.clearAgentCache(skillId);
        getAPIGateway().invalidateCache(undefined, undefined, skillId);
        getAPIGateway().invalidateCache(undefined, agentId);
      } catch (cacheErr: any) {
        logger.warn('Failed to invalidate prompt/gateway cache:', { error: cacheErr?.message || String(cacheErr) });
      }

      // 操作审计：发布成功快照版本信息（不含 systemPrompt 全文）
      setAuditAction(res, 'prompt-lab-publish-core', { targetType: 'skill', targetId: skillId });
      setAuditAfter(res, {
        agentId,
        promptId,
        version: newVersion,
        coreHash: compiled.coreHash,
        coreVersion: compiled.coreVersion,
      });

      res.json({
        success: true,
        version: newVersion,
        agentId,
        promptId,
        coreHash: compiled.coreHash,
        coreVersion: compiled.coreVersion,
        gates,
        classification,
        ...(developerApproval ? { developerApproval } : {}),
        ...(metadataWarning ? { metadataWarning } : {}),
      });
    });
  } catch (error) {
    console.error('Core publish error:', error);
    res.status(500).json({ error: '发布失败', details: (error as Error).message });
  }
});

/**
 * GET /api/prompt-lab/core-list
 * v4 工作台：核心文件清单（含与现行 prompt 的哈希对账状态）
 */
router.get('/core-list', async (req, res) => {
  try {
    const scan = scanCoreFiles();
    const items = await Promise.all(scan.files.map(async (core) => {
      const coreHash = computeCoreHash(core);
      let publishedHash: string | null = null;
      try {
        const raw = await fs.readFile(path.join(PROMPTS_DIR, `skill.${core.skillId}.md`), 'utf-8');
        const meta = parsePromptFrontmatterMeta(raw);
        publishedHash = typeof meta.coreHash === 'string' ? meta.coreHash : null;
      } catch {
        publishedHash = null;
      }
      return {
        skillId: core.skillId,
        fields: core.fields.length,
        channels: core.channels,
        stateAdvance: core.stateAdvance,
        deltaOutput: core.deltaOutput,
        outputMedia: core.outputMedia,
        coreHash,
        publishedHash,
        status: publishedHash === null ? 'no-prompt' : (publishedHash === coreHash ? 'synced' : 'pending-compile'),
      };
    }));
    res.json({ success: true, items, diagnostics: scan.diagnostics });
  } catch (error) {
    res.status(500).json({ error: '读取核心文件清单失败', details: (error as Error).message });
  }
});

/**
 * GET /api/prompt-lab/core/:skillId
 * v4 工作台：读取核心文件原文与解析结果
 */
router.get('/core/:skillId', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const filePath = path.join(CORE_FILES_DIR, `${skillId}.yaml`);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch {
      return res.status(404).json({ error: `核心文件不存在: prompts/core/${skillId}.yaml` });
    }
    const loaded = loadCoreFile(skillId);
    res.json({
      success: true,
      skillId,
      raw,
      core: loaded?.core ?? null,
      diagnostics: loaded?.diagnostics ?? [],
      coreHash: loaded?.core ? computeCoreHash(loaded.core) : null,
    });
  } catch (error) {
    res.status(500).json({ error: '读取核心文件失败', details: (error as Error).message });
  }
});

/**
 * PUT /api/prompt-lab/core/:skillId
 * v4 工作台：保存核心文件（schema 校验 + 编辑分级 + 备份）
 * 两种模式：
 * - 默认（raw）：{ content } 直接提交 YAML 文本
 * - 表单（form）：{ mode: 'form', core } 提交结构化 JSON，服务端确定性序列化为 YAML，
 *   与 raw 模式共用同一条 parseCoreFile 校验/分级/备份路径
 */
router.put('/core/:skillId', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const { content, mode, core: formCore } = req.body || {};
    const filePath = path.join(CORE_FILES_DIR, `${skillId}.yaml`);

    let yamlText: string;
    if (mode === 'form') {
      const normalized = normalizeCoreFormInput(formCore, skillId);
      if (!normalized.ok) {
        return res.status(400).json({ error: '表单数据无法矫正为核心文件形状', diagnostics: normalized.diagnostics });
      }
      // 保留原文件头部注释块（M1 基准血缘等人工信息）
      const existingRaw = await fs.readFile(filePath, 'utf-8').catch(() => '');
      const existingCore = existingRaw ? parseCoreFile(filePath, existingRaw).core : null;
      // #9：表单「无编辑保存」守卫——载荷与磁盘现有 core 语义等价时直接沿用原文本，
      // 避免确定性序列化器把原文键序 / 引号 / 块标量风格整体改写（无编辑也产生纯格式 diff）。
      yamlText = existingCore && coreFileSemanticallyEqual(existingCore, normalized.core)
        ? existingRaw
        : serializeCoreFile(normalized.core, extractHeaderComment(existingRaw));
    } else {
      if (typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: '缺少 content（核心文件 YAML 文本）' });
      }
      yamlText = content;
    }

    const parsed = parseCoreFile(filePath, yamlText);
    if (!parsed.core) {
      return res.status(400).json({ error: '核心文件 schema 不合法', diagnostics: parsed.diagnostics });
    }

    const agentId = `skill:${skillId}`;
    const active = await findActivePromptMetadata(agentId);
    let classification: ReturnType<typeof classifyCoreEdit> = {
      level: 'safe',
      messages: ['首次创建核心文件'],
    };
    if (active) {
      const activeSnapshot = resolveCoreSnapshot(active.metadata, skillId);
      if (!activeSnapshot.core) {
        return res.status(409).json({
          error: activeSnapshot.error,
          code: 'ACTIVE_CORE_SNAPSHOT_REQUIRED',
        });
      }
      classification = classifyCoreEdit(activeSnapshot.core, parsed.core);
    }

    // 先对账再写盘：inputs 声明 ↔ handoff 路由表（advisory；基于待保存内容而非旧文件）
    const inputWarnings = await checkInputHandoffs(parsed.core);

    // 备份后写入
    try {
      const backupsDir = path.join(BACKUPS_DIR, skillId, 'core');
      await fs.mkdir(backupsDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.copyFile(filePath, path.join(backupsDir, `${ts}.yaml`));
    } catch {
      // 首次创建无备份可不做
    }
    await writeTextPreservingEol(filePath, yamlText);

    res.json({
      success: true,
      skillId,
      coreHash: computeCoreHash(parsed.core),
      classification,
      // inputs 声明 ↔ handoff 对账（advisory 告警，写盘前计算）
      inputWarnings,
      status: 'pending-compile',
    });
  } catch (error) {
    res.status(500).json({ error: '保存核心文件失败', details: (error as Error).message });
  }
});

/**
 * POST /api/admin/prompt-lab/core/:skillId/field
 * 原子加字段（M1）：双文件联动 + 落库 + 复检 + 审计，见 addSkillFieldToCoreAndOrchestration。
 */
router.post('/core/:skillId/field', async (req, res) => {
  const skillId = assertValidSkillId(req.params.skillId);
  await serializeFieldAdd(skillId, async () => {
    try {
      const result = await addSkillFieldToCoreAndOrchestration(skillId, req.body ?? {}, {
        actorId: (req as Request & { user?: { userId?: string } }).user?.userId || 'admin',
      });
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof SkillFieldAddError) {
        return res.status(error.status).json({
          success: false,
          code: error.code,
          error: { message: error.message },
          ...(error.extra ?? {}),
        });
      }
      console.error('Skill field add error:', error);
      res.status(500).json({ success: false, error: { message: '加字段失败', details: (error as Error).message } });
    }
  });
});

/**
 * PATCH /api/admin/prompt-lab/core/:skillId/field/:name
 * 原子改字段：双文件联动 + 回滚 + 落库 update 语义 + 审计 + 复检。
 */
router.patch('/core/:skillId/field/:name', async (req, res) => {
  const skillId = assertValidSkillId(req.params.skillId);
  await serializeFieldAdd(skillId, async () => {
    try {
      const result = await updateSkillFieldInCoreAndOrchestration(skillId, String(req.params.name), req.body ?? {}, {
        actorId: (req as Request & { user?: { userId?: string } }).user?.userId || 'admin',
      });
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof SkillFieldEditError) {
        return res.status(error.status).json({
          success: false,
          code: error.code,
          error: { message: error.message },
          ...(error.extra ?? {}),
        });
      }
      console.error('Skill field update error:', error);
      res.status(500).json({ success: false, error: { message: '改字段失败', details: (error as Error).message } });
    }
  });
});

/**
 * DELETE /api/admin/prompt-lab/core/:skillId/field/:name
 * 原子删字段：双文件联动删除 + 回滚 + 落库删除 + 审计 + 复检。
 */
router.delete('/core/:skillId/field/:name', async (req, res) => {
  const skillId = assertValidSkillId(req.params.skillId);
  await serializeFieldAdd(skillId, async () => {
    try {
      const result = await deleteSkillFieldFromCoreAndOrchestration(skillId, String(req.params.name), {
        actorId: (req as Request & { user?: { userId?: string } }).user?.userId || 'admin',
      });
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof SkillFieldEditError) {
        return res.status(error.status).json({
          success: false,
          code: error.code,
          error: { message: error.message },
          ...(error.extra ?? {}),
        });
      }
      console.error('Skill field delete error:', error);
      res.status(500).json({ success: false, error: { message: '删字段失败', details: (error as Error).message } });
    }
  });
});

/**
 * GET /api/prompt-lab/core/:skillId/versions
 * v4 工作台：发布版本历史
 */
router.get('/core/:skillId/versions', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const rows = await listCoreVersionHistory(`skill:${skillId}`);
    const versions = rows.map((row) => ({
      ...row,
      // 旧版本没有 coreSnapshot 时只可审计，不能安全回滚到 core SSOT。
      rollbackable: Boolean(resolveCoreSnapshot(row.metadata, skillId).core),
      metadata: undefined,
    }));
    res.json({ success: true, skillId, versions });
  } catch (error) {
    res.status(500).json({ error: '读取版本历史失败', details: (error as Error).message });
  }
});

/**
 * POST /api/prompt-lab/core/:skillId/rollback
 * v4 工作台：回滚到历史版本（文件回写 + ACTIVE 翻转 + 缓存清理）
 */
router.post('/core/:skillId/rollback', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const version = Number(req.body?.version);
    if (!Number.isInteger(version) || version < 1) {
      return res.status(400).json({ error: '缺少有效 version' });
    }
    const agentId = `skill:${skillId}`;
    const target = await findPromptVersionRow(agentId, version);
    if (!target) {
      return res.status(404).json({ error: `版本不存在: ${agentId} v${version}` });
    }

    const snapshot = resolveCoreSnapshot(target.metadata, skillId);
    if (!snapshot.core || !snapshot.raw) {
      return res.status(409).json({
        error: snapshot.error,
        code: 'HISTORICAL_CORE_SNAPSHOT_REQUIRED',
      });
    }
    const compiled = compileCoreFile(snapshot.core, { coreVersion: target.coreVersion ?? 1 });
    if (target.coreHash && target.coreHash !== compiled.coreHash) {
      return res.status(409).json({
        error: '历史版本 coreHash 与 coreSnapshot 不一致，拒绝回滚',
        code: 'HISTORICAL_CORE_HASH_MISMATCH',
      });
    }
    if (target.systemPrompt.trim() !== compiled.body.trim()) {
      return res.status(409).json({
        error: '历史版本 Prompt 不可由 coreSnapshot 确定性重建，拒绝回滚',
        code: 'HISTORICAL_PROMPT_MISMATCH',
      });
    }

    // 操作审计：回滚前快照当前 ACTIVE 版本（旧版本），回滚后快照目标版本（新版本）
    const activeBefore = await findActivePromptBrief(agentId);
    setAuditAction(res, 'prompt-lab-rollback', { targetType: 'skill', targetId: skillId });
    setAuditBefore(res, activeBefore ?? null);

    // 1) 文件回写：先恢复 core SSOT，再由其确定性重建 Runtime Prompt。
    const prodPath = path.join(PROMPTS_DIR, `skill.${skillId}.md`);
    const corePath = path.join(CORE_FILES_DIR, `${skillId}.yaml`);
    try {
      const backupsDir = path.join(BACKUPS_DIR, skillId);
      await fs.mkdir(backupsDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.copyFile(prodPath, path.join(backupsDir, `${ts}.md`));
      await fs.copyFile(corePath, path.join(backupsDir, `core-${ts}.yaml`));
    } catch { /* 备份失败不阻塞 */ }
    // #11：回滚沿用既有文件 EOL，避免写回 LF 造成「git diff 空、git status M」的行尾噪音
    await writeTextPreservingEol(corePath, snapshot.raw);
    await writeTextPreservingEol(prodPath, compiled.prompt);

    // 2) ACTIVE 翻转（其余置 ARCHIVED）
    await archiveOtherActivePrompts(agentId, target.id);
    await activateAgentPrompt(target.id);

    // 3) 缓存清理
    try {
      promptCache.clearAgentCache(agentId);
      promptCache.clearAgentCache(skillId);
      getAPIGateway().invalidateCache(undefined, undefined, skillId);
      getAPIGateway().invalidateCache(undefined, agentId);
    } catch (cacheErr: any) {
      logger.warn('Failed to invalidate prompt/gateway cache:', { error: cacheErr?.message || String(cacheErr) });
    }

    setAuditAfter(res, {
      id: target.id,
      version: target.version,
      status: 'ACTIVE',
      coreHash: target.coreHash,
      coreVersion: target.coreVersion,
    });

    res.json({ success: true, skillId, agentId, version, rolledBack: true });
  } catch (error) {
    console.error('Rollback error:', error);
    res.status(500).json({ error: '回滚失败', details: (error as Error).message });
  }
});

/**
 * GET /api/prompt-lab/core/:skillId/lineage
 * v4 工作台：字段血缘（静态注册表 ∪ 全仓 core inputs 声明推导）
 */
router.get('/core/:skillId/lineage', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    res.json({ success: true, skillId, lineage: getFieldLineageWithDeclarations(skillId) });
  } catch (error) {
    res.status(500).json({ error: '读取字段血缘失败', details: (error as Error).message });
  }
});

// A/B 实验变体簇（/variants/...）：见 prompt-lab-variants.ts
router.use(promptLabVariantsRouter);

/**
 * GET /api/prompt-lab/examples
 * 获取示例配置列表
 */
router.get('/examples', async (req, res) => {
  try {
    // 内置示例（历史 compiler-skill/examples 目录引用已随 v4 退役移除）
    const builtInExamples = [
      {
        id: 'simple-qa',
        name: '简单问答助手',
        archetype: 'conversational',
        description: '最简单的问答 Skill'
      },
      {
        id: 'content-generator',
        name: '内容生成器',
        archetype: 'generator',
        description: '生成结构化内容'
      },
      {
        id: 'goal-conversation',
        name: '目标对话',
        archetype: 'conversational',
        description: '学习目标澄清助手'
      }
    ];

    res.json({
      success: true,
      examples: builtInExamples
    });

  } catch (error) {
    console.error('Get examples error:', error);
    res.status(500).json({
      error: '获取示例失败',
      details: (error as Error).message
    });
  }
});

export default router;
