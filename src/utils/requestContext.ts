/**
 * Request-scoped context (AsyncLocalStorage).
 * Holds only non-sensitive correlation fields — never tokens or bodies.
 */

import { AsyncLocalStorage } from "async_hooks";

export type RequestContextStore = {
  requestId: string;
};

const als = new AsyncLocalStorage<RequestContextStore>();

export function runWithRequestContext<T>(store: RequestContextStore, fn: () => T): T {
  return als.run(store, fn);
}

export function getRequestContext(): RequestContextStore | undefined {
  return als.getStore();
}

export function getCurrentRequestId(): string | undefined {
  return als.getStore()?.requestId;
}
