import { useCallback, useEffect, useMemo, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type UpdateState = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function useAutoUpdate() {
  const [state, setState] = useState<UpdateState>("idle");
  const [open, setOpen] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string>("");
  const [releaseNotes, setReleaseNotes] = useState<string>("");
  const [downloaded, setDownloaded] = useState(0);
  const [contentLength, setContentLength] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const progressPercent = useMemo(() => {
    if (!contentLength || contentLength <= 0) return 0;
    return Math.min(100, Math.round((downloaded / contentLength) * 100));
  }, [contentLength, downloaded]);

  useEffect(() => {
    if (!isTauri) return;
    const timer = window.setTimeout(async () => {
      try {
        setState("checking");
        const update = await check();
        if (!update?.available) {
          setState("idle");
          return;
        }
        setLatestVersion(update.version ?? "");
        setReleaseNotes(update.body ?? "");
        setState("available");
        setOpen(true);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setState("error");
      }
    }, 4000);
    return () => window.clearTimeout(timer);
  }, []);

  const startUpdate = useCallback(async () => {
    if (!isTauri) return;
    try {
      setState("downloading");
      setDownloaded(0);
      setContentLength(null);
      const update = await check();
      if (!update?.available) {
        setOpen(false);
        setState("idle");
        return;
      }
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            setContentLength(event.data.contentLength ?? null);
            setDownloaded(0);
            break;
          case "Progress":
            setDownloaded((prev) => prev + event.data.chunkLength);
            break;
          case "Finished":
            setDownloaded((prev) =>
              contentLength && contentLength > 0 ? contentLength : prev,
            );
            break;
        }
      });
      setState("ready");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setState("error");
    }
  }, [contentLength]);

  const restartNow = useCallback(async () => {
    await relaunch();
  }, []);

  const closeDialog = useCallback(() => {
    setOpen(false);
  }, []);

  return {
    isSupported: isTauri,
    open,
    state,
    latestVersion,
    releaseNotes,
    progressPercent,
    errorMessage,
    closeDialog,
    startUpdate,
    restartNow,
  };
}
