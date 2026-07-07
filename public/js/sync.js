const Sync = (function () {
  let socket = null;
  let connected = false;

  function connect() {
    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      connected = true;
      console.log('[sync] connected');
    });

    socket.on('disconnect', () => {
      connected = false;
      console.log('[sync] disconnected');
    });

    socket.on('todo:created', (todo) => {
      if (typeof _todoCache !== 'undefined' && _todoCache) {
        _todoCache.push(todo);
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

  function notify(msg) {
    if (typeof Terminal !== 'undefined' && Terminal.addLine) {
      Terminal.addLine(`<span class="dim">[sync] ${msg}</span>`);
    }
  }

  function isConnected() { return connected; }

  return { connect, isConnected };
})();
