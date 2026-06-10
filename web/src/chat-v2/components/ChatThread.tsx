/**
 * ChatThread — the top-level chat-v2 surface.
 *
 * Wires `useGateway` + `useChatSession` + `useAttachments` together and
 * renders the header / message list / composer. The visual style is
 * a "productivity app" (Linear / Notion / Raycast vibe) — slate dark
 * surfaces, sans-serif body, single indigo accent.
 */

import { Wrench, CheckCircle2, CircleDashed } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGateway } from "../hooks/useGateway";
import { useChatSession } from "../hooks/useChatSession";
import { useAttachments } from "../hooks/useAttachments";
import { ChatComposer } from "./ChatComposer";
import { MessageList } from "./MessageList";

export function ChatThread() {
  const { gateway, state } = useGateway();
  const session = useChatSession(gateway);
  const attachmentsApi = useAttachments({
    gateway,
    sessionId: session.sessionId,
  });

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 bg-zinc-950 p-4"
      data-testid="chat-thread"
      data-gateway-state={state}
    >
      <SessionHeader
        ready={session.ready}
        state={state}
        busy={session.busy}
        onInterrupt={() => void session.interrupt()}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-lg shadow-black/30">
        <MessageList messages={session.messages} error={session.error} />
        <div className="border-t border-zinc-800 p-3">
          <ChatComposer
            busy={session.busy}
            ready={session.ready}
            onSubmit={(text) => void session.submit(text)}
            onInterrupt={() => void session.interrupt()}
            attachmentsApi={attachmentsApi}
          />
        </div>
      </div>
    </div>
  );
}

function SessionHeader({
  ready,
  state,
  busy,
  onInterrupt,
}: {
  ready: boolean;
  state: string;
  busy: boolean;
  onInterrupt: () => void;
}) {
  const isOpen = state === "open";
  return (
    <div
      className="flex shrink-0 items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
      data-testid="chat-session-header"
    >
      {isOpen ? (
        <CheckCircle2
          className="h-4 w-4 text-emerald-400"
          aria-label="gateway connected"
        />
      ) : (
        <CircleDashed
          className="h-4 w-4 animate-spin text-amber-400"
          aria-label="connecting"
        />
      )}
      <span className="text-sm font-medium text-zinc-100">
        {isOpen ? "Gateway connected" : `Gateway ${state}`}
      </span>
      {ready && (
        <span className="text-xs text-zinc-500">
          session ready
        </span>
      )}
      {busy && (
        <button
          type="button"
          onClick={onInterrupt}
          className={cn(
            "ml-auto inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5",
            "text-xs text-amber-200 transition-colors hover:border-amber-400/60 hover:bg-amber-500/20",
          )}
        >
          <Wrench className="h-3 w-3" />
          stop
        </button>
      )}
    </div>
  );
}
