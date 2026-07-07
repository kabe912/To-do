const OfflineQueue = (function () {
  const QUEUE_KEY = 'offline_queue';
  const LAST_SYNC_KEY = 'last_sync_timestamp';

  function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function saveQueue(queue) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  function enqueue(method, path, body, lastKnownUpdated) {
    const queue = getQueue();
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      method,
      path,
      body,
      lastKnownUpdated: lastKnownUpdated || null,
      timestamp: new Date().toISOString(),
      status: 'pending'
    };
    queue.push(entry);
    saveQueue(queue);
    return entry;
  }

  function getPending() {
    return getQueue().filter(e => e.status === 'pending');
  }

  function markConflict(id) {
    const queue = getQueue();
    const entry = queue.find(e => e.id === id);
    if (entry) entry.status = 'conflict';
    saveQueue(queue);
  }

  function markDone(id) {
    const queue = getQueue().filter(e => e.id !== id);
    saveQueue(queue);
  }

  function clearQueue() {
    localStorage.removeItem(QUEUE_KEY);
  }

  function resolveConflict(id, choice) {
    const queue = getQueue();
    const entry = queue.find(e => e.id === id);
    if (entry) {
      entry.status = 'pending';
      entry._resolveChoice = choice;
    }
    saveQueue(queue);
    return entry;
  }

  function setLastSync(ts) {
    localStorage.setItem(LAST_SYNC_KEY, ts);
  }

  function getLastSync() {
    return localStorage.getItem(LAST_SYNC_KEY);
  }

  function hasPending() {
    return getPending().length > 0;
  }

  return {
    enqueue, getPending, markConflict, markDone,
    clearQueue, resolveConflict, setLastSync, getLastSync, hasPending, getQueue
  };
})();
