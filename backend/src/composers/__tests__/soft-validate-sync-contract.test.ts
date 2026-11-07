/**
 * 类型级回归：`softValidateParsedOutput` 是**同步**契约（2026-11-07）。
 *
 * 背景：改 stage-designer 材料闸门时曾把 `PromptCallSpec.softValidateParsedOutput` 的返回类型
 * 放宽成 `PromptValidationResult | Promise<PromptValidationResult>`，结果 teaching-turn 的同步
 * 消费方（`board-deixis-guard.test.ts` 里直接取 `result.valid`）编译不过。这类破坏
 * `npm run typecheck` 看不见——`tsconfig.build.json` 的 exclude 把测试文件通配符也排除了，
 * 而 jest 用 ts-jest 连测试一起编。这条把「返回类型恰好是同步的 PromptValidationResult」
 * 钉在类型上：一旦再放宽成 Promise 联合类型，本文件会 TS2322 编译失败。
 */
import type { PromptCallSpec, PromptValidationResult } from '../types';

// 参数位用 never[]：任何函数签名都可通过逆变赋值到它，避免用 any（本仓 lint 把显式 any 当 error）
type SoftValidateReturn<S> = S extends (...args: never[]) => infer R ? R : never;
/** 精确相等：联合类型与单类型不等价 → false */
type IsExactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type ActualReturn = SoftValidateReturn<
  NonNullable<PromptCallSpec<unknown, unknown>['softValidateParsedOutput']>
>;
// 若返回类型被放宽为 `PromptValidationResult | Promise<...>`，下面这行编译失败（true 不可赋给 false）
const _syncContractPin: IsExactly<ActualReturn, PromptValidationResult> = true;

describe('softValidateParsedOutput 同步契约', () => {
  it('返回类型恰好是同步的 PromptValidationResult（不是 Promise 联合）', () => {
    expect(_syncContractPin).toBe(true);
  });

  it('同步消费方可以直接取 .valid，无需 await', () => {
    // 这正是 board-deixis-guard 的用法；返回类型一旦变成联合 Promise，这里 `.valid` 会编译失败
    const readValid = (spec: PromptCallSpec<unknown, unknown>) =>
      spec.softValidateParsedOutput?.({}, {})?.valid;
    expect(typeof readValid).toBe('function');
  });
});
