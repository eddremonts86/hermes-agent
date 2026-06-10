/**
 * ChatV2Page — the React-only chat surface.
 *
 * Lives at /chat-v2 next to the legacy ChatPage (/chat) which still
 * embeds the TUI via xterm. Once v2 is stable we'll swap them; until
 * then both are reachable so we can A/B test.
 */

import { Sparkles } from "lucide-react";
import { usePageHeader } from "@/contexts/usePageHeader";
import { useEffect } from "react";
import { ChatThread } from "./components/ChatThread";

export default function ChatV2Page() {
  const { setEnd } = usePageHeader();

  useEffect(() => {
    setEnd(null);
  }, [setEnd]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 px-4 pt-3">
        <Sparkles className="h-5 w-5 text-indigo-400" />
        <h1 className="text-lg font-semibold text-zinc-50">Chat</h1>
        <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-300">
          v2
        </span>
        <span className="ml-auto text-xs text-zinc-500">
          Drop files anywhere · paste images · Enter to send
        </span>
      </header>
      <div className="min-h-0 flex-1">
        <ChatThread />
      </div>
    </div>
  );
}
