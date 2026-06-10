/**
 * ChatPage — embeds `hermes --tui` inside the dashboard.
 *
 *   <div host> (dashboard chrome)                                         .
 *     └─ <div wrapper> (rounded, dark bg, padded — the "terminal window"  .
 *         look that gives the page a distinct visual identity)            .
 *         └─ @xterm/xterm Terminal (WebGL renderer, Unicode 11 widths)    .
 *              │ onData      keystrokes → WebSocket → PTY master          .
 *              │ onResize    terminal resize → `\x1b[RESIZE:cols;rows]`   .
 *              │ write(data) PTY output bytes → VT100 parser              .
 *              ▼                                                          .
 *     WebSocket /api/pty?token=<session>                                  .
 *          ▼                                                              .
 *     FastAPI pty_ws  (hermes_cli/web_server.py)                          .
 *          ▼                                                              .
 *     POSIX PTY → `node ui-tui/dist/entry.js` → tui_gateway + AIAgent     .
 */

import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@nous-research/ui/ui/components/button";
import { Typography } from "@nous-research/ui/ui/components/typography/index";
import { HERMES_BASE_PATH, buildWsAuthParam } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Copy, Paperclip, PanelRight, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";

import {
  AttachmentsDrawer,
  type Attachment,
} from "@/components/AttachmentsDrawer";
import { ChatSidebar } from "@/components/ChatSidebar";
import { usePageHeader } from "@/contexts/usePageHeader";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import {
  makeAttachmentId,
  readFileAsDataUrl,
  validateAttachment,
} from "@/lib/attachment-utils";
import { GatewayClient } from "@/lib/gatewayClient";
import { PluginSlot } from "@/plugins";
import { useTheme } from "@/themes";

function buildWsUrl(
  authParam: [string, string],
  resume: string | null,
  channel: string,
): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  // ``authParam`` is ``["token", <session>]`` in loopback mode and
  // ``["ticket", <minted>]`` in gated mode. The server-side helper
  // ``_ws_auth_ok`` picks whichever shape matches the current gate state.
  const qs = new URLSearchParams({ [authParam[0]]: authParam[1], channel });
  if (resume) qs.set("resume", resume);
  return `${proto}//${window.location.host}${HERMES_BASE_PATH}/api/pty?${qs.toString()}`;
}

