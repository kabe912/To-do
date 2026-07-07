const Sync = (function () {
  let socket = null;
  let connected = false;
  let replaying = false;

  function connect() {
    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      connected = true;
      console.log('[sync] connected');
      if (!replaying) replayQueue();
    });

    socket.on('disconnect', () => {
      connected = false;
      console.log('[sync] disconnected — mutations will be queued offline');
    });

    socket.on('todo:created', (todo) => {
      if (typeof _todoCache !== 'undefined' && _todoCache) {
        const idx = _todoCache.findIndex(t => t.id === todo.id);
        if (idx >= 0) _todoCache[idx] = todo;
        else _todoCache.push(todo);
      }
      notify(`+ new: "${todo.title}"`);
    });

    socket.on('todo:updated', (todo) => {
      if (typeof _todoCache !== 'undefined' && _todoCache) {
        const idx = _todoCache.findIndex(t => t.id === todo.id);
        if (idx >= 0) _todoCache[idx] = todo;
        else _todoCache.push(todo);
      }
      notify(`~ updated: "${todo.title}"`);
    });

    socket.on('todo:deleted', ({ id }) => {
      if (typeof _todoCache !== 'undefined' && _todoCache) {
        const idx = _todoCache.findIndex(t => t.id === id);
        if (idx >= 0) _todoCache.splice(idx, 1);
      }
      notify(`- deleted: #${id}`);
    });

    socket.on('todo:statusChanged', (todo) => {
      if (typeof _todoCache !== 'undefined' && _todoCache) {
        const idx = _todoCache.findIndex(t => t.id === todo.id);
        if (idx >= 0) _todoCache[idx] = todo;
        else _todoCache.push(todo);
      }
      const label = STATUS_LABELS[todo.status] || todo.status;
      notify(`→ #${todo.id} "${todo.title}" → ${label}`);
    });
  }

  async function replayQueue() {
    if (!connected || replaying) return;
    const pending = OfflineQueue.getPending();
    if (!pending.length) return;

    replaying = true;
    notify(`[offline] replaying ${pending.length} queued mutation(s)...`);
    const conflicts = [];

    for (const entry of pending) {
      try {
        const opts = {
          method: entry.method,
          headers: { 'Content-Type': 'application/json' },
        };
        if (entry.body) opts.body = JSON.stringify(entry.body);

        const res = await fetch(`/api${entry.path}`, opts);
        const data = await res.json();

        if (res.status === 409 && data.error && data.error.includes('conflict')) {
          OfflineQueue.markConflict(entry.id);
          conflicts.push({ entry, serverTodo: data.server, error: data.error });
        } else if (!res.ok) {
          OfflineQueue.markConflict(entry.id);
          conflicts.push({ entry, error: data.error || 'Replay failed' });
        } else {
          OfflineQueue.markDone(entry.id);
        }
      } catch (e) {
        OfflineQueue.markConflict(entry.id);
        conflicts.push({ entry, error: e.message });
      }
    }

    replaying = false;

    if (conflicts.length) {
      notify(`[offline] ${conflicts.length} conflict(s) detected — use <span class="yellow">conflicts</span> to resolve`);
      if (typeof PendingConflicts !== 'undefined') PendingConflicts.set(conflicts);
    } else {
      invalidateCache();
      notify(`[offline] all queued mutations replayed successfully`);
    }
  }

  function notify(msg) {
    if (typeof Terminal !== 'undefined' && Terminal.addLine) {
      Terminal.addLine(`<span class="dim">[sync] ${msg}</span>`);
    }
  }

  function isConnected() { return connected; }

  return { connect, isConnected, replayQueue };
})();
