// 上传资料 API（文本型文档）：上传即解析，被拒收的返回 400 + 可展示原因。
import api from '@/utils/api';

export interface MaterialStructure {
  pageCount: number | null;
  slideCount: number;
  sheetCount: number;
  headingCount: number;
  tableCount: number;
  listCount: number;
  paragraphCount: number;
  chunkCount: number;
}

/** 章节锚点（officeparser 的 closestHeading + 页码/幻灯片号），供后续「里程碑引用资料条目」。 */
export interface MaterialAnchor {
  heading: string;
  location: string;
  preview: string;
}

export interface UploadedMaterial {
  id: string;
  name: string;
  ext: string;
  format: string;
  /** 原始文件字节数。 */
  size: number;
  /** 抽取后的正文字符数。 */
  charCount: number;
  structure: MaterialStructure;
  anchors: MaterialAnchor[];
  warnings: string[];
  createdAt: string;
}

/** 上传单份资料（只支持文本型；失败时 reject 携带后端中文 message）。 */
export async function uploadMaterial(file: File): Promise<UploadedMaterial> {
  const form = new FormData();
  form.append('file', file, file.name);
  const response = (await api.post('/materials', form)) as unknown as {
    success: boolean;
    data: UploadedMaterial;
  };
  return response.data;
}

/** 当前用户已上传（且解析成功）的资料，新→旧。 */
export async function listMaterials(): Promise<UploadedMaterial[]> {
  const response = (await api.get('/materials')) as unknown as {
    success: boolean;
    data: { items: UploadedMaterial[] };
  };
  return response.data?.items || [];
}

/** 读取单份资料正文。 */
export async function readMaterial(id: string): Promise<UploadedMaterial & { markdown: string }> {
  const response = (await api.get(`/materials/${encodeURIComponent(id)}`)) as unknown as {
    success: boolean;
    data: UploadedMaterial & { markdown: string };
  };
  return response.data;
}

/**
 * 按章节取回资料原文窗口（引用定位；引文锚定优先、章节标题回退）。
 * anchored：quote=引文锚定 / title=标题定位 / none=回退全文开头。
 */
export async function readMaterialSection(
  id: string,
  params: { title?: string | null; quote?: string | null }
): Promise<{ excerpt: string; anchored: 'quote' | 'title' | 'none' }> {
  const search = new URLSearchParams();
  if (params.title) search.set('title', params.title);
  if (params.quote) search.set('quote', params.quote);
  const response = (await api.get(`/materials/${encodeURIComponent(id)}/section?${search.toString()}`)) as unknown as {
    success: boolean;
    data: { excerpt: string; anchored: 'quote' | 'title' | 'none' };
  };
  return response.data;
}

/** 删除单份资料。 */
export async function removeMaterial(id: string): Promise<void> {
  await api.delete(`/materials/${encodeURIComponent(id)}`);
}
