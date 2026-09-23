/**
 * P4G — request-scoped memo for shared Home bootstrap lookups.
 *
 * Under Stage B feed ∥ stories, both arms previously re-queried
 * accepted connections and blocked ids. Memoizing within AsyncLocalStorage
 * keeps semantics (same user, same request) while dropping duplicate RTTs.
 *
 * Outside a request context the helpers are no-ops (direct loader call).
 */

import { getRequestContext } from "./requestContext";

type MemoBucket = {
  connectionIdsByUser: Map<number, Promise<number[]>>;
  blockedIdsByUser: Map<number, Promise<number[]>>;
};

type StoreWithMemo = {
  requestId: string;
  p4gMemo?: MemoBucket;
};

function bucket(): MemoBucket | null {
  const store = getRequestContext() as StoreWithMemo | undefined;
  if (!store) return null;
  if (!store.p4gMemo) {
    store.p4gMemo = {
      connectionIdsByUser: new Map(),
      blockedIdsByUser: new Map()
    };
  }
  return store.p4gMemo;
}

/** Memoize accepted connection peer ids for the current HTTP request. */
export async function memoAcceptedConnectionUserIds(
  userId: number,
  loader: () => Promise<number[]>
): Promise<number[]> {
  if (!userId) return [];
  const memo = bucket();
  if (!memo) return loader();
  let pending = memo.connectionIdsByUser.get(userId);
  if (!pending) {
    pending = loader().then((ids) => ids.slice());
    memo.connectionIdsByUser.set(userId, pending);
  }
  const ids = await pending;
  return ids.slice();
}

/** Memoize blocked user ids (returned as a fresh Set each call). */
export async function memoBlockedUserIds(
  userId: number,
  loader: () => Promise<Set<number>>
): Promise<Set<number>> {
  if (!userId) return new Set();
  const memo = bucket();
  if (!memo) {
    return loader();
  }
  let pending = memo.blockedIdsByUser.get(userId);
  if (!pending) {
    pending = loader().then((set) => [...set]);
    memo.blockedIdsByUser.set(userId, pending);
  }
  const ids = await pending;
  return new Set(ids);
}
