const API = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);

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

  addTodo(todo) { return this.request('POST', '/todos', todo); },
  getTodo(id) { return this.request('GET', `/todos/${id}`); },
  updateTodo(id, data) { return this.request('PUT', `/todos/${id}`, data); },
  deleteTodo(id) { return this.request('DELETE', `/todos/${id}`); },
  toggleTodo(id) { return this.request('PATCH', `/todos/${id}/toggle`); },
  completeTodo(id) { return this.request('PATCH', `/todos/${id}/complete`); },
  reorderTodos(ids) { return this.request('PATCH', '/todos/reorder', { ids }); },
  getStats() { return this.request('GET', '/todos/stats'); },

  listTags() { return this.request('GET', '/todos/tags/list'); },
  addTag(todoId, name) { return this.request('POST', `/todos/${todoId}/tags`, { name }); },
  removeTag(todoId, name) { return this.request('DELETE', `/todos/${todoId}/tags/${name}`); },

  timeStart(todoId) { return this.request('POST', `/todos/${todoId}/time/start`); },
  timeStop(todoId) { return this.request('PUT', `/todos/${todoId}/time/stop`); },
  timeLog(todoId) { return this.request('GET', `/todos/${todoId}/time`); },

  createShareLink(data) { return this.request('POST', '/share', data); },
  getShareLink(token) { return this.request('GET', `/share/${token}`); },
  verifySharePassword(token, password) { return this.request('POST', `/share/${token}/verify`, { password }); },
};
