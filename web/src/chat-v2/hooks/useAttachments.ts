/**
 * useAttachments — file attachments managed by the chat composer.
 *
 * Mirrors the dashboard's v1 drop-zone + clip-button behavior but
 * without the xterm coupling:
 *
 *   - The drop target is the composer itself (not the terminal host).
 *   - The upload happens via `file.attach` JSON-RPC against the
 *     gateway's main `/api/ws` session (the same session the chat
 *     uses — session_id is passed through from useChatSession).
 *   - The resulting `ref_text` is stored in the attachment row so the
 *     composer can prepend it to the next user message.
 *
 * State lives in this hook so the drop overlay, the attachment strip
 * above the textarea, and the file picker button can all share it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  makeAttachmentId,
  readFileAsDataUrl,
  validateAttachment,
} from "@/lib/attachment-utils";
import type { Attachment } from "@/components/AttachmentsDrawer";
import type { GatewayClient } from "@/lib/gatewayClient";

export interface UseAttachmentsOptions {
  gateway: GatewayClient;
  /** Current chat session id (null while session is still being created). */
  sessionId: string | null;
}

export interface UseAttachments {
  attachments: Attachment[];
  uploading: boolean;
  /** Open the file picker. */
  pick: () => void;
  /** Bind to a hidden <input type="file" ref>. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Bind to the composer element to capture drag/drop. */
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  /** Hook into the <input type="file"> change event. */
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Programmatic add — useful for paste-to-upload. */
  add: (files: FileList | File[]) => Promise<void>;
  remove: (id: string) => void;
  clear: () => void;
  /**
   * Build the prefix that should be prepended to the next user
   * message, e.g. "@file:./foo.txt\n@file:./bar.md\n". Includes only
   * attachments that uploaded successfully.
   */
  promptPrefix: () => string;
}

export function useAttachments({
  gateway,
  sessionId,
}: UseAttachmentsOptions): UseAttachments {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragCounter = useRef(0);

  const add = useCallback(
    async (filesIn: FileList | File[]) => {
      const list = Array.from(filesIn);
      if (list.length === 0) return;
      if (!sessionId) {
        // The user attached a file before the session is ready. We still
        // stage the rows so they appear in the strip, but we mark them
        // as errored so the UI shows a hint.
        const placeholders: Attachment[] = list.map((f) => ({
          id: makeAttachmentId(),
          name: f.name || "untitled",
          size: f.size,
          mime: f.type || "application/octet-stream",
          dataUrl: "",
          status: "error",
          error: "session not ready yet — try again in a moment",
        }));
        setAttachments((prev) => [...prev, ...placeholders]);
        return;
      }

      const placeholders: Attachment[] = list.map((f) => {
        const validationError = validateAttachment(f);
        return {
          id: makeAttachmentId(),
          name: f.name || "untitled",
          size: f.size,
          mime: f.type || "application/octet-stream",
          dataUrl: "",
          status: validationError ? "error" : "uploading",
          error: validationError ?? undefined,
        };
      });
      setAttachments((prev) => [...prev, ...placeholders]);
      setUploading(true);

      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        const placeholder = placeholders[i];
        if (placeholder.status === "error") continue;
        try {
          const dataUrl = await readFileAsDataUrl(file);
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === placeholder.id ? { ...a, dataUrl } : a,
            ),
          );
          const result = await gateway.request<{
            attached: boolean;
            name: string;
            path: string;
            ref_path?: string;
            ref_text?: string;
            uploaded: boolean;
          }>("file.attach", {
            session_id: sessionId,
            name: file.name,
            data_url: dataUrl,
          });
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === placeholder.id
                ? {
                    ...a,
                    status: "uploaded",
                    refPath: result.ref_path ?? result.path,
                    refText: result.ref_text,
                  }
                : a,
            ),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === placeholder.id
                ? { ...a, status: "error", error: msg }
                : a,
            ),
          );
        }
      }
      setUploading(false);
    },
    [gateway, sessionId],
  );

  const pick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        void add(e.target.files);
        e.target.value = ""; // reset so the same file can be re-picked
      }
    },
    [add],
  );

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragCounter.current += 1;
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
  }, []);
  const onDragLeave = useCallback(
    (_e: React.DragEvent) => {
      dragCounter.current = Math.max(0, dragCounter.current - 1);
    },
    [],
  );
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      dragCounter.current = 0;
      void add(e.dataTransfer.files);
    },
    [add],
  );

  const remove = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clear = useCallback(() => {
    setAttachments([]);
  }, []);

  const promptPrefix = useCallback(() => {
    const ok = attachments
      .filter((a) => a.status === "uploaded" && a.refText)
      .map((a) => a.refText!.trim());
    if (ok.length === 0) return "";
    return ok.join("\n") + "\n";
  }, [attachments]);

  // Defensive: clean up the placeholder "error" rows after a moment if
  // they were added because the session wasn't ready.
  useEffect(() => {
    if (!sessionId) return;
    setAttachments((prev) =>
      prev.map((a) =>
        a.status === "error" && a.error === "session not ready yet — try again in a moment"
          ? { ...a, status: "uploading", error: undefined, dataUrl: "" }
          : a,
      ),
    );
  }, [sessionId]);

  return {
    attachments,
    uploading,
    pick,
    inputRef,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onInputChange,
    add,
    remove,
    clear,
    promptPrefix,
  };
}
