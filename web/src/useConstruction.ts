import { useEffect, useState } from "react";
import { request } from "./model";
import type { ConstructionData } from "./model";

export function useConstruction(enabled: boolean, departure: string) {
  const [state, setState] = useState<ConstructionData | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let pending: AbortController | null = null;
    async function refresh() {
      if (document.hidden || pending) return;
      const controller = new AbortController();
      pending = controller;
      try {
        const data = await request<ConstructionData>(
          "/api/conditions" +
            (departure ? "?at=" + encodeURIComponent(departure) : ""),
          { signal: controller.signal },
        );
        if (!disposed) setState(data);
      } catch {
        if (!disposed && !controller.signal.aborted)
          setState((old) =>
            old
              ? { ...old, available: false, complete: false, stale: true }
              : old,
          );
      } finally {
        if (pending === controller) pending = null;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      pending?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled, departure]);
  return state;
}
