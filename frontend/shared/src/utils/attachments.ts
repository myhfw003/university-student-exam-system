/* ==========================================================================
   知行测评 · 题目附件规则
   --------------------------------------------------------------------------
   FR-CAT-05：支持上传图片附件（png / jpg / webp，单文件 ≤ 10 MB），
   存入对象存储，访问走短期签名 URL；题目删除时附件软删除。

   这里只放**前端可自检**的规则（类型、体积），存储与签名由后端负责。
   ========================================================================== */

/** 允许的图片类型。 */
export const ATTACHMENT_MIME_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

/** 单个附件的体积上限（10 MB）。 */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** 校验一个待上传文件。 */
export function validateAttachment(file: {
  name: string;
  type: string;
  size: number;
}): { ok: boolean; message?: string } {
  if (!ATTACHMENT_MIME_TYPES.includes(file.type)) {
    return { ok: false, message: `「${file.name}」不是支持的图片格式（png / jpg / webp）` };
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return { ok: false, message: `「${file.name}」超过 10 MB 上限` };
  }
  if (file.size === 0) {
    return { ok: false, message: `「${file.name}」是空文件` };
  }
  return { ok: true };
}

/** 读文件为 data URL（mock 模式本地展示用；后端模式下应改为直传对象存储）。 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

/** 文件大小的可读文案。 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
