const PendingConflicts = (function () {
  let conflicts = [];

  function set(list) {
    conflicts = list || [];
  }

  function get() {
    return conflicts;
  }

  function list() {
    if (!conflicts.length) return ' No pending conflicts.';
    const lines = [' Pending conflicts:\n'];
    conflicts.forEach((c, i) => {
      const desc = c.entry ? `${c.entry.method} ${c.entry.path}` : 'unknown';
      lines.push(`  ${i + 1}. ${desc}`);
      if (c.error) lines.push(`     Error: ${c.error}`);
      if (c.serverTodo) lines.push(`     Server: "${c.serverTodo.title}" updated at ${c.serverTodo.updated_at}`);
      if (c.entry && c.entry.body && c.entry.body.title) lines.push(`     Yours:  "${c.entry.body.title}"`);
    });
    lines.push('\n  Use: <span class="yellow">resolve &lt;num&gt; mine|server</span>');
    return lines.join('\n');
  }

  async function resolve(num, choice) {
    const idx = num - 1;
    if (idx < 0 || idx >= conflicts.length) return ` Invalid conflict number. Use 1-${conflicts.length}.`;
    const c = conflicts[idx];
    if (!c.entry) return ' Cannot resolve this conflict.';

    try {
      if (choice === 'mine') {
        const opts = {
          method: c.entry.method,
          headers: { 'Content-Type': 'application/json' },
        };
        if (c.entry.body) opts.body = JSON.stringify({ ...c.entry.body, _force: true });
        const res = await fetch(`/api${c.entry.path}`, opts);
        if (!res.ok) {
          const data = await res.json();
          return ` Force apply failed: ${data.error}`;
        }
        OfflineQueue.markDone(c.entry.id);
        conflicts.splice(idx, 1);
        invalidateCache();
        return ` Conflict resolved: kept yours for ${c.entry.path}`;
      } else if (choice === 'server') {
        OfflineQueue.markDone(c.entry.id);
        conflicts.splice(idx, 1);
        invalidateCache();
        return ` Conflict resolved: kept server version for ${c.entry.path}`;
      }
      return ' Usage: resolve <num> mine|server';
    } catch (e) {
      return ` Resolve failed: ${e.message}`;
    }
  }

  return { set, get, list, resolve };
})();
