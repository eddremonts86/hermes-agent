/**
 * attachment-utils — small helpers for the file upload flow in ChatPage.
 */

/** MIME types we accept. Anything else is rejected at validation time. */
export const ALLOWED_MIME_PREFIXES = [
  "image/",
  "video/",
  "audio/",
  "text/",
] as const;

export const ALLOWED_MIME_EXACT = new Set<string>([
  "application/pdf",
  "application/json",
  "application/javascript",
  "application/typescript",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/zip",
  "application/x-tar",
  "application/gzip",
  "application/x-gzip",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/octet-stream", // generic — server still validates by content
]);

/** Hard size cap, in bytes. Default 25 MB — adjustable. */
export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

/**
 * Validate a File for the upload pipeline. Returns null on success, or
 * a human-readable error string on rejection.
 */
export function validateAttachment(file: File): string | null {
  if (file.size === 0) return "File is empty";
  if (file.size > MAX_ATTACHMENT_SIZE) {
    return `File is larger than ${Math.round(MAX_ATTACHMENT_SIZE / (1024 * 1024))} MB`;
  }
  const mime = file.type || "application/octet-stream";
  const prefixOk = ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p));
  const exactOk = ALLOWED_MIME_EXACT.has(mime);
  if (!prefixOk && !exactOk) {
    return `File type must be one of: images, video, audio, text, pdf, json, code, archives`;
  }
  return null;
}

/**
 * Read a File as a base64 data URL (without the `data:...` prefix
 * stripped). Returns the FULL data URL `data:<mime>;base64,<b64>` so
 * it's directly consumable by the gateway's `file.attach` RPC.
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
      } else {
        reject(new Error("FileReader returned a non-string result"));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

/** Stable unique id (we don't depend on crypto.randomUUID for older browsers). */
export function makeAttachmentId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
