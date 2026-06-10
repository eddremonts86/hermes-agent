/**
 * chat-v2/lib/status — small helpers shared across components.
 *
 * Currently only the attachment status color/icon lookup, but a natural
 * home for other display-side helpers (e.g. timestamp formatting,
 * role-to-color).
 */

import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  FileImage,
  FileCode,
  FileArchive,
  FileAudio,
  FileVideo,
  File as FileIcon,
} from "lucide-react";
import type { Attachment } from "@/components/AttachmentsDrawer";

const MIMETYPE_PREFIX_ICONS = {
  "image/": FileImage,
  "video/": FileVideo,
  "audio/": FileAudio,
  "text/": FileText,
  "application/pdf": FileText,
  "application/json": FileCode,
  "application/javascript": FileCode,
  "application/typescript": FileCode,
  "application/xml": FileCode,
  "application/yaml": FileCode,
  "application/x-yaml": FileCode,
  "application/zip": FileArchive,
  "application/x-tar": FileArchive,
  "application/gzip": FileArchive,
  "application/x-gzip": FileArchive,
  "application/x-7z-compressed": FileArchive,
  "application/x-rar-compressed": FileArchive,
} as const;

const ARCHIVE_KEYWORDS = ["zip", "tar", "gzip", "rar", "7z"] as const;
const CODE_KEYWORDS = [
  "javascript",
  "typescript",
  "python",
  "xml",
  "yaml",
  "json",
] as const;

export function iconForAttachment(a: Attachment) {
  const mime = a.mime || "application/octet-stream";
  if (MIMETYPE_PREFIX_ICONS[mime as keyof typeof MIMETYPE_PREFIX_ICONS]) {
    return MIMETYPE_PREFIX_ICONS[mime as keyof typeof MIMETYPE_PREFIX_ICONS];
  }
  if (mime.startsWith("image/")) return FileImage;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime.startsWith("text/")) return FileText;
  if (ARCHIVE_KEYWORDS.some((k) => mime.includes(k))) return FileArchive;
  if (CODE_KEYWORDS.some((k) => mime.includes(k))) return FileCode;
  return FileIcon;
}

export function statusColorForAttachment(a: Attachment): {
  color: string;
  icon: typeof CheckCircle2;
} {
  switch (a.status) {
    case "uploading":
      return { color: "text-amber-300/80", icon: Loader2 };
    case "uploaded":
      return { color: "text-emerald-300/80", icon: CheckCircle2 };
    case "error":
      return { color: "text-red-300/80", icon: AlertCircle };
  }
}
