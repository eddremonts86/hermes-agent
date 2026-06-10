/**
 * ChatComposer — the bottom of the chat: textarea + attachments strip
 * + send button.
 *
 * Visual style: productivity app (Linear / Notion / Raycast). No
 * CRT/terminal vibes. Slate dark surfaces, single indigo accent,
 * rounded-2xl composer, soft shadow.
 *
 * Drag-and-drop, file picker, and paste-to-upload are all wired
 * here. The actual submit pre-pends the @file: refs (if any)
 * before calling the gateway's prompt.submit.
 */

import { useEffect, useRef } from "react";
import { Paperclip, Send, Square, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UseAttachments } from "../hooks/useAttachments";
import { statusColorForAttachment } from "../lib/status";
import { theme } from "../theme";

interface ChatComposerProps {
  busy: boolean;
  ready: boolean;
  onSubmit: (text: string) => void;
  onInterrupt?: () => void;
  attachmentsApi: UseAttachments;
  className?: string;
}

export function ChatComposer({
  busy,
  ready,
  onSubmit,
  onInterrupt,
  attachmentsApi,
  className,
}: ChatComposerProps) {
  const {
    attachments,
    uploading,
    pick,
    inputRef,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onInputChange,
    remove,
    promptPrefix,
  } = attachmentsApi;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow the textarea up to ~10 lines.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
  }, [attachments, busy]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const text = ta.value;
    if (!text.trim()) return;
    const prefix = promptPrefix();
    onSubmit(prefix + text);
    ta.value = "";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit(e);
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      void attachmentsApi.add(files);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        theme.bg.panel,
        theme.border.default,
        theme.radius.lg,
        "flex flex-col gap-3 border p-3 shadow-lg shadow-black/30",
        className,
      )}
      data-testid="chat-composer"
    >
      {/* Hidden file picker */}
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={onInputChange}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Attachments strip (above the textarea) */}
      {attachments.length > 0 && (
        <ul
          className="flex flex-wrap gap-1.5"
          data-testid="attachments-strip"
        >
          {attachments.map((a) => {
            const Icon = statusColorForAttachment(a).icon;
            return (
              <li
                key={a.id}
                className={cn(
                  theme.bg.elevated,
                  theme.border.subtle,
                  theme.radius.md,
                  "inline-flex items-center gap-1.5 border px-2 py-1",
                  "text-xs text-zinc-100",
                )}
              >
                <Icon
                  className={cn(
                    "h-3 w-3",
                    statusColorForAttachment(a).color,
                    a.status === "uploading" && "animate-spin",
                  )}
                />
                <span className="max-w-[12rem] truncate" title={a.name}>
                  {a.name}
                </span>
                {a.status === "uploading" && (
                  <span className="text-zinc-500">uploading…</span>
                )}
                {a.status === "error" && (
                  <span
                    className="text-rose-400"
                    title={a.error || "error"}
                  >
                    error
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  aria-label={`Remove ${a.name}`}
                  className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-zinc-400 hover:bg-zinc-700 hover:text-rose-400"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Textarea + actions */}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          rows={1}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            ready
              ? "Message Hermes… (Enter to send, Shift+Enter for newline, drop files anywhere)"
              : "Connecting to gateway…"
          }
          disabled={!ready}
          data-testid="chat-textarea"
          className={cn(
            theme.bg.elevated,
            theme.border.subtle,
            "min-h-[2.5rem] flex-1 resize-none rounded-lg border px-3 py-2",
            "text-sm text-zinc-100 placeholder:text-zinc-500",
            "focus:border-indigo-500/60 focus:outline-none focus:ring-1 focus:ring-indigo-500/40",
            "disabled:opacity-50",
          )}
        />

        <button
          type="button"
          onClick={pick}
          disabled={!ready}
          aria-label="Attach files"
          data-testid="chat-attach-button"
          className={cn(
            theme.bg.elevated,
            theme.border.subtle,
            "inline-flex h-9 w-9 items-center justify-center rounded-lg border",
            "text-zinc-300 transition-colors hover:border-indigo-500/60 hover:text-indigo-300",
            "disabled:opacity-50",
          )}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
        </button>

        {busy && onInterrupt ? (
          <button
            type="button"
            onClick={onInterrupt}
            aria-label="Stop generating"
            data-testid="chat-interrupt-button"
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10",
              "text-amber-300 transition-colors hover:border-amber-400/60 hover:bg-amber-500/20",
            )}
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!ready}
            aria-label="Send message"
            data-testid="chat-send-button"
            className={cn(
              theme.accent.bg,
              theme.accent.bgHover,
              "inline-flex h-9 w-9 items-center justify-center rounded-lg text-white",
              "transition-colors disabled:opacity-50",
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
    </form>
  );
}
