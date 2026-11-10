/**
 * #208（#150 的修复回归）：`subscribes` / `publishes` 是文档性元数据，但**文档也要与真实执行对齐**。
 *
 * 上一轮修复把订阅声明对齐到了错的对象上：`LEARNER_EVENT_TYPES` 的 7 类事件是
 * profile-agent 的 outbox 执行体（bootstrap/schedulers.ts 注册的 handleLearnerEvent，
 * 序列见 events/learner-event-consumer.ts），而 skill:learner-model 是**拉取式**执行体
 * （gateway 按 action 调用），零事件消费、不在事件链内。把别人的消费集挂在它身上，
 * 看起来「已经对齐了」，实际是换了对象的错误声明。
 *
 * 同时 path-planning 的新注释「全仓无对应 dispatch 调用点」对它的 publishes 是假话——
 * path:created / path:adjusted / path:completed 都有真实 emit 点。本测试把这两条事实钉住。
 *
 * #150：另加「声明处必须写明不参与运行时分发」的全仓守卫——降级方案（不写派发器）只有在标注
 * 齐全时才成立，否则字段照旧被界面/文档当成真实拓扑读。
 */
import * as fs from 'fs';
import * as path from 'path';
import { learnerModelAgentDefinition } from '../learner-model-agent';
import { pathAgentDefinition } from '../../skills/path-planning';

const BACKEND_SRC = path.resolve(__dirname, '../..');

const LEARNER_CHAIN_EVENT_TYPES = [
  'goal:understanding:updated',
  'task:completed',
  'lesson:completed',
  'path:created',
  'path:generated',
  'path:adjusted',
  'path:completed',
];

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(BACKEND_SRC, relativePath), 'utf8');
}

describe('#208 skill:learner-model 不得挂别人（事件链）的消费集', () => {
  it('subscribes 为空——它是拉取式执行体，不在事件链内', () => {
    expect(learnerModelAgentDefinition.subscribes).toEqual([]);
  });

  it('不声明 LEARNER_EVENT_TYPES 的任何一类（那是 profile-agent outbox 执行体的消费集）', () => {
    for (const eventType of LEARNER_CHAIN_EVENT_TYPES) {
      expect(learnerModelAgentDefinition.subscribes).not.toContain(eventType);
    }
  });

  it('真实消费体（events/learner-event-consumer.ts）不引用 learner-model', () => {
    const consumerSource = readSource('events/learner-event-consumer.ts');
    expect(consumerSource).not.toContain('learner-model');
    expect(consumerSource).not.toContain('learnerModelAgent');
  });
});

/**
 * #150 验收（二选一的「降级」支路）：字段可以保留，但**声明处必须明确写出不参与运行时分发**。
 * 此前只有零散两三处注释，其余定义照着抄字段却没有标注，界面/文档仍会被当成真实拓扑读。
 */
describe('#150 每个声明式 subscribes / publishes 字段都自带「不参与分发」标注', () => {
  const SKIPPED_DIRS = new Set(['generated', '__tests__', 'node_modules']);
  const NON_DISPATCH_MARKERS = ['不参与运行时分发', '不参与运行时发布'];

  it('非测试、非生成代码里的定义字段上方都能读到不参与分发的说明', () => {
    const violations: string[] = [];
    const files = fs.readdirSync(BACKEND_SRC, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => !name.split(/[\\/]/).some((part) => SKIPPED_DIRS.has(part)));

    for (const name of files) {
      const lines = fs.readFileSync(path.join(BACKEND_SRC, name), 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (!/^\s*(subscribes|publishes):/.test(line)) return;
        // agent-registry 的 JSON.stringify/parse 是序列化点，不是声明处
        if (/JSON\.(stringify|parse)/.test(line)) return;
        const context = lines.slice(Math.max(0, index - 40), index).join('\n');
        if (!NON_DISPATCH_MARKERS.some((marker) => context.includes(marker))) {
          violations.push(`${name}:${index + 1}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('learner-model 声明的两个发布事件在全仓仍无 emit 点（注释与事实一致，勿据此排障）', () => {
    const roots = ['agents', 'services', 'coordinators', 'events', 'skills', 'bootstrap', 'gateway'];
    const hits: string[] = [];
    for (const root of roots) {
      const dir = path.join(BACKEND_SRC, root);
      const files = fs.readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
      for (const name of files) {
        const source = fs.readFileSync(path.join(dir, name), 'utf8');
        for (const eventType of learnerModelAgentDefinition.publishes) {
          // 只找 emit 形态（type: '…'）；声明式数组里的字面量不算
          if (source.includes(`type: '${eventType}'`)) hits.push(`${root}/${name}:${eventType}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('#208 path-planning 的 publishes 是真实事件，不能写成「全仓无 emit」', () => {
  it('publishes 声明的三个事件在运行时代码里有 emit 点', () => {
    expect(pathAgentDefinition.publishes).toEqual(
      expect.arrayContaining(['path:created', 'path:adjusted', 'path:completed'])
    );

    const emitSites: Array<{ file: string; eventType: string }> = [
      { file: 'services/learning/generation/path-generation.core.ts', eventType: 'path:created' },
      { file: 'services/learning/replan/path-replan.service.ts', eventType: 'path:adjusted' },
      { file: 'services/learning/tasks/task-completion.service.ts', eventType: 'path:completed' },
    ];
    for (const site of emitSites) {
      expect(`${site.file}: ${readSource(site.file).includes(`type: '${site.eventType}'`)}`)
        .toBe(`${site.file}: true`);
    }
  });

  it('subscribes 声明的 learning:* 在全仓确实没有 emit 点（描述性，勿据此排障）', () => {
    const roots = ['services', 'coordinators', 'events', 'skills'];
    const hits: string[] = [];
    for (const root of roots) {
      const dir = path.join(BACKEND_SRC, root);
      const files = fs.readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
      for (const name of files) {
        const source = fs.readFileSync(path.join(dir, name), 'utf8');
        for (const eventType of pathAgentDefinition.subscribes) {
          // 只找 emit 形态（createDomainEvent({ type: '…' })）；声明式数组里的字面量不算
          if (source.includes(`type: '${eventType}'`)) hits.push(`${root}/${name}:${eventType}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
