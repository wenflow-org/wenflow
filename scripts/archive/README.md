# scripts/archive

一次性调试 / 排查脚本归档区。

这些脚本是特定时间点为了定位某个问题临时写的，任务完成后已无维护价值，但保留下来便于追溯当时的排查手段。**不要在 CI、package.json 或文档中引用本目录**，也不要在此基础上继续开发。

当前归档内容：

- `failure-*.mjs`：一批失败排查脚本（2026-08/09）。
- `vlab-test-result.mjs`、`vlab-test-result2.mjs`：虚拟学习者结果查看脚本的两次迭代。
- `run-vl-retry.mjs`、`run-vl-retry2.mjs`、`run-vl-retry3.mjs`：虚拟学习者重试脚本的多代版本。
- `qoder-search2.mjs`：一次性的搜索调试脚本。

仍在使用的虚拟学习者脚本（`vlab-cohort.mjs`、`vlab-blackbox-*.mjs` 等）保留在 `scripts/`。
