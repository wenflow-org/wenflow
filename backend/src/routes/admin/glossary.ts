/**
 * 运营术语表端点
 *
 * GET /api/admin/glossary —— 全局「这是什么/运营术语表」抽屉数据源：
 * promptRole 人话（yaml-vocabulary 派生）、完成度五档、基准三分语义、阶段人话、
 * 概念词条、健康中心术语、文档链接。纯内存组装，无 IO 无 DB。
 */

import { Router } from 'express';
import { buildGlossaryPayload } from '../../services/glossary-content';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ success: true, data: buildGlossaryPayload() });
});

export default router;
