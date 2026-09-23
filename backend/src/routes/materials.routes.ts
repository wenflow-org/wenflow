/**
 * 上传资料路由：文本型文档的上传 / 列表 / 预览 / 删除。
 *
 * 设计：路由只做「入参清洗 + 状态码映射」，解析与落盘在
 * `services/materials/*`（遵守 routes 层不直连 DB/IO 的分层约定）。
 * 鉴权在 `bootstrap/routers.ts` 挂载处统一施加（与 goal-conversation 同档）。
 */
import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { logger } from '../utils/logger';
import { MAX_UPLOAD_BYTES } from '../services/materials/document-parser';
import {
  deleteMaterial,
  listMaterials,
  readMaterial,
  saveUploadedMaterial,
} from '../services/materials/material-upload.service';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

/**
 * multer 1.x（busboy 默认 latin1）会把 UTF-8 文件名按 latin1 解码，
 * 中文名会变乱码；此处按需还原（还原后出现替换符则保留原值）。
 */
function decodeUploadName(raw: string): string {
  const name = String(raw || '');
  if (!name) return '';
  if (!/[\u0080-\u00ff]/.test(name)) return name;
  const restored = Buffer.from(name, 'latin1').toString('utf8');
  return restored.includes('\uFFFD') ? name : restored;
}

/** 单文件接收中间件：把 multer 的错误（含超限）映射成统一 400。 */
function receiveSingleFile(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (error: unknown) => {
    if (!error) return next();
    const code = (error as { code?: string })?.code;
    const message = code === 'LIMIT_FILE_SIZE'
      ? `文件太大，单个文件不超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`
      : '文件上传失败，请重试';
    return res.status(400).json({ success: false, error: message });
  });
}

function requireUserId(req: Request, res: Response): string | null {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ success: false, error: '用户未认证' });
    return null;
  }
  return userId;
}

/** 上传一份资料并解析（只支持文本型；扫描件/老格式在 400 里带 reason）。 */
router.post('/', receiveSingleFile, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const file = (req as Request & { file?: { originalname?: string; buffer?: Buffer } }).file;
  if (!file?.buffer) {
    return res.status(400).json({ success: false, error: '没有收到文件' });
  }

  try {
    const result = await saveUploadedMaterial({
      userId,
      originalName: decodeUploadName(file.originalname || ''),
      buffer: file.buffer,
    });
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error: result.message,
        data: { reason: result.reason },
      });
    }
    return res.json({ success: true, data: result.record });
  } catch (error) {
    logger.error('上传资料失败:', error);
    return res.status(500).json({ success: false, error: '资料处理失败，请稍后重试' });
  }
});

/** 列出当前用户已上传（且解析成功）的资料。 */
router.get('/', (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    return res.json({ success: true, data: { items: listMaterials(userId) } });
  } catch (error) {
    logger.error('列出资料失败:', error);
    return res.status(500).json({ success: false, error: '获取资料列表失败，请稍后重试' });
  }
});

/** 读取单份资料正文（供前端预览与后续「资料→路径」消费）。 */
router.get('/:id', (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    const found = readMaterial(userId, String(req.params.id || ''));
    if (!found) return res.status(404).json({ success: false, error: '资料不存在' });
    return res.json({ success: true, data: { ...found.record, markdown: found.markdown } });
  } catch (error) {
    logger.error('读取资料失败:', error);
    return res.status(500).json({ success: false, error: '读取资料失败，请稍后重试' });
  }
});

/** 删除单份资料（只允许删自己的）。 */
router.delete('/:id', (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    const removed = deleteMaterial(userId, String(req.params.id || ''));
    if (!removed) return res.status(404).json({ success: false, error: '资料不存在' });
    return res.json({ success: true, data: { id: req.params.id } });
  } catch (error) {
    logger.error('删除资料失败:', error);
    return res.status(500).json({ success: false, error: '删除资料失败，请稍后重试' });
  }
});

export default router;
