const API = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    else if (method === 'GET' || method === 'DELETE') {
      const sid = typeof _sessionId !== 'undefined' ? _sessionId : '';
      if (sid) {
        const sep = path.includes('?') ? '&' : '?';
        path += `${sep}_session_id=${sid}`;
      }
    }

    const res = await fetch(`/api${path}`, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  listTodos(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    const qs = params.toString();
    return this.request('GET', `/todos${qs ? '?' + qs : ''}`);
  },

  addTodo(todo) { return this.request('POST', '/todos', { ...todo, _session_id: typeof _sessionId !== 'undefined' ? _sessionId : '' }); },
  getTodo(id) { return this.request('GET', `/todos/${id}`); },
  updateTodo(id, data) { return this.request('PUT', `/todos/${id}`, { ...data, _session_id: typeof _sessionId !== 'undefined' ? _sessionId : '' }); },
  deleteTodo(id) { return this.request('DELETE', `/todos/${id}`); },
  toggleTodo(id) { return this.request('PATCH', `/todos/${id}/toggle`); },
  completeTodo(id) { return this.request('PATCH', `/todos/${id}/complete`, { _session_id: typeof _sessionId !== 'undefined' ? _sessionId : '' }); },
  reorderTodos(ids) { return this.request('PATCH', '/todos/reorder', { ids }); },
  getStats() { return this.request('GET', '/todos/stats'); },

  searchTodos(q, limit) { const qs = `?q=${encodeURIComponent(q)}${limit ? '&limit=' + limit : ''}`; return this.request('GET', `/todos/search${qs}`); },
  autocompleteTags(q) { const qs = q ? `?q=${encodeURIComponent(q)}` : ''; return this.request('GET', `/todos/tags/autocomplete${qs}`); },
  listTags() { return this.request('GET', '/todos/tags/list'); },
  addTag(todoId, name) { return this.request('POST', `/todos/${todoId}/tags`, { name }); },
  removeTag(todoId, name) { return this.request('DELETE', `/todos/${todoId}/tags/${name}`); },

  timeStart(todoId) { return this.request('POST', `/todos/${todoId}/time/start`); },
  timeStop(todoId) { return this.request('PUT', `/todos/${todoId}/time/stop`); },
  timeLog(todoId) { return this.request('GET', `/todos/${todoId}/time`); },

  addDependency(todoId, dependsOnId) { return this.request('POST', `/todos/${todoId}/dependencies`, { depends_on_id: dependsOnId }); },
  removeDependency(todoId, depId) { return this.request('DELETE', `/todos/${todoId}/dependencies/${depId}`); },
  listDependencies(todoId) { return this.request('GET', `/todos/${todoId}/dependencies`); },
  checkBlocked(todoId) { return this.request('GET', `/todos/${todoId}/blocked-by`); },

  logAction(sessionId, type, todoId, before, after) { return this.request('POST', '/actions/log', { session_id: sessionId, action_type: type, todo_id: todoId, before_state: before, after_state: after }); },
  undoAction(sessionId) { return this.request('POST', '/actions/undo', { session_id: sessionId }); },
  redoAction(sessionId) { return this.request('POST', '/actions/redo', { session_id: sessionId }); },
  getActionHistory(sessionId, limit) { return this.request('GET', `/actions/history?session_id=${sessionId}${limit ? '&limit=' + limit : ''}`); },

  createShareLink(data) { return this.request('POST', '/share', data); },
  getShareLink(token) { return this.request('GET', `/share/${token}`); },
  verifySharePassword(token, password) { return this.request('POST', `/share/${token}/verify`, { password }); },
};
