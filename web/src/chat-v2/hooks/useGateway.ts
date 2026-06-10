/**
 * useGateway — React hook around the tui_gateway JSON-RPC client.
 *
 * Wraps the existing `GatewayClient` from `@/lib/gatewayClient` so React
 * components get a reactive view of the connection state and a stable
 * `request` function. Re-renders are minimal: the hook only re-renders
 * when the connection state transitions (idle → open → closed).
 *
 * Usage:
 *   const { gateway, state, request } = useGateway();
 *   useEffect(() => { gateway.connect(); }, [gateway]);
 */

import { useEffect, useRef, useState } from "react";
import { GatewayClient, type ConnectionState } from "@/lib/gatewayClient";

export interface UseGateway {
  /** The current GatewayClient instance (stable across renders). */
  gateway: GatewayClient;
  /** Reactive connection state — components re-render on changes only. */
  state: ConnectionState;
  /** Convenience pass-through to `gateway.request`. */
  request: GatewayClient["request"];
}

export function useGateway(): UseGateway {
  // useRef so the client survives re-renders but never causes one.
  const gatewayRef = useRef<GatewayClient | null>(null);
  if (gatewayRef.current === null) {
    gatewayRef.current = new GatewayClient();
  }
  const gateway = gatewayRef.current;

  const [state, setState] = useState<ConnectionState>(gateway.state);

  useEffect(() => {
    const off = gateway.onState(setState);
    return off;
  }, [gateway]);

  // Best-effort connect on mount; cheap if already connected.
  useEffect(() => {
    if (gateway.state === "idle") {
      void gateway.connect().catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[useGateway] connect failed:", err);
      });
    }
    // Cleanup on unmount: close the socket so we don't leak it.
    return () => {
      gateway.close();
    };
  }, [gateway]);

  return { gateway, state, request: gateway.request.bind(gateway) };
}
