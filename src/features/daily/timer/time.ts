export function createTimerStartSnapshot(baseMs: number, startedAtMs = Date.now()) {
  return {
    nowMs: startedAtMs,
    startedAtMs,
    endsAtMs: startedAtMs + baseMs,
    remainingMs: baseMs,
  };
}
