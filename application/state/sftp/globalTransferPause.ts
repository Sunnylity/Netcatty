import { sftpTransferCenterStore } from "../sftpTransferCenterStore";
import type { TransferTask } from "../../../domain/models";

/**
 * Global pause for transfer tasks: one switch pauses every queued/transferring
 * task (they latch inside the main-process admission queue, so nothing new
 * runs either), and resume restarts exactly the tasks this switch paused —
 * individually paused tasks stay untouched. Folder-scan copies bypass the
 * admission queue; stop the rule itself to pause those.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
const pausedByGlobal = new Set<string>();
const ACTIVE_STATUSES = new Set<TransferTask["status"]>(["pending", "queued", "transferring"]);

let globallyPaused = false;
let snapshot = { paused: false };

function emit(): void {
  snapshot = { paused: globallyPaused };
  for (const listener of listeners) listener();
}

export function subscribeGlobalTransferPause(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getGlobalTransferPauseSnapshot(): { paused: boolean } {
  return snapshot;
}

export async function pauseAllTransfers(): Promise<void> {
  if (globallyPaused) return;
  globallyPaused = true;
  try {
    const tasks = sftpTransferCenterStore.getSnapshot().tasks;
    for (const task of tasks) {
      if (!ACTIVE_STATUSES.has(task.status)) continue;
      pausedByGlobal.add(task.id);
      try {
        await sftpTransferCenterStore.pause(task.id);
      } catch {
        // One stubborn task must not block pausing the rest.
      }
    }
  } finally {
    emit();
  }
}

export async function resumeAllTransfers(): Promise<void> {
  if (!globallyPaused) return;
  globallyPaused = false;
  const ids = [...pausedByGlobal];
  pausedByGlobal.clear();
  try {
    for (const id of ids) {
      const task = sftpTransferCenterStore.getSnapshot().tasks.find((candidate) => candidate.id === id);
      if (!task || task.status !== "paused") continue;
      try {
        await sftpTransferCenterStore.resume(id);
      } catch {
        // Best-effort per task; the user can resume stragglers individually.
      }
    }
  } finally {
    emit();
  }
}

/** Test helper — drop bookkeeping without touching live sessions. */
export function resetGlobalTransferPauseForTests(): void {
  globallyPaused = false;
  pausedByGlobal.clear();
  emit();
}
