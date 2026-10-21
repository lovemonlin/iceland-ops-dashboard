"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SNAPSHOT_RELOAD_MS } from "@/config/snapshot";
import { getSnapshotUrl } from "@/lib/publicPath";
import type { DashboardSnapshot } from "@/snapshot/types";

/** Re-read only the published snapshot; keep the last good copy on a failed read. */
export function usePublishedSnapshot(
  initialSnapshot: DashboardSnapshot,
  onChange?: (next: DashboardSnapshot) => void,
) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [now, setNow] = useState(() => new Date(initialSnapshot.generatedAt));
  const [autoReload, setAutoReload] = useState(true);
  const [loading, setLoading] = useState(false);
  const [reloadError, setReloadError] = useState<string | undefined>();
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reloadSnapshot = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const response = await fetch(getSnapshotUrl({ cacheBust: true }), { cache: "no-store" });
      if (!response.ok) throw new Error(`snapshot file returned HTTP ${response.status}`);
      const next = (await response.json()) as DashboardSnapshot;
      if (!mounted.current) return;
      if (next.generatedAt !== snapshot.generatedAt) {
        onChange?.(next);
        setSnapshot(next);
      }
      setNow(new Date());
      setReloadError(undefined);
    } catch (error) {
      if (mounted.current) setReloadError(error instanceof Error ? error.message : "unknown error");
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [snapshot.generatedAt, onChange]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setNow(new Date());
      void reloadSnapshot();
    }, 0);
    return () => clearTimeout(timer);
    // Only on mount; the interval and manual button handle subsequent reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoReload) return;
    const timer = setInterval(reloadSnapshot, SNAPSHOT_RELOAD_MS);
    return () => clearInterval(timer);
  }, [autoReload, reloadSnapshot]);

  return { snapshot, now, autoReload, setAutoReload, loading, reloadError, reloadSnapshot };
}
