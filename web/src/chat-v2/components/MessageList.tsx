/**
 * MessageBubble — render a single chat message.
 *
 * Visual style: productivity app — sans-serif body, code blocks in
 * a monospaced inset card, role labels as small subtle text above
 * the bubble. Streaming messages show a blinking caret.
 *
 * Code fence splitting is done inline (no external markdown lib yet);
 * we defer the full markdown renderer to a later iteration.
 */

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "../hooks/useChatSession";
import { fontStack } from "../theme";

interface MessageBubbleProps {
  message: ChatMessage;
}

function renderSegments(text: string) {
  // Split into alternating (plain | code) segments by ``` fences.
  const parts = text.split(/```/);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return (
        <pre
          key={`c-${i}`}
          className="my-2 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs leading-relaxed text-zinc-100"
          style={{ fontFamily: fontStack.mono }}
        >
          {part}
        </pre>
      );
    }
    return (
      <span key={`t-${i}`} className="whitespace-pre-wrap break-words">
        {part}
      </span>
    );
  });
}

const ROLE_LABEL: Record<ChatMessage["role"], string> = {
  user: "You",
  assistant: "Assistant",
  tool: "Tool",
  system: "System",
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const isSystem = message.role === "system";
  const isAssistant = message.role === "assistant";

  if (isSystem) {
    return (
      <div
        className="my-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200"
        data-role="system"
      >
        {message.text}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "my-3 flex flex-col gap-1.5",
        isUser ? "items-end" : "items-start",
      )}
      data-role={message.role}
      data-message-id={message.id}
    >
      <div
        className={cn(
          "px-1 text-[11px] font-medium uppercase tracking-wide",
          isUser && "text-zinc-400",
          isAssistant && "text-zinc-300",
          isTool && "text-amber-300/90",
        )}
      >
        {ROLE_LABEL[message.role]}
        {isTool && message.toolName && (
          <span className="ml-1.5 rounded border border-amber-500/30 px-1 font-mono text-[10px] normal-case tracking-normal text-amber-200">
            {message.toolName}
          </span>
        )}
      </div>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
          isUser &&
            "rounded-br-sm bg-indigo-600 text-white shadow-indigo-900/30",
          isAssistant && "rounded-bl-sm border border-zinc-800 bg-zinc-800 text-zinc-100",
          isTool && "rounded-bl-sm border border-amber-500/30 bg-amber-500/5 text-amber-100",
        )}
      >
        {renderSegments(message.text)}
        {message.streaming && <StreamingCaret />}
        {message.error && (
          <div className="mt-2 border-t border-rose-500/30 pt-1.5 text-xs text-rose-300">
            {message.error}
          </div>
        )}
      </div>
    </div>
  );
}

function StreamingCaret() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-current opacity-80"
      style={{
        animation: "hermes-caret 1s steps(2) infinite",
      }}
    />
  );
}

if (
  typeof document !== "undefined" &&
  !document.getElementById("hermes-caret-style")
) {
  const style = document.createElement("style");
  style.id = "hermes-caret-style";
  style.textContent = `@keyframes hermes-caret { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }`;
  document.head.appendChild(style);
}

export function MessageList({
  messages,
  error,
}: {
  messages: ChatMessage[];
  error: string | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={ref}
      className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto bg-zinc-950 px-4 py-6"
      data-testid="chat-message-list"
    >
      {messages.length === 0 && (
        <div className="m-auto text-center text-sm text-zinc-500">
          Start a conversation
        </div>
      )}
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      {error && (
        <div
          className="my-3 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300"
          data-testid="chat-error"
        >
          {error}
        </div>
      )}
    </div>
  );
}
