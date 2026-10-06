# 数据来源治理（Data Provenance）规约

> 目标：防止后续开发/agent 把旧数据的学习效果标签（mastery/wrapup）当证据用。
> 不删数据、不锁数据——按用途分层放行。平台行为层（真实执行史）永远有效；
> 学习效果层（旧测量层 + 合成学员）**修复轮上线前一律封条**。

## 目录内容

| 文件 | 用途 |
| --- | --- |
| `provenance-rules.mjs` | 分类规则 + 边界常量（**单一事实源**，JS 与 SQL 同源） |
| `build-registry.mjs` | 只读跑分类 → 生成 `doc/local/DATA-PROVENANCE-REGISTRY-2026-10-06.json` |
| `apply-views.mjs` | 幂等创建 SQLite 视图 `v_session_provenance` / `v_user_provenance`（封条落地） |

## 分类含义

| provenance | 含义 | synthetic_student |
| --- | --- | --- |
| `mechanical` | 机械脚本 / QA 自动化 / 数据工厂 e2e（`pe-*`、`ev2_*`、`e2e*`、`uitest*`、`qa_*` 等） | true |
| `vl` | 虚拟学习者（`virtual_*@test.local`/`vl-*`）；批次细分 `campaign`（旧战役）/`r1b`（R1 对比组）/`r1-measure`（R1 新建），附 `r2Reused` | true |
| `demo` | 内置演示（`builtin_*@preset.local`） | true |
| `test-round` | 本轮实测（`gu-r1-*`/`s?r1-*`/`seq-r2-*`/`f1-r3-*`/`mv-*` + 2026-10-05(+08) 后出现的实测账号） | true |
| `human` | 已人工确证真人（白名单，目前为空） | false |
| `human-candidate` | 无法确证（**不硬标 human**，进人工复核清单） | false |
| `unknown` | 邮箱缺失/不合法（正常库内应为 0） | false |

## 四个用途角色（按用途放行，不按数据放行）

1. **尺子 ❌ 永久不可**：把 mastery/wrapup 等学习效果标签当作教学有效性/学习效果证据。
   旧测量层缺陷 + 合成学员双重不可信，**与封条无关，永久禁止**。新测量口径须由修复层重新产出数据。
2. **靶子 ✅ 可用于审计**：把会话当「平台行为层」证据（bug 复现、流程诊断、状态机对账、失败归因）。
   `measurement_sealed` 不影响此类使用。
3. **档案 ✅ 可用于聚合**：计数/活跃度/采纳率等平台运营统计（注意 `synthetic_student` 需在口径中声明）。
4. **回归语料 ✅ 限代码裁决层**：`judgedBy='code'` 等确定性判定、状态机行为的回归测试语料；
   凡涉模型自证（`judgedBy='model-reference'`）或学习效果标签，按第 1 条禁止。

## 安全查询配方

```sql
-- 只查「未封条」会话（修复层生效后产生，可进入新测量口径）
SELECT * FROM v_session_provenance WHERE measurement_sealed = 0;

-- 只看真人（确证）且未封条
SELECT * FROM v_session_provenance
WHERE provenance = 'human' AND measurement_sealed = 0;

-- 排除全部合成学员（做平台审计时的推荐口径）
SELECT * FROM v_session_provenance WHERE synthetic_student = 0;

-- 按 provenance / 批次过滤（v_user_provenance 便于按账号聚合）
SELECT provenance, COUNT(*) FROM v_session_provenance GROUP BY provenance;
SELECT email, provenance, sessionCount, sealedSessionCount
FROM v_user_provenance WHERE provenance IN ('vl','mechanical','demo','test-round');

-- ❌ 禁止：拿封条会话的学习效果标签做证据
SELECT * FROM v_session_provenance WHERE measurement_sealed = 1 AND ... mastery/wrapup ...
```

> 封条边界常量 `MEASUREMENT_FIX_BOUNDARY_MS` 在 `provenance-rules.mjs` 顶部；
> **修复轮上线后更新此值**并重跑 `node backend/scripts/data-governance/apply-views.mjs`
> （视图已存在时需先人工 `DROP VIEW v_session_provenance; DROP VIEW v_user_provenance;`）。

## 新增数据时怎么登记

1. **命名约定**（跑批/实测/QA 必须遵守，否则会被误标 `human-candidate`）：
   - 虚拟学习者：`virtual_<id>@test.local` 或 `vl-<用途>-<id>@...`（R1 对比组用 `vl-r1b-<档位>-<n>`）；
   - 内置演示：`builtin_<场景>@preset.local`；
   - 本轮实测：`<轮次前缀>-r<轮>-<随机>`（如 `f1-r3-xxxxx`、`seq-r2-xxxxx`、`s1r1-xxxxx`）；
   - 机械脚本 / QA：`pe-*`、`ev2_*`、`e2e*`、`uitest*`、`qa_*` 等（见 `provenance-rules.mjs` 规则表）。
2. **登记流程**：新批次跑完后重跑
   `node backend/scripts/data-governance/build-registry.mjs`（注册表）与
   `node backend/scripts/data-governance/apply-views.mjs`（视图，幂等）。
3. **真人账号须人工确证**：确认后把 email 加入 `provenance-rules.mjs` 的 `CONFIRMED_HUMAN_GLOBS`，
   否则一律 `human-candidate`。
