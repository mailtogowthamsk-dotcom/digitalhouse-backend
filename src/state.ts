/**
 * Runtime state for cold start: server listens immediately, DB init runs in background.
 * API routes return 503 until dbReady is true (so Railway gets a fast response).
 */
export let dbReady = false;
export let dbFailed = false;

export function setDbReady(value: boolean): void {
  dbReady = value;
}

export function setDbFailed(value: boolean): void {
  dbFailed = value;
}
