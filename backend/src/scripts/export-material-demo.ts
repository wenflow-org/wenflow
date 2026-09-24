/* eslint-disable @typescript-eslint/no-explicit-any -- 探针/测试：LLM I/O 与 JSON 载荷形状内在动态（对齐 verify-from-zero 先例） */
/* eslint-disable no-console -- 一次性导出 CLI：面向人读 */
/**
 * 把「附件 → 路径 → 任务 → 课堂」整条链导成一个**自包含 HTML**，供人直接翻看。
 *
 * 输出：`doc/local/MATERIAL_PATH_LEARN_DEMO_<日期>.html`（含：路径骨架 + 阶段任务 + 资料引用 +
 * 资料原文节选 + 真实课堂逐轮记录 + 验收摘要）。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/export-material-demo.ts [pathId]
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2br(value: unknown): string {
  return esc(value).replace(/\r?\n/g, '<br/>');
}

function refLabel(ref: any): string {
  const label = String(ref?.sectionTitle || ref?.quote || '').trim();
  return label.length > 40 ? `${label.slice(0, 40)}…` : label;
}

async function main() {
  const { prisma } = await import('../config/database');
  const { getLearningPath } = await import('../services/learning/queries/path-views.queries');
  const { readMaterial } = await import('../services/materials/material-store');

  // 选路径：命令行指定，否则取最近一条带资料引用的
  let pathId = process.argv[2];
  if (!pathId) {
    const rows: any[] = await (prisma as any).learning_paths.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, aiPromptTemplate: true },
    });
    const hit = rows.find((row) => {
      try {
        return !!JSON.parse(row.aiPromptTemplate || '{}')?.materialRefs;
      } catch {
        return false;
      }
    });
    pathId = hit?.id;
  }
  if (!pathId) {
    console.error('没有带资料引用的路径可导出');
    process.exitCode = 1;
    return;
  }

  const detail: any = await getLearningPath(String(pathId));
  const milestones: any[] = Array.isArray(detail?.milestones) ? detail.milestones : [];
  const materials: any[] = Array.isArray(detail?.materials) ? detail.materials : [];

  const sessions: any[] = await (prisma as any).teaching_sessions.findMany({
    where: { learningPathId: String(pathId) },
    orderBy: { createdAt: 'asc' },
  });
  const sessionMessages: Record<string, any[]> = {};
  for (const session of sessions) {
    const rows: any[] = await (prisma as any).teaching_session_messages.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
    });
    sessionMessages[session.id] = rows.map((row) => {
      try {
        return JSON.parse(String(row.payload || '{}'));
      } catch {
        return { role: '?', content: String(row.payload || '').slice(0, 200) };
      }
    });
  }

  // 资料原文节选（只有本地附件能取回原文；联网资料没有 id）
  const materialExcerpts = new Map<string, string>();
  for (const material of materials) {
    const id = material?.materialId;
    if (!id) continue;
    try {
      const found = readMaterial(String(detail?.userId || ''), String(id));
      if (found?.markdown) materialExcerpts.set(String(id), found.markdown.slice(0, 1500));
    } catch {
      // 读取失败就不放原文
    }
  }

  // 验收摘要
  const stageRefs = milestones.filter((m) => Array.isArray(m.materialRefs) && m.materialRefs.length);
  const allTasks = milestones.flatMap((m) => (Array.isArray(m.subtasks) ? m.subtasks : []));
  const taskRefs = allTasks.filter((t) => Array.isArray(t.materialRefs) && t.materialRefs.length);
  const refLabels = [...stageRefs.flatMap((m) => m.materialRefs), ...taskRefs.flatMap((t) => t.materialRefs)]
    .map((ref: any) => String(ref?.sectionTitle || ref?.quote || '').trim())
    .filter(Boolean);
  let chatHits = 0;
  let chatTurns = 0;
  for (const session of sessions) {
    for (const message of sessionMessages[session.id] || []) {
      if (message?.role !== 'assistant') continue;
      chatTurns += 1;
      const text = String(message.content || '');
      if (refLabels.some((label) => label.length >= 2 && text.includes(label))) chatHits += 1;
    }
  }

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<title>附件 → 路径 → 课堂（${esc(detail?.name || pathId)}）</title>
<style>
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0; background: #f6f7f9; color: #1c1f23; }
  main { max-width: 980px; margin: 0 auto; padding: 28px 20px 80px; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  h2 { font-size: 17px; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e3e6ea; }
  h3 { font-size: 15px; margin: 18px 0 6px; }
  .sub { color: #6b7280; font-size: 13px; }
  .card { background: #fff; border: 1px solid #e3e6ea; border-radius: 10px; padding: 14px 16px; margin: 10px 0; }
  .kpi { display: flex; gap: 18px; flex-wrap: wrap; margin: 12px 0; }
  .kpi div { background: #fff; border: 1px solid #e3e6ea; border-radius: 10px; padding: 10px 14px; min-width: 150px; }
  .kpi b { display: block; font-size: 20px; }
  .kpi span { color: #6b7280; font-size: 12px; }
  .ref { display: inline-block; background: #eef4ff; color: #1d4ed8; border-radius: 999px; padding: 2px 9px; font-size: 12px; margin: 2px 4px 2px 0; }
  .quote { color: #6b7280; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border-bottom: 1px solid #eceef1; padding: 7px 8px; text-align: left; vertical-align: top; }
  th { color: #6b7280; font-weight: 600; background: #fafbfc; }
  .task { font-size: 13px; }
  .task small { color: #6b7280; }
  .msg { border-left: 3px solid #d9dde3; padding: 8px 12px; margin: 8px 0; background: #fff; border-radius: 0 8px 8px 0; }
  .msg--user { border-left-color: #94a3b8; background: #f8fafc; }
  .msg--assistant { border-left-color: #2563eb; }
  .role { font-size: 12px; color: #6b7280; margin-bottom: 4px; }
  pre { white-space: pre-wrap; word-break: break-word; font-size: 12.5px; line-height: 1.65; margin: 6px 0 0; font-family: inherit; }
  .note { color: #6b7280; font-size: 12px; }
</style></head>
<body><main>
  <h1>附件 → 路径 → 任务 → 课堂</h1>
  <p class="sub">pathId <code>${esc(pathId)}</code>｜用户 <code>${esc(detail?.userId)}</code>｜导出时间 ${esc(new Date().toLocaleString('zh-CN'))}</p>

  <div class="kpi">
    <div><b>${esc(detail?.name || '-')}</b><span>路径名称</span></div>
    <div><b>${milestones.length}</b><span>阶段数</span></div>
    <div><b>${allTasks.length}</b><span>任务数</span></div>
    <div><b>${esc(detail?.estimatedHours ?? '-')} h</b><span>预计学时</span></div>
    <div><b>${materials.length}</b><span>关联资料包</span></div>
    <div><b>${sessions.length}</b><span>课堂会话</span></div>
  </div>

  <h2>一、验收摘要</h2>
  <div class="card">
    <ul>
      <li>资料引用（<b>逐字核对</b>后落库）：阶段 <b>${stageRefs.length}/${milestones.length}</b>，任务 <b>${taskRefs.length}/${allTasks.length}</b></li>
      <li>课堂回合引用资料章节：<b>${chatHits}/${chatTurns}</b>（按引用章节名/引文在老师发言里做字面命中，仅作粗筛）</li>
      <li>路径摘要：${esc(detail?.summary || '-')}</li>
    </ul>
  </div>

  <h2>二、资料（用户上传的附件）</h2>
  ${materials.map((material) => `
  <div class="card">
    <h3>${esc(material?.title || '未命名资料')}</h3>
    <p class="sub">${esc(material?.sourceUrl || '')}${material?.materialId ? `｜附件 id <code>${esc(material.materialId)}</code>` : '（联网资料，无本地原文）'}</p>
    ${material?.tldr ? `<p class="note">摘要：${nl2br(String(material.tldr).slice(0, 300))}</p>` : ''}
    <p class="sub">章节：${(material?.sections || []).map((section: any) => `<span class="ref">${esc(section?.id)} ${esc(section?.title)}</span>`).join('') || '（无章节）'}</p>
    ${(material?.keyPoints || []).slice(0, 6).map((point: any) => `
      <p class="task"><b>${esc(String(point?.text || '').slice(0, 60))}</b><br/><span class="quote">原文：${esc(String(point?.cite || '').slice(0, 120))}</span></p>
    `).join('')}
    ${materialExcerpts.get(String(material?.materialId)) ? `
      <details><summary class="sub">展开资料原文节选（前 1500 字）</summary>
        <pre>${esc(materialExcerpts.get(String(material.materialId)))}</pre>
      </details>` : ''}
  </div>`).join('')}

  <h2>三、路径骨架与阶段任务</h2>
  ${milestones.map((milestone) => `
  <div class="card">
    <h3>阶段 ${esc(milestone?.stageNumber)}｜${esc(milestone?.title)}</h3>
    <p class="task">${nl2br(milestone?.goal || '')}</p>
    <p class="sub">核心概念：${esc(milestone?.coreConceptName || milestone?.coreConceptId || '-')}｜约 ${esc(milestone?.estimatedHours ?? '-')} 小时</p>
    <p class="sub">依据资料：${(milestone?.materialRefs || []).map((ref: any) => `<span class="ref">${esc(refLabel(ref))}</span>`).join('') || '（本阶段未给引用）'}</p>
    <table>
      <tr><th>任务</th><th>类型</th><th>分钟</th><th>依据资料</th></tr>
      ${(milestone?.subtasks || []).map((task: any) => `
      <tr>
        <td>${esc(task?.title)}<br/><small class="quote">${esc(String(task?.description || '').slice(0, 90))}</small></td>
        <td>${esc(task?.taskType || '-')}</td>
        <td>${esc(task?.estimatedMinutes ?? '-')}</td>
        <td>${(task?.materialRefs || []).map((ref: any) => `<span class="ref">${esc(refLabel(ref))}</span>`).join('') || '<span class="quote">—</span>'}</td>
      </tr>`).join('')}
    </table>
  </div>`).join('')}

  <h2>四、课堂记录（真实会话）</h2>
  ${sessions.length === 0 ? '<p class="note">该路径还没有课堂会话。</p>' : sessions.map((session) => `
  <div class="card">
    <h3>${esc(session?.topic || '（无主题）')}</h3>
    <p class="sub">会话 <code>${esc(session.id)}</code>｜状态 ${esc(session.status)}｜开始 ${esc(session.startTime ? new Date(Number(session.startTime) || session.startTime).toLocaleString('zh-CN') : '-')}</p>
    ${(sessionMessages[session.id] || []).map((message: any) => `
      <div class="msg msg--${esc(message?.role || 'unknown')}">
        <div class="role">${message?.role === 'user' ? '学生' : '老师'}</div>
        <pre>${esc(message?.content || message?.text || '')}</pre>
      </div>`).join('')}
  </div>`).join('')}

  <p class="note">生成自 <code>backend/src/scripts/export-material-demo.ts</code>｜课堂发言为真实 LLM 输出（模型：deepseek-v4-flash，网关侧当前实际由 v4.1 部署服务）。</p>
</main></body></html>`;

  const outDir = path.resolve(__dirname, '..', '..', '..', 'doc', 'local');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outFile = path.join(outDir, `MATERIAL_PATH_LEARN_DEMO_${stamp}.html`);
  fs.writeFileSync(outFile, html, 'utf-8');
  console.log(`[export] 已导出：${outFile}`);
  console.log(`[export] 阶段引用 ${stageRefs.length}/${milestones.length}｜任务引用 ${taskRefs.length}/${allTasks.length}｜课堂回合 ${chatTurns}（引用命中 ${chatHits}）`);

  await (prisma as any).$disconnect();
}

void main().catch((error) => {
  console.error('[export] 失败', error);
  process.exitCode = 1;
});
