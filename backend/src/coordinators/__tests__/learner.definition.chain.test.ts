/**
 * #149 回归：`profile-agent` 的运行时定义是管理端 / 文档里「画像阶段链路」的展示源
 * （routes/admin/runtime-definitions.ts 的 compileOrchestrator 直接下发 `step.steps`），
 * 因而必须与真实执行体逐步对齐，且其中的执行体指针必须真的指得到调用点。
 *
 * 原病灶有两种形态，本测试都钉住：
 *
 * 1. **指针是死链**：曾写「真实执行体：outbox 消费者序列 index.ts:662-677」——该文件只有 211 行；
 *    上一轮改成 `bootstrap/schedulers.ts:75`，那一行是课后增强泳道的注释，真正的注册在 :106。
 *    所以这里既校验「行号落在文件行数内」，也校验「指针覆盖的行里确有它声称的调用」。
 * 2. **声明链与执行链不符**：曾把拉取式的 `skill:learner-model` 声明成事件链第一步、漏掉
 *    「清画像缓存」，并把课后增强排在清缓存之前。真实链见 events/learner-event-consumer.ts:48-80
 *    （也见该文件 :4 的顺序说明）：证据投影 → 清画像缓存 → 快照重算 →（仅 lesson:completed）登记课后增强事件。
 */
import * as fs from 'fs';
import * as path from 'path';
import { learnerAgentRuntimeDefinition } from '../learner.definition';

const BACKEND_SRC = path.resolve(__dirname, '../..');
const CONSUMER = 'events/learner-event-consumer.ts';
const SCHEDULERS = 'bootstrap/schedulers.ts';

/** 真实执行顺序（agentId ↔ 消费者里的调用点），顺序即 learner-event-consumer.ts 的语句顺序 */
const REAL_CHAIN: Array<{ agentId: string; call: string }> = [
  { agentId: 'LearnerEvidenceProjector', call: 'await learnerEvidenceProjector.handle(event)' },
  { agentId: 'LearnerProfileService', call: 'learnerProfileService.clear(event.userId)' },
  { agentId: 'LearnerSnapshotRefreshService', call: 'await learnerSnapshotRefreshService.refresh({' },
  { agentId: 'skill:lesson-knowledge-enricher', call: 'await enqueueLessonEnrichmentEvent(event)' },
];

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(BACKEND_SRC, relativePath), 'utf8');
}

function findLine(relativePath: string, needle: string): number {
  const index = readSource(relativePath)
    .split('\n')
    .findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`${relativePath} 中找不到锚点：${needle}`);
  return index + 1;
}

interface Pointer {
  file: string;
  start: number;
  end: number;
  raw: string;
}

/** 定义里所有 `path/to/file.ts:N` / `file.ts:N-M` 形式的执行体指针（描述与每个 step 的 impl 都算） */
function definitionPointers(): Pointer[] {
  const serialized = JSON.stringify(learnerAgentRuntimeDefinition);
  const pattern = /([\w./-]+\.ts):(\d+)(?:-(\d+))?/g;
  const pointers: Pointer[] = [];
  for (const match of serialized.matchAll(pattern)) {
    pointers.push({
      file: match[1],
      start: Number(match[2]),
      end: Number(match[3] ?? match[2]),
      raw: match[0],
    });
  }
  return pointers;
}

function pointersCovering(file: string, line: number): Pointer[] {
  return definitionPointers().filter((p) => p.file === file && p.start <= line && line <= p.end);
}

function expectPointerCovering(file: string, line: number, why: string): void {
  const covering = pointersCovering(file, line);
  expect(`${why} => ${file}:${line} covered: ${covering.length > 0}`)
    .toBe(`${why} => ${file}:${line} covered: true`);
}

const stepAgentIds = learnerAgentRuntimeDefinition.steps.map((step) => step.agentId);

describe('#149 profile-agent 声明的执行体指针必须可解析', () => {
  it('每个 file:line[-line] 指针都指向真实文件内的真实行段', () => {
    const pointers = definitionPointers();
    expect(pointers.length).toBeGreaterThan(0);
    for (const pointer of pointers) {
      const target = path.join(BACKEND_SRC, pointer.file);
      expect(`${pointer.raw} exists: ${fs.existsSync(target)}`).toBe(`${pointer.raw} exists: true`);
      const lines = readSource(pointer.file).split('\n').length;
      expect(`${pointer.raw} within ${pointer.file} (${lines} lines): ${pointer.start >= 1 && pointer.end <= lines}`)
        .toBe(`${pointer.raw} within ${pointer.file} (${lines} lines): true`);
    }
  });

  it('注册点指针覆盖真实的 handleLearnerEvent 注册行', () => {
    const registerLine = findLine(
      SCHEDULERS,
      'durableConsumers.register(LEARNER_EVENT_TYPES, handleLearnerEvent)'
    );
    expectPointerCovering(SCHEDULERS, registerLine, 'outbox 消费者注册点');
  });

  it('课后增强泳道指针覆盖真实的增强消费者注册行', () => {
    const laneLine = findLine(SCHEDULERS, 'lessonKnowledgeEnrichmentConsumer.handleEnrichmentEvent');
    expectPointerCovering(SCHEDULERS, laneLine, '课后增强泳道');
  });
});

describe('#149 声明 steps 与真实执行链逐步对齐', () => {
  it('真实执行体的调用顺序与 REAL_CHAIN 一致，且每个调用点都有定义指针覆盖', () => {
    let previousLine = 0;
    for (const link of REAL_CHAIN) {
      const line = findLine(CONSUMER, link.call);
      expect(`${link.call} order ok: ${line > previousLine}`).toBe(`${link.call} order ok: true`);
      previousLine = line;
      expectPointerCovering(CONSUMER, line, link.agentId);
    }
  });

  it('steps 的 agentId 顺序 = 真实执行顺序（不缺步、不错序）', () => {
    expect(stepAgentIds).toEqual(REAL_CHAIN.map((link) => link.agentId));
  });

  it('每个 step 都带 impl（可追到服务实现或消费者调用点）', () => {
    for (const step of learnerAgentRuntimeDefinition.steps) {
      expect(`step ${step.step} (${step.agentId}) impl: ${Boolean(step.impl)}`)
        .toBe(`step ${step.step} (${step.agentId}) impl: true`);
    }
  });

  it('拉取式的 skill:learner-model 不在事件链上（它不是本消费者的一步）', () => {
    expect(stepAgentIds).not.toContain('skill:learner-model');
    expect(readSource(CONSUMER)).not.toContain('learner-model');
  });

  it('课后增强是登记事件而非同步执行（快路径不调用增强消费者）', () => {
    const consumerSource = readSource(CONSUMER);
    expect(consumerSource).toContain('enqueueLessonEnrichmentEvent');
    expect(consumerSource).not.toContain('lessonKnowledgeEnrichmentConsumer');
  });
});