// Channel id ties this chat tab's PTY child (publisher) to its sidebar
// (subscriber).  Generated once per mount so a tab refresh starts a fresh
// channel — the previous PTY child terminates with the old WS, and its
// channel auto-evicts when no subscribers remain.
function generateChannelId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `chat-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

// Colors for the terminal body.  Matches the dashboard's dark teal canvas
// with cream foreground — we intentionally don't pick monokai or a loud
// theme, because the TUI's skin engine already paints the content; the
// terminal chrome just needs to sit quietly inside the dashboard.
// `background` is omitted here — it's supplied dynamically from the active
// theme's `terminalBackground` field so users can control it via YAML themes.
const TERMINAL_THEME_STATIC = {
  foreground: "#f0e6d2",
  cursor: "#f0e6d2",
  cursorAccent: "#0d2626",
  selectionBackground: "#f0e6d244",
};

/**
 * CSS width for xterm font tiers.
 *
 * Prefer the terminal host's `clientWidth` — Chrome DevTools device mode often
 * keeps `window.innerWidth` at the full desktop value while the *drawn* layout
 * is phone-sized, which made us pick desktop font sizes (~14px) and look huge.
 */
function terminalTierWidthPx(host: HTMLElement | null): number {
  if (typeof window === "undefined") return 1280;
  const fromHost = host?.clientWidth ?? 0;
  if (fromHost > 2) return Math.round(fromHost);
  const doc = document.documentElement?.clientWidth ?? 0;
  const vv = window.visualViewport;
  const inner = window.innerWidth;
  const vvw = vv?.width ?? inner;
  const layout = Math.min(inner, vvw, doc > 0 ? doc : inner);
  return Math.max(1, Math.round(layout));
}

function terminalFontSizeForWidth(layoutWidthPx: number): number {
  if (layoutWidthPx < 300) return 7;
  if (layoutWidthPx < 360) return 8;
  if (layoutWidthPx < 420) return 9;
  if (layoutWidthPx < 520) return 10;
  if (layoutWidthPx < 720) return 11;
  if (layoutWidthPx < 1024) return 12;
  return 14;
}

function terminalLineHeightForWidth(layoutWidthPx: number): number {
  return layoutWidthPx < 1024 ? 1.02 : 1.15;
}

export default function ChatPage({ isActive = true }: { isActive?: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Exposed to the main metrics-sync effect so it can refit the terminal
  // the moment `isActive` flips back to true (display:none → display:flex
  // collapses the host's box, so ResizeObserver never fires on return).
  const syncMetricsRef = useRef<(() => void) | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // Lazy-init: the missing-token check happens at construction so the effect
  // body doesn't have to setState (React 19's set-state-in-effect rule).
  // In gated (OAuth) mode the server intentionally omits the session token —
  // the SPA authenticates the WS via a single-use ticket (buildWsAuthParam),
  // so a missing token there is expected, not an error.
  const [banner, setBanner] = useState<string | null>(() =>
    typeof window !== "undefined" &&
    !window.__HERMES_SESSION_TOKEN__ &&
    !window.__HERMES_AUTH_REQUIRED__
      ? "Session token unavailable. Open this page through `hermes dashboard`, not directly."
      : null,
  );
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------------
  // Attachments: list lives in RAM for the lifetime of the page mount.
  //   - drop on the xterm host (or click the 📎 button) → add to list, then
  //     call `file.attach` JSON-RPC on the gateway.
  //   - drawer is collapsible from the right; same panel slot as ChatSidebar
  //     (chat-side-panel) when the viewport is wide.
  // ---------------------------------------------------------------------------
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** GatewayClient reused across the session — created lazily on first attach. */
  const attachGwRef = useRef<GatewayClient | null>(null);
  /**
   * Real chat session ID (the `Session: a4799d27` hex shown in the TUI
   * banner), captured from the PTY's stdout. file.attach MUST be called
   * with this — NOT with `window.__HERMES_SESSION_TOKEN__`, which is the
   * HTTP auth token, not a session id. The previous code passed the auth
   * token and the gateway returned "session not found", so the attachment
   * was never staged, the @file: ref was never generated, and the agent
   * had no context for the user's "summarize the file" prompt.
   */
  const chatSessionIdRef = useRef<string | null>(null);

  /**
   * Get or create a GatewayClient for the attachment RPC. The client
   * connects on first use; subsequent calls reuse the live socket.
   */
  const getAttachGateway = useCallback(async (): Promise<GatewayClient> => {
    if (!attachGwRef.current) {
      const gw = new GatewayClient();
      await gw.connect();
      attachGwRef.current = gw;
    }
    return attachGwRef.current;
  }, []);

  /**
   * Stage a File into local state, then ship it to the gateway via
   * `file.attach`. Errors are captured per-attachment so the UI can
   * show "error" state for that one file without losing the rest.
   */
  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      // Pre-validate and create placeholder rows.
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

      // The gateway's file.attach RPC needs the *chat* session id (the
      // hex shown as "Session: a4799d27" in the TUI banner), NOT the
      // HTTP auth token from window.__HERMES_SESSION_TOKEN__. The auth
      // token only authorizes the WebSocket; the session id is what
      // identifies which conversation the attachment belongs to.
      //
      // The chat session id is captured by parsing the TUI's stdout
      // (see ws.onmessage below). If the user attaches before the
      // banner has been emitted, fail fast with a clear message.
      const chatSessionId = chatSessionIdRef.current;
      if (!chatSessionId) {
        const msg =
          "Chat session isn't ready yet — wait a moment for the TUI to start, then try again.";
        setAttachments((prev) =>
          prev.map((a) =>
            a.status === "uploading" ? { ...a, status: "error", error: msg } : a,
          ),
        );
        return;
      }

      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        const placeholder = placeholders[i];
        if (placeholder.status === "error") continue;

        try {
          const dataUrl = await readFileAsDataUrl(file);
          // Persist the dataUrl in the row so retries work without re-reading.
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === placeholder.id ? { ...a, dataUrl } : a,
            ),
          );

          const gw = await getAttachGateway();
          const result = await gw.request<{
            attached: boolean;
            name: string;
            path: string;
            ref_path?: string;
            ref_text?: string;
            uploaded: boolean;
          }>("file.attach", {
            session_id: chatSessionId,
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

          // Auto-inject the @file: ref into the chat input so the user
          // can simply type their question and hit Enter — the TUI's
          // prompt builder will pick up the @file: token and read the
          // staged file as context for the next turn.
          //
          // This mirrors the desktop's behavior (see
          // `terminalContextBlocksFromDraft` + addComposerAttachment in
          // apps/desktop): we paste the ref into the terminal so it
          // appears on the prompt line, then focus the terminal so the
          // user's keystrokes continue from there.
          if (result.ref_text) {
            const term = termRef.current;
            if (term) {
              // Prepend a leading space when something is already on the
              // prompt line so we don't mash into existing text. The TUI
              // also handles bracketed-paste correctly when the host has
              // it enabled, which the chat xterm does.
              //
              // IMPORTANT: don't wrap the ref in \n. The TUI's input
              // buffer treats a bare CR/LF as a submit, so wrapping
              // would fire a submission containing just the ref
              // *before* the user types their prompt — the agent
              // would never see both together. Instead, paste the
              // ref with a single leading space and a trailing space,
              // so it lives in the same line as the user's prompt:
              // the user keeps typing after the ref and a single
              // Enter submits the whole buffer at once.
              const refToken = result.ref_text.trimEnd();
              term.paste(` ${refToken} `);
              term.focus();
            }
          }
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
    },
    [getAttachGateway],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  /**
   * Drag-and-drop handlers. Counter trick so the overlay doesn't
   * flicker as the cursor crosses child elements — we only flip
   * "isDragging" to true on the first dragenter and back to false
   * on the matching dragleave/drop.
   */
  const onDragEnterTerminal = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) setIsDragging(true);
  }, []);
  const onDragOverTerminal = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
  }, []);
  const onDragLeaveTerminal = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);
  const onDropTerminal = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragging(false);
      void handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const onPickFiles = useCallback(() => {
    // If we already have attachments, the 📎 button toggles the drawer
    // instead of opening a fresh picker — saves a click. When the list
    // is empty, it opens the native file picker.
    if (attachments.length > 0) {
      setAttachmentsOpen((v) => !v);
    } else {
      fileInputRef.current?.click();
    }
  }, [attachments.length]);
  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        void handleFiles(e.target.files);
        // Reset so picking the same file again re-triggers onChange.
        e.target.value = "";
      }
    },
    [handleFiles],
  );

  // Cleanup the gateway client on unmount.
  useEffect(() => {
    return () => {
      attachGwRef.current?.close();
      attachGwRef.current = null;
    };
  }, []);
  // Raw state for the mobile side-sheet + a derived value that force-
  // closes whenever the chat tab isn't active.  The *derived* value is
  // what side-effects (body-scroll lock, keydown listener, portal render)
  // key on — that way switching to another tab triggers the effect's
  // cleanup, releasing the scroll-lock on /sessions etc.  Returning to
  // /chat re-runs the effect (derived flips back to true) and re-locks.
  // Keying on the raw state would leak the body.overflow="hidden" across
  // tabs because the dep wouldn't change on tab switch.
  const [mobilePanelOpenRaw, setMobilePanelOpenRaw] = useState(false);
  const mobilePanelOpen = isActive && mobilePanelOpenRaw;
  const { setEnd } = usePageHeader();
  const { t } = useI18n();
  const closeMobilePanel = useCallback(() => setMobilePanelOpenRaw(false), []);
  const modelToolsLabel = useMemo(
    () => `${t.app.modelToolsSheetTitle} ${t.app.modelToolsSheetSubtitle}`,
    [t.app.modelToolsSheetSubtitle, t.app.modelToolsSheetTitle],
  );
  const [portalRoot] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" ? document.body : null,
  );
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 1023px)").matches
      : false,
  );

  const { theme } = useTheme();
  const terminalBg = theme.terminalBackground ?? "#000000";
  const terminalTheme = useMemo(
    () => ({ ...TERMINAL_THEME_STATIC, background: terminalBg }),
    [terminalBg],
  );

  // The dashboard keeps ChatPage mounted persistently so the PTY survives tab
  // switches. That is great for ordinary /chat navigation, but it means query
  // param changes do NOT remount the component. Resume-in-chat from the
  // Sessions page relies on `/chat?resume=<id>` changing at runtime, so we must
  // treat the current resume target as part of the PTY identity and rebuild the
  // terminal session when it changes.
  const resumeParam = searchParams.get("resume");
  const channel = useMemo(() => generateChannelId(), [resumeParam]);

  useEffect(() => {
    if (!resumeParam) return;

    let cancelled = false;

    api
      .getSessionLatestDescendant(resumeParam)
      .then((res) => {
        if (cancelled || !res.session_id || res.session_id === resumeParam) {
          return;
        }

        const next = new URLSearchParams(searchParams);
        next.set("resume", res.session_id);
        setSearchParams(next, { replace: true });
      })
      .catch(() => {
        // Best-effort: old servers or missing sessions should not block chat.
      });

    return () => {
      cancelled = true;
    };
  }, [resumeParam, searchParams, setSearchParams]);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1023px)");
    const sync = () => setNarrow(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!mobilePanelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMobilePanel();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [mobilePanelOpen, closeMobilePanel]);

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMobilePanelOpenRaw(false);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    // When hidden (non-chat tab) we must not register the header button —
    // another page owns the header's end slot at that point.
    if (!isActive) {
      setEnd(null);
      return;
    }
    if (!narrow) {
      setEnd(null);
      return;
    }
    setEnd(
      <Button
        ghost
        onClick={() => setMobilePanelOpenRaw(true)}
        aria-expanded={mobilePanelOpen}
        aria-controls="chat-side-panel"
        className={cn(
          "shrink-0 rounded border border-current/20",
          "px-2 py-1 text-xs font-medium tracking-wide",
          "text-text-secondary hover:text-midground hover:bg-midground/5",
        )}
      >
        <span className="inline-flex items-center gap-1.5">
          <PanelRight className="h-3 w-3 shrink-0" />
          {modelToolsLabel}
        </span>
      </Button>,
    );
    return () => setEnd(null);
  }, [isActive, narrow, mobilePanelOpen, modelToolsLabel, setEnd]);

  const handleCopyLast = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Send the slash as a burst, wait long enough for Ink's tokenizer to
    // emit a keypress event for each character (not coalesce them into a
    // paste), then send Return as its own event.  The timing here is
    // empirical — 100ms is safely past Node's default stdin coalescing
    // window and well inside UI responsiveness.
    ws.send("/copy");
    setTimeout(() => {
      const s = wsRef.current;
      if (s && s.readyState === WebSocket.OPEN) s.send("\r");
    }, 100);
    setCopyState("copied");
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => setCopyState("idle"), 1500);
    termRef.current?.focus();
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const token = window.__HERMES_SESSION_TOKEN__;
    const gated = !!window.__HERMES_AUTH_REQUIRED__;
    // Banner already initialised above; just bail before wiring xterm/WS.
    // In gated mode the token is absent by design — buildWsAuthParam() mints
    // a WS ticket instead, so don't bail; let the effect reach that path.
    if (!token && !gated) {
      return;
    }

    const tierW0 = terminalTierWidthPx(host);
    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily:
        "'JetBrains Mono', 'Cascadia Mono', 'Fira Code', 'MesloLGS NF', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
      fontSize: terminalFontSizeForWidth(tierW0),
      lineHeight: terminalLineHeightForWidth(tierW0),
      letterSpacing: 0,
      fontWeight: "400",
      fontWeightBold: "700",
      macOptionIsMeta: true,
      // Hold Option (Alt on Linux/Windows) to force native text selection
      // even when the inner Hermes TUI has enabled xterm mouse-events
      // mode (CSI ?1000h family). Without this, click-and-drag in the
      // chat canvas selects nothing and Cmd+C falls back to copying the
      // entire visible buffer, which is rarely what the user wants.
      // See #25720.
      macOptionClickForcesSelection: true,
      // Right-click selects the word under the pointer. xterm.js default
      // is false; enabling it gives users a single-action selection
      // path on top of the modifier-based bypass above.
      rightClickSelectsWord: true,
      // Browser-embedded chat runs the TUI in inline mode. Keep transcript
      // history in xterm.js so the browser wheel can scroll it directly.
      scrollback: 5000,
      theme: terminalTheme,
    });
    termRef.current = term;

    // --- Clipboard integration ---------------------------------------
    //
    // Three independent paths all route to the system clipboard:
    //
    //   1. **Selection → Ctrl+C (or Cmd+C on macOS).**  Ink's own handler
    //      in useInputHandlers.ts turns Ctrl+C into a copy when the
    //      terminal has a selection, then emits an OSC 52 escape.  Our
    //      OSC 52 handler below decodes that escape and writes to the
    //      browser clipboard — so the flow works just like it does in
    //      `hermes --tui`.
    //
    //   2. **Ctrl/Cmd+Shift+C.**  Belt-and-suspenders shortcut that
    //      operates directly on xterm's selection, useful if the TUI
    //      ever stops listening (e.g. overlays / pickers) or if the user
    //      has selected with the mouse outside of Ink's selection model.
    //
    //   3. **Ctrl/Cmd+Shift+V.**  Reads the system clipboard and feeds
    //      it to the terminal as keyboard input.  xterm's paste() wraps
    //      it with bracketed-paste if the host has that mode enabled.
    //
    // OSC 52 reads (terminal asking to read the clipboard) are not
    // supported — that would let any content the TUI renders exfiltrate
    // the user's clipboard.
    term.parser.registerOscHandler(52, (data) => {
      // Format: "<targets>;<base64 | '?'>"
      const semi = data.indexOf(";");
      if (semi < 0) return false;
      const payload = data.slice(semi + 1);
      if (payload === "?" || payload === "") return false; // read/clear — ignore
      try {
        const binary = atob(payload);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        const text = new TextDecoder("utf-8").decode(bytes);
        navigator.clipboard.writeText(text).catch((err) => {
          // Most common reason: the Clipboard API requires a user gesture.
          // This can fail when the OSC 52 response arrives outside the
          // original keydown event's activation. Log to aid debugging.
          console.warn("[dashboard clipboard] OSC 52 write failed:", err.message);
        });
      } catch {
        console.warn("[dashboard clipboard] malformed OSC 52 payload");
      }
      return true;
    });

    const isMac =
      typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== "keydown") return true;

      // Copy: Cmd+C on macOS, Ctrl+Shift+C on other platforms. Bare Ctrl+C
      // is reserved for SIGINT to the TUI child — matches xterm / gnome-terminal /
      // konsole / Windows Terminal. Ctrl+Shift+C only copies if a selection exists;
      // without a selection it passes through to the TUI so agents can still
      // react to the keypress.
      // Paste: Cmd+Shift+V on macOS, Ctrl+Shift+V on others.
      const copyModifier = isMac ? ev.metaKey : ev.ctrlKey && ev.shiftKey;
      const pasteModifier = isMac ? ev.metaKey : ev.ctrlKey && ev.shiftKey;

      if (copyModifier && ev.key.toLowerCase() === "c") {
        const sel = term.getSelection();
        if (sel) {
          // Direct writeText inside the keydown handler preserves the user
          // gesture — async round-trips through OSC 52 can lose activation
          // and fail with "Document is not focused".
          navigator.clipboard.writeText(sel).catch((err) => {
            console.warn("[dashboard clipboard] direct copy failed:", err.message);
          });
          // Clear xterm.js's highlight after copy (matches gnome-terminal).
          term.clearSelection();
          ev.preventDefault();
          return false;
        }
        // No selection → fall through so the TUI receives Ctrl+Shift+C
        // (or the bare ev if the user used a different modifier).
      }

      if (pasteModifier && ev.key.toLowerCase() === "v") {
        navigator.clipboard
          .readText()
          .then((text) => {
            if (text) term.paste(text);
          })
          .catch((err) => {
            console.warn("[dashboard clipboard] paste failed:", err.message);
          });
        ev.preventDefault();
        return false;
      }

      return true;
    });

    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);

    // Dashboard chat should scroll the browser-side transcript, not send
    // mouse-wheel protocol bytes through the PTY.
    term.attachCustomWheelEventHandler((ev) => {
      const delta = ev.deltaY;
      if (!delta) {
        return false;
      }

      const step = Math.max(1, Math.round(Math.abs(delta) / 50));
      term.scrollLines(delta > 0 ? step : -step);

      ev.preventDefault();
      ev.stopPropagation();
      return false;
    });

    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";

    term.loadAddon(new WebLinksAddon());

    term.open(host);

    // WebGL draws from a texture atlas sized with device pixels. On phones and
    // in DevTools device mode that often produces *visually* much larger cells
    // than `fontSize` suggests — users see "huge" text even at 7–9px settings.
    // The canvas/DOM renderer tracks `fontSize` faithfully; use it for narrow
    // hosts.  Wide layouts still get WebGL for crisp box-drawing.
    const useWebgl = terminalTierWidthPx(host) >= 768;
    if (useWebgl) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch (err) {
        console.warn(
          "[hermes-chat] WebGL renderer unavailable; falling back to default",
          err,
        );
      }
    }

    // Initial fit + resize observer.  fit.fit() reads the container's
    // current bounding box and resizes the terminal grid to match.
    //
    // The subtle bit: the dashboard has CSS transitions on the container
    // (backdrop fade-in, rounded corners settling as fonts load).  If we
    // call fit() at mount time, the bounding box we measure is often 1-2
    // cell widths off from the final size.  ResizeObserver *does* fire
    // when the container settles, but if the pixel delta happens to be
    // smaller than one cell's width, fit() computes the same integer
    // (cols, rows) as before and doesn't emit onResize — so the PTY
    // never learns the final size.  Users see truncated long lines until
    // they resize the browser window.
    //
    // We force one extra fit + explicit RESIZE send after two animation
    // frames.  rAF→rAF guarantees one layout commit between the two
    // callbacks, giving CSS transitions and font metrics time to finalize
    // before we take the authoritative measurement.
    let hostSyncRaf = 0;
    const scheduleHostSync = () => {
      if (hostSyncRaf) return;
      hostSyncRaf = requestAnimationFrame(() => {
        hostSyncRaf = 0;
        syncTerminalMetrics();
      });
    };

    let metricsDebounce: ReturnType<typeof setTimeout> | null = null;
    const syncTerminalMetrics = () => {
      // display:none hosts have clientWidth/Height = 0, which fit() turns
      // into a 1x1 terminal.  Skip entirely while hidden; the visibility
      // effect below runs another fit as soon as the tab is shown again.
      if (!host.isConnected || host.clientWidth <= 0 || host.clientHeight <= 0) {
        return;
      }
      const w = terminalTierWidthPx(host);
      const nextSize = terminalFontSizeForWidth(w);
      const nextLh = terminalLineHeightForWidth(w);
      const fontChanged =
        term.options.fontSize !== nextSize ||
        term.options.lineHeight !== nextLh;
      if (fontChanged) {
        term.options.fontSize = nextSize;
        term.options.lineHeight = nextLh;
      }
      try {
        fit.fit();
      } catch {
        return;
      }
      if (fontChanged && term.rows > 0) {
        try {
          term.refresh(0, term.rows - 1);
        } catch {
          /* ignore */
        }
      }
      if (
        fontChanged &&
        wsRef.current &&
        wsRef.current.readyState === WebSocket.OPEN
      ) {
        wsRef.current.send(`\x1b[RESIZE:${term.cols};${term.rows}]`);
      }
    };
    syncMetricsRef.current = syncTerminalMetrics;

    const scheduleSyncTerminalMetrics = () => {
      if (metricsDebounce) clearTimeout(metricsDebounce);
      metricsDebounce = setTimeout(() => {
        metricsDebounce = null;
        syncTerminalMetrics();
      }, 60);
    };

    const ro = new ResizeObserver(() => scheduleHostSync());
    ro.observe(host);

    window.addEventListener("resize", scheduleSyncTerminalMetrics);
    window.visualViewport?.addEventListener("resize", scheduleSyncTerminalMetrics);
    scheduleHostSync();
    requestAnimationFrame(() => scheduleHostSync());

    // Double-rAF authoritative fit.  On the second frame the layout has
    // committed at least once since mount; fit.fit() then reads the
    // stable container size.  We always send a RESIZE escape afterwards
    // (even if fit's cols/rows didn't change, so the PTY has the same
    // dims registered as our JS state — prevents a drift where Ink
    // thinks the terminal is one col bigger than what's on screen).
    let settleRaf1 = 0;
    let settleRaf2 = 0;
    settleRaf1 = requestAnimationFrame(() => {
      settleRaf1 = 0;
      settleRaf2 = requestAnimationFrame(() => {
        settleRaf2 = 0;
        syncTerminalMetrics();
      });
    });

    // WebSocket. In gated mode (``window.__HERMES_AUTH_REQUIRED__``) this
    // awaits a single-use ticket via /api/auth/ws-ticket before opening;
    // in loopback mode it resolves synchronously against the injected
    // session token. The IIFE keeps the outer effect synchronous so its
    // ``return cleanup`` stays at the top level; handlers + disposables
    // are hoisted to ``let`` bindings the cleanup closes over.
    let unmounting = false;
    let onDataDisposable: { dispose(): void } | null = null;
    let onResizeDisposable: { dispose(): void } | null = null;
    void (async () => {
      const authParam = await buildWsAuthParam();
      if (unmounting) return;
      const url = buildWsUrl(authParam, resumeParam, channel);
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

    ws.onopen = () => {
      setBanner(null);
      // Send the initial RESIZE immediately so Ink has *a* size to lay
      // out against on its first paint.  The double-rAF block above will
      // follow up with the authoritative measurement — at worst Ink
      // reflows once after the PTY boots, which is imperceptible.
      ws.send(`\x1b[RESIZE:${term.cols};${term.rows}]`);
    };

    ws.onmessage = (ev) => {
      // Decode the chunk once. xterm.js accepts both string and binary
      // frames; for the session-id scan we just need a string view.
      const chunk =
        typeof ev.data === "string"
          ? ev.data
          : new TextDecoder("utf-8", { fatal: false }).decode(
              new Uint8Array(ev.data as ArrayBuffer),
            );

      // Capture the chat session id from the TUI banner so file.attach
      // can target the right session. The banner prints the line
      //   "Session: a4799d27"
      // (sometimes wrapped in SGR color codes). We strip ANSI before
      // matching, and only set the ref once — once captured, the session
      // id is stable for the lifetime of the chat tab.
      if (!chatSessionIdRef.current) {
        // eslint-disable-next-line no-control-regex -- stripping CSI/OSC sequences emitted by the TUI
        const stripped = chunk.replace(
          /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,
          "",
        );
        const m = stripped.match(/\bSession:\s*([a-f0-9]{6,})\b/i);
        if (m) {
          chatSessionIdRef.current = m[1];
          // Surfaced for debugging the "attachment session not found" bug.
          console.info("[chat] captured session id:", m[1]);
        }
      }

      if (typeof ev.data === "string") {
        term.write(ev.data);
      } else {
        term.write(new Uint8Array(ev.data as ArrayBuffer));
      }
    };

    ws.onclose = (ev) => {
      wsRef.current = null;
      if (unmounting) {
        return;
      }
      // Surface the real cause to the browser console on every close so a
      // "chat won't connect" report can be diagnosed without server access.
      // The server sends a machine-parseable reason on every rejection (see
      // pty_ws in web_server.py); echo it verbatim alongside the close code.
      const why = ev.reason ? ` reason=${ev.reason}` : "";
      console.warn(`[chat] PTY WebSocket closed code=${ev.code}${why}`);
      if (ev.code === 4401) {
        setBanner(
          ev.reason
            ? `Auth failed (${ev.reason}). Reload to refresh the session.`
            : "Auth failed. Reload the page to refresh the session token.",
        );
        return;
      }
      if (ev.code === 4403) {
        // Host/Origin mismatch (DNS-rebinding guard).
        setBanner(
          ev.reason
            ? `Refused: ${ev.reason}.`
            : "Refused: request host/origin doesn't match the dashboard.",
        );
        return;
      }
      if (ev.code === 4404) {
        setBanner(
          "Embedded chat is disabled on this server (start it with --tui).",
        );
        return;
      }
      if (ev.code === 4408) {
        setBanner(
          ev.reason
            ? `Refused: ${ev.reason}.`
            : "Refused: your client isn't permitted (server bound to localhost only).",
        );
        return;
      }
      if (ev.code === 1011) {
        // Server already wrote an ANSI error frame.
        return;
      }
      term.write(
        `\r\n\x1b[90m[session ended (code ${ev.code})]\x1b[0m\r\n`,
      );
    };

    // Keystrokes → PTY.
    //
    // IMPORTANT:
    // The embedded web chat has occasionally surfaced stray letters/digits
    // in the input line after a turn completes. The most likely culprit is
    // browser-side terminal control traffic being forwarded back into the
    // PTY as if it were user text. SGR mouse tracking is the highest-risk
    // path here: xterm.js emits raw CSI reports (`\x1b[<...`) that look like
    // ordinary bytes to the backend.
    //
    // For the browser embed we prefer input stability over terminal-style
    // mouse reporting, so we drop SGR mouse reports entirely instead of
    // forwarding them into Hermes. Keyboard input, paste, and resize still
    // behave normally.
      // eslint-disable-next-line no-control-regex -- intentional ESC byte in xterm SGR mouse report parser
      const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;
      onDataDisposable = term.onData((data) => {
        if (ws.readyState !== WebSocket.OPEN) return;

        if (SGR_MOUSE_RE.test(data)) {
          return;
        }

        ws.send(data);
      });

      onResizeDisposable = term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(`\x1b[RESIZE:${cols};${rows}]`);
        }
      });
    })();

    term.focus();

    return () => {
      unmounting = true;
      syncMetricsRef.current = null;
      onDataDisposable?.dispose();
      onResizeDisposable?.dispose();
      if (metricsDebounce) clearTimeout(metricsDebounce);
      window.removeEventListener("resize", scheduleSyncTerminalMetrics);
      window.visualViewport?.removeEventListener(
        "resize",
        scheduleSyncTerminalMetrics,
      );
      ro.disconnect();
      if (hostSyncRaf) cancelAnimationFrame(hostSyncRaf);
      if (settleRaf1) cancelAnimationFrame(settleRaf1);
      if (settleRaf2) cancelAnimationFrame(settleRaf2);
      // Phase 5.3: ``ws`` is local to the IIFE that opens it (the gated-mode
      // ticket fetch makes the open async). The cleanup runs at the outer
      // effect's top level so it can't reach into that scope — close via
      // the ref instead. ``?.`` covers the race where unmount fires before
      // the ticket fetch resolves and ``wsRef.current`` was never assigned.
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current);
        copyResetRef.current = null;
      }
    };
  }, [channel, resumeParam]);

  // When the user returns to the chat tab (isActive: false → true), the
  // terminal host just transitioned from display:none to display:flex.
  // ResizeObserver won't fire on that kind of style-driven box change —
  // xterm thinks its grid is still whatever it was when the tab was
  // hidden (or 0×0, if it was hidden before first fit).  Force a refit
  // after two animation frames so layout has committed.
  //
  // Focus handling: we only steal focus back into the terminal when
  // nothing else inside ChatPage was holding it (typically the first
  // activation after mount, where document.activeElement is <body>; or
  // a return after the user had been typing in the terminal, where
  // focus was already on the xterm textarea before the tab got hidden
  // and has since fallen back to <body>).  If the user had clicked
  // into the sidebar (model picker, tool-call entry) before switching
  // tabs, we must not yank focus away from wherever they left it when
  // they come back — that's a surprise and an a11y foot-gun.
  useEffect(() => {
    if (!isActive) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf1 = 0;
      raf2 = requestAnimationFrame(() => {
        raf2 = 0;
        syncMetricsRef.current?.();
        const host = hostRef.current;
        const active = typeof document !== "undefined"
          ? document.activeElement
          : null;
        const focusIsElsewhereInChatPage =
          active !== null &&
          active !== document.body &&
          host !== null &&
          !host.contains(active);
        if (!focusIsElsewhereInChatPage) {
          termRef.current?.focus();
        }
      });
    });
    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [isActive]);

  // Keep the live xterm theme in sync when the active theme's terminal
  // background changes (e.g. user switches to a custom YAML theme mid-session).
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = { ...TERMINAL_THEME_STATIC, background: terminalBg };
  }, [terminalBg]);

  // Layout:
  //   outer flex column — sits inside the dashboard's content area
  //   row split — terminal pane (flex-1) + sidebar (fixed width, lg+)
  //   terminal wrapper — rounded, dark, padded — the "terminal window"
  //   floating copy button — bottom-right corner, transparent with a
  //     subtle border; stays out of the way until hovered.  Sends
  //     `/copy\n` to Ink, which emits OSC 52 → our clipboard handler.
  //   sidebar — ChatSidebar opens its own JSON-RPC sidecar; renders
  //     model badge, tool-call list, model picker. Best-effort: if the
  //     sidecar fails to connect the terminal pane keeps working.
  //
  // Mobile model/tools sheet is portaled to `document.body` so it stacks
  // above the app sidebar (`z-50`) and mobile chrome (`z-40`).  The main
  // dashboard column uses `relative z-2`, which traps `position:fixed`
  // descendants below those layers (see Toast.tsx).
  const mobileModelToolsPortal =
    isActive &&
    narrow &&
    portalRoot &&
    createPortal(
      <>
        {mobilePanelOpen && (
          <Button
            ghost
            aria-label={t.app.closeModelTools}
            onClick={closeMobilePanel}
            className={cn(
              "fixed inset-0 z-[55] p-0 block",
              "bg-black/60 backdrop-blur-sm",
            )}
          />
        )}

        <div
          id="chat-side-panel"
          role="complementary"
          aria-label={modelToolsLabel}
          className={cn(
            "font-mondwest fixed top-0 right-0 z-[60] flex h-dvh max-h-dvh w-64 min-w-0 flex-col antialiased",
            "border-l border-current/20 text-midground",
            "bg-background-base/95 backdrop-blur-sm",
            "transition-transform duration-200 ease-out",
            "[background:var(--component-sidebar-background)]",
            "[clip-path:var(--component-sidebar-clip-path)]",
            "[border-image:var(--component-sidebar-border-image)]",
            mobilePanelOpen
              ? "translate-x-0"
              : "pointer-events-none translate-x-full",
          )}
        >
          <div
            className={cn(
              "flex h-14 shrink-0 items-center justify-between gap-2 border-b border-current/20 px-5",
            )}
          >
            <Typography
              mondwest
              className="text-display font-bold text-[1.125rem] leading-[0.95] tracking-[0.0525rem] text-midground"
              style={{ mixBlendMode: "plus-lighter" }}
            >
              {t.app.modelToolsSheetTitle}
              <br />
              {t.app.modelToolsSheetSubtitle}
            </Typography>

            <Button
              ghost
              size="icon"
              onClick={closeMobilePanel}
              aria-label={t.app.closeModelTools}
              className="text-text-secondary hover:text-midground"
            >
              <X />
            </Button>
          </div>

          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overflow-x-hidden",
              "border-t border-current/10",
            )}
          >
            <ChatSidebar channel={channel} />
          </div>
        </div>
      </>,
      portalRoot,
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <PluginSlot name="chat:top" />
      {mobileModelToolsPortal}

      {banner && (
        <div className="border border-warning/50 bg-warning/10 text-warning px-3 py-2 text-xs tracking-wide">
          {banner}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row lg:gap-3">
        <div
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg",
            "p-2 sm:p-3",
          )}
          style={{
            backgroundColor: terminalBg,
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
          }}
        >
          {/* Drop overlay: a transparent div covering the xterm host that
              captures drag events and shows a visual hint. We do NOT
              capture clicks — those still flow into xterm for the
              terminal input to keep working. */}
          <div
            onDragEnter={onDragEnterTerminal}
            onDragOver={onDragOverTerminal}
            onDragLeave={onDragLeaveTerminal}
            onDrop={onDropTerminal}
            className={cn(
              "absolute inset-0 z-5 transition-[border,background] duration-150",
              isDragging
                ? "pointer-events-auto border-2 border-dashed border-emerald-400/80 bg-emerald-500/10"
                : "pointer-events-none border-2 border-transparent",
            )}
            aria-hidden="true"
            data-testid="chat-drop-overlay"
          >
            {isDragging && (
              <div className="pointer-events-none flex h-full w-full items-center justify-center">
                <div
                  className={cn(
                    "rounded border border-emerald-400/60 bg-black/70 px-4 py-2",
                    "font-mono text-xs uppercase tracking-widest text-emerald-300",
                  )}
                >
                  drop files to attach
                </div>
              </div>
            )}
          </div>

          <div
            ref={hostRef}
            className="hermes-chat-xterm-host min-h-0 min-w-0 flex-1"
          />

          {/* Hidden file input driven by the 📎 button. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={onFileInputChange}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            data-testid="chat-file-input"
          />

          {/* Bottom-right toolbar: 📎 + copy. */}
          <div
            className={cn(
              "absolute z-10 flex items-center gap-1.5",
              "bottom-2 right-2 sm:bottom-3 sm:right-3 lg:bottom-4 lg:right-4",
            )}
          >
            <Button
              ghost
              onClick={onPickFiles}
              title="Attach files to the next message"
              aria-label="Attach files"
              data-testid="chat-attach-button"
              className={cn(
                "normal-case tracking-normal font-normal",
                "rounded border border-current/30",
                "bg-black/20 backdrop-blur-sm",
                "opacity-70 hover:opacity-100 hover:border-current/60",
                "transition-opacity duration-150",
                "px-2 py-1 text-xs sm:px-2.5 sm:py-1.5",
              )}
              style={{ color: TERMINAL_THEME_STATIC.foreground }}
            >
              <span className="inline-flex items-center gap-1.5">
                <Paperclip className="h-3 w-3 shrink-0" />
                <span className="hidden min-[400px]:inline tracking-wide">
                  attach
                </span>
                {attachments.length > 0 && (
                  <span
                    className={cn(
                      "ml-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded",
                      "border border-current/30 px-1 font-mono text-[10px]",
                    )}
                  >
                    {attachments.length}
                  </span>
                )}
              </span>
            </Button>

            <Button
              ghost
              onClick={handleCopyLast}
              title="Copy last assistant response as raw markdown"
              aria-label="Copy last assistant response"
              className={cn(
                "normal-case tracking-normal font-normal",
                "rounded border border-current/30",
                "bg-black/20 backdrop-blur-sm",
                "opacity-70 hover:opacity-100 hover:border-current/60",
                "transition-opacity duration-150",
                "px-2 py-1 text-xs sm:px-2.5 sm:py-1.5",
              )}
              style={{ color: TERMINAL_THEME_STATIC.foreground }}
            >
              <span className="inline-flex items-center gap-1.5">
                <Copy className="h-3 w-3 shrink-0" />
                <span className="hidden min-[400px]:inline tracking-wide">
                  {copyState === "copied" ? "copied" : "copy last response"}
                </span>
              </span>
            </Button>
          </div>
        </div>

        {/* Side panel: attachments drawer (when open) + the standard
            model/tools ChatSidebar (when viewport is wide). The
            attachments drawer takes precedence on wide screens so the
            user can see model info AND attachments side-by-side; on
            narrow viewports the user toggles it via the 📎 button. */}
        {attachmentsOpen && (
          <AttachmentsDrawer
            open={attachmentsOpen}
            onClose={() => setAttachmentsOpen(false)}
            attachments={attachments}
            onRemove={removeAttachment}
            onClearAll={clearAttachments}
          />
        )}

        {!narrow && (
          <div
            id="chat-side-panel"
            role="complementary"
            aria-label={modelToolsLabel}
            className="flex min-h-0 shrink-0 flex-col overflow-hidden lg:h-full lg:w-80"
          >
            <div className="min-h-0 flex-1 overflow-hidden">
              <ChatSidebar channel={channel} />
            </div>
          </div>
        )}
      </div>
      <PluginSlot name="chat:bottom" />
    </div>
  );
}

declare global {
  interface Window {
    __HERMES_SESSION_TOKEN__?: string;
    __HERMES_AUTH_REQUIRED__?: boolean;
  }
}
