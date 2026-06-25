/**
 * AttachmentsDrawer — right-side drawer listing session attachments.
 *
 * State lives entirely in the parent (ChatPage) so it's shared with the
 * drop overlay + clip button. This component is presentational: it
 * receives the list + handlers and renders.
 *
 * Placeholders (icons by MIME type) for thumbnails — we'll wire real
 * previews later (Object URL for images, gateway-rendered for PDFs).
 */

import { Button } from "@nous-research/ui/ui/components/button";
import {
  FileText,
  FileImage,
  FileCode,
  FileArchive,
  FileAudio,
  FileVideo,
  File as FileIcon,
  PanelRightClose,
  Trash2,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type AttachmentStatus = "uploading" | "uploaded" | "error";

export interface Attachment {
  /** Client-side unique id (uuid v4 or crypto.randomUUID). */
  id: string;
  name: string;
  /** Size in bytes. */
  size: number;
  /** MIME type, e.g. "image/png", "application/pdf". */
  mime: string;
  /** Raw data URL "data:<mime>;base64,..." — kept for the upload RPC. */
  dataUrl: string;
  /** Local lifecycle. */
  status: AttachmentStatus;
  /** Server-side path returned by the gateway after upload (status=uploaded). */
  refPath?: string;
  /** Server-side @file: ref returned by the gateway. */
  refText?: string;
  /** Error message if status=error. */
  error?: string;
}

interface AttachmentsDrawerProps {
  open: boolean;
  onClose: () => void;
  attachments: Attachment[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
}

/** Human-readable byte count. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Pick a lucide icon based on MIME type — placeholder, real thumbs later. */
function iconForMime(mime: string) {
  if (mime.startsWith("image/")) return FileImage;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime === "application/pdf" || mime.startsWith("text/")) return FileText;
  if (
    mime.includes("zip") ||
    mime.includes("tar") ||
    mime.includes("gzip") ||
    mime.includes("rar")
  ) {
    return FileArchive;
  }
  if (
    mime.startsWith("application/json") ||
    mime.includes("javascript") ||
    mime.includes("typescript") ||
    mime.includes("python") ||
    mime.includes("xml") ||
    mime.includes("yaml")
  ) {
    return FileCode;
  }
  return FileIcon;
}

/** Color hint by status — Apple system accents: amber for in-flight,
 *  green for success, red for failure. Used for both the status icon
 *  and the inline status label. */
function statusColor(status: AttachmentStatus): string {
  switch (status) {
    case "uploading":
      return "text-[#ff9500]";
    case "uploaded":
      return "text-[#34c759]";
    case "error":
      return "text-[#ff3b30]";
  }
}

export function AttachmentsDrawer({
  open,
  onClose,
  attachments,
  onRemove,
  onClearAll,
}: AttachmentsDrawerProps) {
  if (!open) return null;

  return (
    <aside
      role="complementary"
      aria-label="Session attachments"
      className={cn(
        "flex min-h-0 w-full flex-col overflow-hidden rounded-lg",
        "border border-[#e0e0e0]",
        "bg-white",
        "lg:w-80",
      )}
    >
      {/* Header */}
      <header
        className={cn(
          "flex shrink-0 items-center justify-between gap-2",
          "border-b border-[#f0f0f0]",
          "px-3 py-2",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-[#7a7a7a]">
            attachments
          </span>
          <span className="rounded border border-[#e0e0e0] px-1.5 py-0.5 font-mono text-[10px] text-[#7a7a7a]">
            {attachments.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {attachments.length > 0 && (
            <Button
              ghost
              onClick={onClearAll}
              title="Remove all attachments"
              aria-label="Clear all attachments"
              className="h-6 w-6 rounded p-0 text-[#7a7a7a] opacity-70 hover:opacity-100"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
          <Button
            ghost
            onClick={onClose}
            title="Close attachments drawer"
            aria-label="Close attachments drawer"
            className="h-6 w-6 rounded p-0 text-[#7a7a7a] opacity-70 hover:opacity-100"
          >
            <PanelRightClose className="h-3 w-3" />
          </Button>
        </div>
      </header>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {attachments.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <div className="font-mono text-[10px] uppercase tracking-widest text-[#7a7a7a]/60">
              no attachments yet
            </div>
            <div className="font-mono text-[10px] leading-relaxed text-[#7a7a7a]/80">
              drag files into the terminal
              <br />
              or use the clip button
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {attachments.map((att) => {
              const Icon = iconForMime(att.mime);
              const StatusIcon =
                att.status === "uploading"
                  ? Loader2
                  : att.status === "uploaded"
                    ? CheckCircle2
                    : AlertCircle;
              return (
                <li
                  key={att.id}
                  className={cn(
                    "group flex items-start gap-2 rounded border border-[#f0f0f0]",
                    "bg-white px-2 py-1.5",
                    "hover:border-[#e0e0e0] hover:bg-[#fafafc]",
                    "transition-colors",
                  )}
                >
                  {/* Icon (placeholder thumbnail) */}
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-[#f0f0f0] bg-[#f5f5f7]">
                    <Icon
                      className={cn("h-4 w-4", statusColor(att.status))}
                    />
                  </div>

                  {/* Meta */}
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate font-mono text-[11px] text-[#1d1d1f]"
                      title={att.name}
                    >
                      {att.name}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-[#7a7a7a]">
                      <span>{formatBytes(att.size)}</span>
                      <span className="text-[#7a7a7a]/40">•</span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1",
                          statusColor(att.status),
                        )}
                      >
                        <StatusIcon
                          className={cn(
                            "h-2.5 w-2.5",
                            att.status === "uploading" && "animate-spin",
                          )}
                        />
                        {att.status === "uploading"
                          ? "uploading"
                          : att.status === "uploaded"
                            ? "uploaded"
                            : (att.error || "error")}
                      </span>
                    </div>
                  </div>

                  {/* Remove */}
                  <Button
                    ghost
                    onClick={() => onRemove(att.id)}
                    title="Remove attachment"
                    aria-label={`Remove ${att.name}`}
                    className="h-6 w-6 shrink-0 rounded p-0 text-[#7a7a7a]/60 opacity-0 transition-opacity hover:text-[#ff3b30] group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
// updated: 2026-06-09T10:23:01Z — force re-trigger of docker-publish
