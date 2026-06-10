/**
 * useChatSession — manages a single chat session against the gateway.
 *
 * Responsibilities:
 *   - Create a new session via `session.create` on mount.
 *   - Subscribe to dispatcher events (message.start / message.delta /
 *     message.complete / status.update / tool.*) for streaming output.
 *   - Expose `submit(text)` that calls `prompt.submit` and lets the
 *     event stream do the rendering (no return value to wait for).
 *   - Expose `interrupt()` for "stop generating".
 *   - Track busy state and an in-flight assistant message.
 *
 * This is intentionally stateful and lives at the page level. If we
 * later want multiple tabs, hoist it into a context provider.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GatewayClient, GatewayEvent } from "@/lib/gatewayClient";

export type Role = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  /** Stable id for React keys. */
  id: string;
  /** Role producing the message. */
  role: Role;
  /** Text content. Streaming messages accumulate text into this. */
  text: string;
  /** True while the message is still being streamed. */
  streaming?: boolean;
  /** Tool name if this message is a tool result. */
  toolName?: string;
  /** When the message was created (ms since epoch). */
  createdAt: number;
  /** Optional error text. */
  error?: string;
}

export interface UseChatSession {
  sessionId: string | null;
  ready: boolean;
  busy: boolean;
  error: string | null;
  messages: ChatMessage[];
  submit: (text: string) => Promise<void>;
  interrupt: () => Promise<void>;
}

const EVENT_NAMES_OF_INTEREST = new Set([
  "message.start",
  "message.delta",
  "message.complete",
  "status.update",
  "tool.start",
  "tool.progress",
  "tool.complete",
  "error",
  "thinking.delta",
  "reasoning.delta",
]);

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export function useChatSession(gateway: GatewayClient): UseChatSession {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Refs to values the event handler reads — kept out of state to avoid
  // re-subscribing every time they change.
  const sessionIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);

  // Subscribe to the gateway's event stream once and route events into
  // the React state.
  useEffect(() => {
    const handlers: Array<() => void> = [];

    for (const name of EVENT_NAMES_OF_INTEREST) {
      // We bind a generic on() to every event name; the dispatcher also
      // hands us session_id on the event payload.
      handlers.push(
        gateway.on<GatewayEvent>(name, (ev) => {
          const sid = ev.session_id ?? null;
          // Only react to events for OUR session.
          if (sid !== null && sessionIdRef.current && sid !== sessionIdRef.current) {
            return;
          }
          handleEvent(name, ev);
        }),
      );
    }

    return () => {
      for (const off of handlers) off();
    };
    // We intentionally only subscribe once on mount; the handler closes
    // over the latest state via setters, so it stays correct across
    // re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway]);

  // Create a session on mount. We pass `close_on_disconnect` so the gateway
  // reaps this sidecar session when the WS drops — matches the sidebar's
  // pattern in ChatSidebar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const created = await gateway.request<{ session_id: string }>(
          "session.create",
          { close_on_disconnect: true },
        );
        if (cancelled) return;
        sessionIdRef.current = created.session_id;
        setSessionId(created.session_id);
        setReady(true);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      // Best-effort: tell the gateway to close the session.
      if (sessionIdRef.current) {
        void gateway
          .request("session.close", { session_id: sessionIdRef.current })
          .catch(() => undefined);
      }
    };
  }, [gateway]);

  const handleEvent = useCallback((name: string, ev: GatewayEvent) => {
    const payload = ev.payload as Record<string, unknown> | undefined;
    if (!payload) return;

    switch (name) {
      case "message.start": {
        const id = String(payload.id ?? payload.message_id ?? nextId("m"));
        setMessages((prev) => [
          ...prev.filter((m) => !m.streaming),
          {
            id,
            role: "assistant",
            text: "",
            streaming: true,
            createdAt: Date.now(),
          },
        ]);
        setBusy(true);
        busyRef.current = true;
        break;
      }
      case "message.delta": {
        const id = String(payload.id ?? payload.message_id ?? "");
        const text = String(payload.text ?? "");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, text: m.text + text } : m,
          ),
        );
        break;
      }
      case "message.complete": {
        const id = String(payload.id ?? payload.message_id ?? "");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  streaming: false,
                  text: String(payload.text ?? m.text),
                }
              : m,
          ),
        );
        setBusy(false);
        busyRef.current = false;
        break;
      }
      case "thinking.delta":
      case "reasoning.delta": {
        // For now we render these as part of the assistant message if it
        // exists, otherwise we drop them. We could add a separate
        // "thinking" section in the future.
        break;
      }
      case "tool.start": {
        const toolName = String(payload.name ?? "tool");
        const id = String(payload.id ?? nextId("t"));
        setMessages((prev) => [
          ...prev,
          {
            id,
            role: "tool",
            toolName,
            text: String(payload.input_summary ?? ""),
            createdAt: Date.now(),
          },
        ]);
        break;
      }
      case "tool.complete": {
        const id = String(payload.id ?? "");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  streaming: false,
                  text:
                    String(payload.output_summary ?? m.text ?? "").slice(
                      0,
                      4000,
                    ),
                }
              : m,
          ),
        );
        break;
      }
      case "status.update": {
        // We could show a status banner; for now just keep state coherent.
        break;
      }
      case "error": {
        const message = String(payload.message ?? "Unknown error");
        setError(message);
        setBusy(false);
        busyRef.current = false;
        break;
      }
    }
  }, []);

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!sessionIdRef.current) {
        setError("session not ready yet");
        return;
      }
      if (busyRef.current) {
        // Queue or reject? For now reject — the user can wait.
        setError("agent is still responding");
        return;
      }

      // Optimistically add the user message so it appears immediately.
      setMessages((prev) => [
        ...prev,
        {
          id: nextId("u"),
          role: "user",
          text: trimmed,
          createdAt: Date.now(),
        },
      ]);
      setBusy(true);
      busyRef.current = true;
      setError(null);

      try {
        await gateway.request("prompt.submit", {
          session_id: sessionIdRef.current,
          text: trimmed,
        });
        // Note: we do NOT set busy=false here. The dispatcher will emit
        // message.complete which flips it. If the prompt is rejected
        // synchronously, the error event handler will flip it.
      } catch (e) {
        setBusy(false);
        busyRef.current = false;
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [gateway],
  );

  const interrupt = useCallback(async () => {
    if (!sessionIdRef.current) return;
    try {
      await gateway.request("session.interrupt", {
        session_id: sessionIdRef.current,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [gateway]);

  return { sessionId, ready, busy, error, messages, submit, interrupt };
}
