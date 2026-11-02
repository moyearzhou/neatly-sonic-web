// Only the latest visible page is hydrated. At most one metadata request is in flight;
// a page/session change invalidates its response without replaying the request.
export function createAppMetadataLoader({ request, apply, loading }) {
  let rows = [], revision = 0, running = false, disposed = false;
  const attempted = new Set();
  async function pump() {
    if (running || disposed) return;
    running = true;
    try {
      while (!disposed) {
        const row = rows.find(item => !attempted.has(item.bundle));
        if (!row) break;
        const current = revision;
        loading(true);
        try {
          const info = await request('appInfo', { bundle: row.bundle });
          if (current === revision && !disposed) {
            attempted.add(row.bundle); apply(row.bundle, info);
          }
        } catch {
          if (current === revision && !disposed) {
            attempted.add(row.bundle); apply(row.bundle, { unavailable: true });
          }
        }
      }
    } finally { running = false; loading(false); }
  }
  return {
    update(visibleRows, enabled = true) {
      revision++; rows = enabled ? visibleRows.slice() : [];
      if (!enabled) loading(false);
      void pump();
    },
    reset() { revision++; rows = []; attempted.clear(); loading(false); },
    dispose() { disposed = true; revision++; rows = []; attempted.clear(); loading(false); },
  };
}
