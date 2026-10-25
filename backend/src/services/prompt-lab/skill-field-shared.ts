/**
 * Skill 字段原子编辑引擎 · 共享层（2026-10-24 架构优化批 1：routes/prompt-lab.ts 拆分）。
 *
 * 加/改/删字段三个引擎（skill-field-add / -edit / -delete）共用的错误类型、
 * 请求/结果契约、字段名段正则、互斥串行化与载荷清洗助手。原实现位于 routes/prompt-lab.ts，
 * 迁出后路由文件只保留 HTTP 薄封装。
 */
import path from 'path';
import { PROMPTS_DIR } from '../../composers/prompt-files/loader';
import type { CoreFieldsSyncSkillReport } from '../prompt-manifest/check-core-fields-sync';

export class SkillFieldAddError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SkillFieldAddError';
  }
}

export class SkillFieldEditError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SkillFieldEditError';
  }
}

export interface SkillFieldAddRequest {
  name?: unknown;
  type?: unknown;
  role?: unknown;
  render?: unknown;
  handoff?: unknown;
  internal?: unknown;
  accumulate?: unknown;
  visibilityPreset?: unknown;
  locked?: unknown;
  desc?: unknown;
  persistKey?: unknown;
  pathInRawOutput?: unknown;
  turn?: unknown;
}

export interface SkillFieldAddResult {
  skillId: string;
  stage: string;
  field: { name: string; fieldId: string };
  coreWritten: boolean;
  orchestrationWritten: boolean;
  synced: boolean;
  syncHint: string;
  syncCheck: CoreFieldsSyncSkillReport | null;
  auditId: string;
}

export interface SkillFieldUpdateRequest {
  type?: unknown;
  role?: unknown;
  render?: unknown;
  handoff?: unknown;
  internal?: unknown;
  accumulate?: unknown;
  visibilityPreset?: unknown;
  locked?: unknown;
  desc?: unknown;
  persistKey?: unknown;
  pathInRawOutput?: unknown;
  turn?: unknown;
}

export interface SkillFieldSnapshot {
  name: string;
  root: string;
  isNested: boolean;
  coreType: string;
  turn: boolean;
  promptRole: string;
  valueType: string;
  persistKey: string | null;
  pathInRawOutput: string | null;
  render: string;
  handoff: string[];
  internal: boolean;
  accumulate: boolean;
  visibilityPreset: string | null;
  locked: 'system' | 'structure' | null;
  desc: string;
}

export interface SkillFieldUpdateResult {
  skillId: string;
  stage: string;
  name: string;
  changed: boolean;
  coreWritten: boolean;
  orchestrationWritten: boolean;
  /** 落库全量对账报告（syncStageFieldRoutingsFromFile；managedByCode=false 行跳过） */
  dbSync: {
    fieldsUpdated: number;
    routingsUpdated: number;
    contractsUpdated: number;
    createdCount: number;
    skippedAdminRows: Array<{ table: string; key: string }>;
  };
  syncCheck: CoreFieldsSyncSkillReport | null;
  auditId: string;
}

export interface SkillFieldDeleteResult {
  skillId: string;
  stage: string;
  name: string;
  coreWritten: boolean;
  orchestrationWritten: boolean;
  /** 文件侧删除清单（core fields / 编排 fields / 编排 routings / core 级联条目） */
  deleted: Array<{ table: string; key: string }>;
  /** 文件侧无新孤儿断言 */
  syncCheck: CoreFieldsSyncSkillReport | null;
  /** DB 侧删除清单（field_definitions / agent_field_routings） */
  dbDeleted: Array<{ table: string; key: string }>;
  /** managedByCode=false 覆盖行（跳过，仅报告） */
  protectedRows: Array<{ table: string; key: string }>;
  auditId: string;
}

export const FIELD_ADD_BACKUPS_DIR = path.join(PROMPTS_DIR, 'backups', 'unified-edit');

export const CORE_FIELD_NAME_SEGMENT = /^[a-z][A-Za-z0-9_]*$/;

/** H3：同 skill 的字段编辑按 skillId 串行化（进程内互斥，防并发读改写丢行） */
const fieldAddLocks = new Map<string, Promise<unknown>>();

export function serializeFieldAdd<T>(skillId: string, task: () => Promise<T>): Promise<T> {
  const prev = fieldAddLocks.get(skillId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(task);
  fieldAddLocks.set(skillId, run);
  run.then(
    () => {
      if (fieldAddLocks.get(skillId) === run) fieldAddLocks.delete(skillId);
    },
    () => {
      if (fieldAddLocks.get(skillId) === run) fieldAddLocks.delete(skillId);
    }
  );
  return run;
}

export function fieldAddTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function fieldAddBooleanFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
