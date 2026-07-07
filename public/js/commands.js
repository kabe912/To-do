const STATUS_LABELS = {
  pending: 'pending', in_progress: 'learn', completed: 'done', learned: 'known',
};
const STATUS_VALUES = ['pending', 'in_progress', 'completed', 'learned'];
const ARCHIVE_STATUSES = ['completed', 'learned'];
const ACTIVE_STATUSES = ['pending', 'in_progress'];
const PRIORITIES = ['low', 'medium', 'high'];
const RECURRING_TYPES = ['daily', 'weekly', 'monthly', 'yearly'];

let _todoCache = null;
let _cacheTime = 0;
const CACHE_TTL = 1500;
let _undoStack = [];
const UNDO_MAX = 20;

function invalidateCache() { _todoCache = null; }

function pushUndo(action) {
  _undoStack.push(action);
  if (_undoStack.length > UNDO_MAX) _undoStack.shift();
}

function formatDate(d) {
  if (!d) return '';
  if (d.includes('T')) d = d.split('T')[0];
  return d;
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function formatDuration(secs) {
  if (!secs) return '0s';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  let r = '';
  if (h) r += h + 'h ';
  if (m) r += m + 'm ';
  if (s) r += s + 's';
  return r.trim();
}

async function getTodos() {
  if (_todoCache && Date.now() - _cacheTime < CACHE_TTL) return _todoCache;
  _todoCache = await API.listTodos();
  _cacheTime = Date.now();
  return _todoCache;
}

async function resolveTodos(selectors, opts = {}) {
  const listAll = opts.all || false;
  let todos = await getTodos();
  if (!listAll) {
    const activeIds = todos.filter(t => ACTIVE_STATUSES.includes(t.status)).map(t => t.id);
    todos.forEach(t => { t._row = activeIds.indexOf(t.id) >= 0 ? activeIds.indexOf(t.id) + 1 : null; });
  } else {
    todos.forEach((t, i) => { t._row = i + 1; });
  }
  const results = [];
  for (const sel of selectors) {
    const cleaned = sel.replace(/^#+/, '').trim();
    const num = parseInt(cleaned);
    if (!isNaN(num) && String(num) === cleaned) {
      const byRow = todos.find(t => t._row === num);
      if (byRow) { results.push({ todo: byRow }); continue; }
      const byId = todos.find(t => t.id === num);
      if (byId) { results.push({ todo: byId }); continue; }
      results.push({ error: `Todo #${num} not found` });
    } else {
      const q = cleaned;
      const exact = todos.filter(t => t.title === q);
      if (exact.length === 1) { results.push({ todo: exact[0] }); continue; }
      const matches = todos.filter(t => t.title.includes(q));
      if (matches.length === 0) results.push({ error: `No todo matching "${q}"` });
      else if (matches.length === 1) results.push({ todo: matches[0] });
      else results.push({ error: `Multiple matches for "${q}": ${matches.map(m => '#' + (m._row || m.id)).join(', ')}` });
    }
  }
  return results;
}

async function resolveSingleTodo(sel, opts) {
  const res = await resolveTodos([sel], opts);
  return res[0];
}

function addRowNumbers(todos) {
  return todos.map((t, i) => { t._row = i + 1; return t; });
}

async function execOnIds(args, updates, formatter) {
  const resolved = await resolveTodos(args);
  const results = [];
  for (const r of resolved) {
    if (r.error) { results.push(` ${r.error}`); continue; }
    try {
      await API.updateTodo(r.todo.id, updates);
      invalidateCache();
      results.push(formatter(r.todo));
      pushUndo({ type: 'update', todo: r.todo, updates });
    } catch (err) { results.push(` #${r.todo.id}: ${err.message}`); }
  }
  return results.join('\n');
}

/* ── Parse --search/--all arguments for batch commands ── */
async function resolveBatchTodos(args, baseStatus) {
  if (!args.length) return { error: 'No args' };
  const selectors = [];
  let getFromStatus = baseStatus || 'all';
  let searchTerm = null;
  for (const a of args) {
    if (a === '--all') { getFromStatus = 'all'; }
    else if (a === '--archived') { getFromStatus = 'archived'; }
    else if (a === '--search' || a === '-s') { /* handled next */ }
    else if (a.startsWith('--search=')) { searchTerm = a.slice(9); }
    else if (a.startsWith('-s=')) { searchTerm = a.slice(3); }
    else { selectors.push(a); }
  }
  // find --search value
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--search' || args[i] === '-s') && i + 1 < args.length && !args[i+1].startsWith('-')) {
      searchTerm = args[i + 1];
    }
  }
  let todos = await getTodos();
  if (getFromStatus === 'archived') todos = todos.filter(t => ARCHIVE_STATUSES.includes(t.status));
  else if (getFromStatus !== 'all') todos = todos.filter(t => t.status === getFromStatus);
  else todos = todos.filter(t => ACTIVE_STATUSES.includes(t.status));
  if (searchTerm) todos = todos.filter(t => t.title.toLowerCase().includes(searchTerm.toLowerCase()));

  if (selectors.length) {
    todos.forEach((t, i) => { t._row = i + 1; });
    const resolved = [];
    for (const sel of selectors) {
      const cleaned = sel.replace(/^#+/, '').trim();
      const num = parseInt(cleaned);
      if (!isNaN(num) && String(num) === cleaned) {
        const byRow = todos.find(t => t._row === num);
        if (byRow) { resolved.push(byRow); continue; }
        const byId = todos.find(t => t.id === num);
        if (byId) { resolved.push(byId); continue; }
      } else {
        const exact = todos.filter(t => t.title === cleaned);
        if (exact.length === 1) { resolved.push(exact[0]); continue; }
        const matches = todos.filter(t => t.title.includes(cleaned));
        if (matches.length === 1) { resolved.push(matches[0]); continue; }
      }
    }
    return { todos: resolved };
  }

  return { todos };
}

const COMMANDS = {
  help: {
    desc: 'Show available commands',
    usage: 'help [command]',
    execute(args) {
      if (args.length) {
        const cmd = args[0];
        if (COMMANDS[cmd]) return ` ${cmd} — ${COMMANDS[cmd].desc}\n Usage: ${COMMANDS[cmd].usage}`;
        return ` Unknown command: ${cmd}`;
      }
      const lines = [' Available commands:\n'];
      for (const [name, cmd] of Object.entries(COMMANDS)) {
        lines.push(`  ${name.padEnd(14)} ${cmd.desc}`);
      }
      return lines.join('\n');
    }
  },

  ls: {
    desc: 'List todos',
    usage: 'ls [--all] [--archived] [--status STATUS] [--priority PRI] [--category CAT] [--search TEXT] [--sort due|priority|created] [--due-soon N]',
    async execute(args) {
      const filters = {};
      let showAll = false, showArchived = false, sortBy = null, dueSoon = null;
      for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
          case '--all': showAll = true; break;
          case '--archived': showArchived = true; break;
          case '--done': filters.status = 'completed'; break;
          case '--status': filters.status = args[++i]; break;
          case '--priority': filters.priority = args[++i]; break;
          case '--category': filters.category = args[++i]; break;
          case '--search': filters.search = args[++i]; break;
          case '--sort': sortBy = args[++i]; break;
          case '--due-soon': dueSoon = parseInt(args[++i]) || 3; break;
        }
      }
      try {
        if (sortBy) filters.sort = sortBy;
        if (dueSoon) filters.due_soon = dueSoon;
        let todos = await (dueSoon ? API.listTodos(filters) : getTodos());
        if (!dueSoon) {
          if (filters.search) todos = todos.filter(t => t.title.toLowerCase().includes(filters.search.toLowerCase()));
          if (filters.status) todos = todos.filter(t => t.status === filters.status);
          if (filters.priority) todos = todos.filter(t => t.priority === filters.priority);
          if (filters.category) todos = todos.filter(t => t.category === filters.category);
          if (!showAll && !showArchived && !filters.status) todos = todos.filter(t => ACTIVE_STATUSES.includes(t.status));
          if (showArchived) todos = todos.filter(t => ARCHIVE_STATUSES.includes(t.status));
        }
        if (sortBy === 'due') todos.sort((a, b) => (a.due_date || 'Z').localeCompare(b.due_date || 'Z'));
        else if (sortBy === 'priority') todos.sort((a, b) => PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority));
        else if (sortBy === 'created') todos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        todos = addRowNumbers(todos);
        if (!todos.length) return dueSoon ? ' No todos due soon.' : showArchived ? ' No archived todos.' : ' No active todos.';
        return { todos, showRow: true };
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  add: {
    desc: 'Add a new todo',
    usage: 'add "Title" [tmrw|today|nw] [high|med|low] [-c CAT] [--every daily|weekly]',
    async execute(args) {
      if (!args.length) return ' Usage: add "Title" [tmrw|today|nw] [high|med|low] [-c CAT] [--every daily|weekly|monthly|yearly]';
      let title = '';
      const todo = { status: 'pending', due_date: null };
      let i = 0, parentRow = null;
      if (args[i] && !args[i].startsWith('-')) { title = args[i++]; }
      while (i < args.length) {
        switch (args[i]) {
          case '-s': case '--status': todo.status = args[++i]; break;
          case '-p': case '--priority': todo.priority = args[++i]; break;
          case '-d': case '--due': case '--due-date': todo.due_date = args[++i]; break;
          case '-c': case '--category': todo.category = args[++i]; break;
          case '--desc': case '--description': todo.description = args[++i]; break;
          case '--every': todo.recurring = args[++i]; if (!RECURRING_TYPES.includes(todo.recurring)) return ' Recurring must be: daily, weekly, monthly, yearly'; break;
          case '--parent': parentRow = args[++i]; break;
          default:
            const a = args[i];
            if (!todo.due_date && (a === 'today')) { todo.due_date = todayStr(); }
            else if (!todo.due_date && (a === 'tmrw' || a === 'tomorrow')) { todo.due_date = daysFromNow(1); }
            else if (!todo.due_date && (a === 'nw' || a === 'nextweek')) { todo.due_date = daysFromNow(7); }
            else if (!todo.priority && (a === 'high' || a === 'med' || a === 'medium' || a === 'low')) { todo.priority = a === 'med' ? 'medium' : a; }
            else { title = (title ? title + ' ' : '') + a; }
            i++; continue;
        }
        i++;
      }
      if (!title) return ' Error: Title is required';
      todo.title = title;
      if (parentRow) {
        const r = await resolveSingleTodo(parentRow);
        if (r.error) return ` ${r.error}`;
        todo.parent_id = r.todo.id;
      }
      try {
        const created = await API.addTodo(todo);
        invalidateCache();
        const tag = todo.recurring ? ` (recurring ${todo.recurring})` : '';
        return ` Created #${created.id}: "${created.title}" [${formatDate(created.due_date)}]${tag}`;
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  done: {
    desc: 'Mark todos as completed (handles recurring)',
    usage: 'done <row|id|"title"> [more...] [--search TERM] [--all] [--dry-run]',
    async execute(args) {
      const dryRun = args.includes('--dry-run');
      if (dryRun) args = args.filter(a => a !== '--dry-run');
      if (!args.length) return ' Usage: done <row | id | "title"> [--search TERM] [--all] [--dry-run]';
      const resolved = await resolveBatchTodos(args);
      if (resolved.error) return COMMANDS.execOnIds(args, { status: 'completed', completed: true }, t => ` ✓ #${t.id} "${t.title}" → done`);
      const todos = resolved.todos;
      if (!todos.length) return ' No matching todos.';
      if (dryRun) {
        return ` Would complete ${todos.length} todo(s):\n` + todos.map(t => `  #${t._row || t.id} "${t.title}" [${t.status}]`).join('\n');
      }
      const results = [];
      for (const t of todos) {
        try {
          const res = await API.completeTodo(t.id);
          invalidateCache();
          let msg = ` ✓ #${t.id} "${t.title}" → done`;
          if (res.recurring) msg += ` (recurring: next #${res.recurring.id})`;
          results.push(msg);
          pushUndo({ type: 'done', todo: t });
        } catch (err) { results.push(` #${t.id}: ${err.message}`); }
      }
      return results.join('\n');
    }
  },

  start: {
    desc: 'Mark todos as in progress',
    usage: 'start <row|id|"title"> [more...]',
    async execute(args) {
      if (!args.length) return ' Usage: start <row | id | "title">';
      return COMMANDS.execOnIds(args, { status: 'in_progress' }, t => ` → #${t.id} "${t.title}" learning`);
    }
  },

  learned: {
    desc: 'Mark todos as learned (archived)',
    usage: 'learned <row|id|"title"> [more...]',
    async execute(args) {
      if (!args.length) return ' Usage: learned <row | id | "title">';
      return COMMANDS.execOnIds(args, { status: 'learned' }, t => ` ✓ #${t.id} "${t.title}" → learned (archived)`);
    }
  },

  pending: {
    desc: 'Reset todos to pending',
    usage: 'pending <row|id|"title"> [more...]',
    async execute(args) {
      if (!args.length) return ' Usage: pending <row | id | "title">';
      return COMMANDS.execOnIds(args, { status: 'pending', completed: false }, t => ` → #${t.id} "${t.title}" pending`);
    }
  },

  status: {
    desc: 'Change status of a todo',
    usage: 'status <row|id|"title"> <pending|in_progress|completed|learned>',
    async execute(args) {
      if (args.length < 2) return ' Usage: status <row | id | "title"> <status>';
      const s = args[1].toLowerCase().replace(/-/g, '_');
      if (!STATUS_VALUES.includes(s)) return ' Status must be: pending, in_progress, completed, or learned';
      const r = await resolveSingleTodo(args[0]);
      if (r.error) return ` ${r.error}`;
      const cv = (s === 'completed' || s === 'learned') ? true : (s === 'pending' ? false : undefined);
      try {
        const todo = await API.updateTodo(r.todo.id, { status: s, ...(cv !== undefined ? { completed: cv } : {}) });
        invalidateCache();
        return ` #${todo.id} "${todo.title}" → ${STATUS_LABELS[s]}`;
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  archive: {
    desc: 'List archived todos',
    usage: 'archive', execute() { return COMMANDS.ls.execute(['--archived']); }
  },

  purge: {
    desc: 'Delete all archived todos',
    usage: 'purge',
    async execute() {
      try {
        const todos = await API.listTodos();
        const archived = todos.filter(t => ARCHIVE_STATUSES.includes(t.status));
        if (!archived.length) return ' No archived todos to purge.';
        for (const t of archived) await API.deleteTodo(t.id);
        invalidateCache();
        pushUndo({ type: 'purge', todos: archived });
        return ` Purged ${archived.length} archived todo(s).`;
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  rm: {
    desc: 'Delete todos',
    usage: 'rm <row|id|"title"> [more...] [--search TERM]',
    async execute(args) {
      if (!args.length) return ' Usage: rm <row | id | "title">';
      const resolved = await resolveBatchTodos(args);
      if (resolved.error) {
        const res = await resolveTodos(args);
        const results = [];
        for (const r of res) {
          if (r.error) { results.push(` ${r.error}`); continue; }
          try { await API.deleteTodo(r.todo.id); invalidateCache(); pushUndo({ type: 'delete', todo: r.todo }); results.push(` Deleted #${r.todo.id} "${r.todo.title}"`); }
          catch (err) { results.push(` #${r.todo.id}: ${err.message}`); }
        }
        return results.join('\n');
      }
      const results = [];
      for (const t of resolved.todos) {
        try { await API.deleteTodo(t.id); invalidateCache(); pushUndo({ type: 'delete', todo: t }); results.push(` Deleted #${t.id} "${t.title}"`); }
        catch (err) { results.push(` #${t.id}: ${err.message}`); }
      }
      return results.join('\n');
    }
  },

  edit: {
    desc: 'Edit a todo',
    usage: 'edit <row|id|"title"> "new title" [-s STATUS] [-p PRIORITY] [-d DATE] [-c CATEGORY] [--desc "text"]',
    async execute(args) {
      if (args.length < 2) return ' Usage: edit <row | id | "title"> ...';
      const r = await resolveSingleTodo(args[0]);
      if (r.error) return ` ${r.error}`;
      const todoId = r.todo.id;
      const prev = r.todo;
      const updates = {};
      let title = '';
      let i = 1;
      if (!args[i].startsWith('-')) { title = args[i++]; }
      while (i < args.length) {
        switch (args[i]) {
          case '-s': case '--status': updates.status = args[++i]; break;
          case '-p': case '--priority': updates.priority = args[++i]; break;
          case '-d': case '--due': case '--due-date': updates.due_date = args[++i]; break;
          case '-c': case '--category': updates.category = args[++i]; break;
          case '--desc': case '--description': updates.description = args[++i]; break;
          default: title = (title ? title + ' ' : '') + args[i]; i++; continue;
        }
        i++;
      }
      if (title) updates.title = title;
      try {
        const updated = await API.updateTodo(todoId, updates);
        invalidateCache();
        pushUndo({ type: 'edit', id: todoId, prev });
        return ` Updated #${updated.id}: "${updated.title}"`;
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  priority: {
    desc: 'Change priority of a todo',
    usage: 'priority <row|id|"title"> <high|medium|low>',
    async execute(args) {
      if (args.length < 2) return ' Usage: priority <row | id | "title"> <high|medium|low>';
      const pri = args[1].toLowerCase();
      if (!PRIORITIES.includes(pri)) return ' Priority must be: high, medium, or low';
      const r = await resolveSingleTodo(args[0]);
      if (r.error) return ` ${r.error}`;
      try {
        const updated = await API.updateTodo(r.todo.id, { priority: pri });
        invalidateCache(); return ` #${updated.id} "${updated.title}" priority → ${pri}`;
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  search: {
    desc: 'Search todos by keyword',
    usage: 'search <keyword>',
    execute(args) {
      if (!args.length) return ' Usage: search <keyword>';
      return COMMANDS.ls.execute(['--search', args.join(' '), '--all']);
    }
  },

  fsearch: {
    desc: 'Full-text fuzzy search on title & description',
    usage: 'fsearch <query>',
    async execute(args) {
      if (!args.length) return ' Usage: fsearch <query>';
      try {
        const todos = await API.searchTodos(args.join(' '));
        if (!todos.length) return ' No results found.';
        todos.forEach((t, i) => t._row = i + 1);
        return { todos, showRow: true };
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  sort: {
    desc: 'Sort todos by field',
    usage: 'sort <due|priority|created>',
    async execute(args) {
      if (!args.length) return ' Usage: sort <due|priority|created>';
      return COMMANDS.ls.execute(['--sort', args[0]]);
    }
  },

  undo: {
    desc: 'Undo the last action',
    usage: 'undo',
    async execute() {
      const action = _undoStack.pop();
      if (!action) return ' Nothing to undo.';
      try {
        switch (action.type) {
          case 'delete':
            await API.addTodo(action.todo);
            invalidateCache();
            return ` Undone: restored #${action.todo.id} "${action.todo.title}"`;
          case 'purge':
            for (const t of action.todos) {
              // Try to restore (may fail if IDs conflict in auto-increment)
              try { await API.addTodo(t); } catch(e) {}
            }
            invalidateCache();
            return ` Undone: restored ${action.todos.length} archived todo(s)`;
          case 'done':
            await API.updateTodo(action.todo.id, { status: action.todo.status, completed: action.todo.completed });
            invalidateCache();
            return ` Undone: #${action.todo.id} "${action.todo.title}" back to ${action.todo.status}`;
          case 'edit':
            await API.updateTodo(action.id, action.prev);
            invalidateCache();
            return ` Undone: #${action.id} restored to previous state`;
          default:
            return ' Cannot undo that action.';
        }
      } catch (err) { return ` Undo failed: ${err.message}`; }
    }
  },

  tag: {
    desc: 'Manage tags on a todo',
    usage: 'tag <row|id|"title"> [+tagName] [-tagName]',
    async execute(args) {
      if (!args.length) return ' Usage: tag <row> [+tag] [-tag]';
      const r = await resolveSingleTodo(args[0]);
      if (r.error) return ` ${r.error}`;
      const todoId = r.todo.id;
      if (args.length === 1) {
        const todo = await API.getTodo(todoId);
        if (todo.tags && todo.tags.length) return ` Tags for #${todoId}: ${todo.tags.join(', ')}`;
        return ` #${todoId} has no tags.`;
      }
      const results = [];
      for (let i = 1; i < args.length; i++) {
        const a = args[i];
        if (a.startsWith('+')) {
          try { await API.addTag(todoId, a.slice(1)); results.push(` Tag +${a.slice(1)}`); }
          catch (err) { results.push(` ${err.message}`); }
        } else if (a.startsWith('-')) {
          try { await API.removeTag(todoId, a.slice(1)); results.push(` Tag -${a.slice(1)}`); }
          catch (err) { results.push(` ${err.message}`); }
        } else {
          results.push(` Use +name to add, -name to remove`);
        }
      }
      invalidateCache();
      return results.join('\n');
    }
  },

  log: {
    desc: 'Show time tracking logs for a todo',
    usage: 'log <row|id|"title">',
    async execute(args) {
      if (!args.length) return ' Usage: log <row | id | "title">';
      const r = await resolveSingleTodo(args[0]);
      if (r.error) return ` ${r.error}`;
      try {
        const data = await API.timeLog(r.todo.id);
        const lines = [` Time logs for #${r.todo.id} "${r.todo.title}":`];
        lines.push(` Total: ${formatDuration(data.total_seconds)}\n`);
        data.logs.forEach(l => {
          const start = l.start_time ? new Date(l.start_time).toLocaleString() : '?';
          const end = l.end_time ? new Date(l.end_time).toLocaleString() : 'running...';
          const dur = l.duration ? formatDuration(l.duration) : '...';
          lines.push(`  ${start} → ${end}  (${dur})`);
        });
        return lines.join('\n');
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  track: {
    desc: 'Start/stop time tracking on a todo',
    usage: 'track <row|id|"title"> [start|stop]',
    async execute(args) {
      if (args.length < 2) return ' Usage: track <row> start|stop';
      const r = await resolveSingleTodo(args[0]);
      if (r.error) return ` ${r.error}`;
      try {
        if (args[1] === 'start') {
          await API.timeStart(r.todo.id);
          return ` ⏱ Started tracking #${r.todo.id} "${r.todo.title}"`;
        } else if (args[1] === 'stop') {
          await API.timeStop(r.todo.id);
          return ` ⏱ Stopped tracking #${r.todo.id} "${r.todo.title}"`;
        }
        return ' Usage: track <row> start|stop';
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  calendar: {
    desc: 'Show todos grouped by due date',
    usage: 'calendar [YYYY-MM]',
    async execute(args) {
      const now = new Date();
      let year = now.getFullYear(), month = now.getMonth();
      if (args.length && args[0].match(/^\d{4}-\d{2}$/)) {
        year = parseInt(args[0]); month = parseInt(args[0].split('-')[1]) - 1;
      }
      try {
        const todos = await getTodos();
        const withDue = todos.filter(t => t.due_date && !ARCHIVE_STATUSES.includes(t.status));
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDay = new Date(year, month, 1).getDay();
        const monthName = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' });
        const lines = [` Calendar: ${monthName}\n`, '  Mon Tue Wed Thu Fri Sat Sun'];
        let week = '';
        for (let i = 0; i < firstDay; i++) { const d = (i + 6) % 7 + 1; week += '    '; } // shift for Mon-first
        for (let day = 1; day <= daysInMonth; day++) {
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dayTodos = withDue.filter(t => t.due_date === dateStr);
          const label = dayTodos.length ? `\x1b[92m${String(day).padStart(2)}\x1b[0m` : String(day).padStart(3);
          week += ' ' + label;
          const dow = new Date(year, month, day).getDay();
          if (dow === 0) { lines.push(week); week = ''; }
        }
        if (week.trim()) lines.push(week);
        lines.push('');
        withDue.filter(t => t.due_date >= `${year}-${String(month+1).padStart(2,'0')}-01` && t.due_date <= `${year}-${String(month+1).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`).forEach(t => {
          lines.push(`  ${t.due_date}  #${t.id} ${t.title}`);
        });
        return lines.join('\n');
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  undone: {
    desc: 'Show todos due within N days',
    usage: 'undone [days=3]',
    execute(args) {
      const days = args.length ? parseInt(args[0]) || 3 : 3;
      return COMMANDS.ls.execute(['--due-soon', String(days)]);
    }
  },

  move: {
    desc: 'Move a todo to a new position',
    usage: 'move <row|id|"title"> <new_row>',
    async execute(args) {
      if (args.length < 2) return ' Usage: move <row | id | "title"> <new_position>';
      const r = await resolveSingleTodo(args[0]);
      if (r.error) return ` ${r.error}`;
      try {
        const todos = await getTodos();
        const active = todos.filter(t => ACTIVE_STATUSES.includes(t.status));
        addRowNumbers(active);
        const targetIdx = parseInt(args[1]) - 1;
        if (isNaN(targetIdx) || targetIdx < 0 || targetIdx >= active.length) return ' Invalid position.';
        const currentIdx = active.findIndex(t => t.id === r.todo.id);
        active.splice(currentIdx, 1);
        active.splice(targetIdx, 0, r.todo);
        await API.reorderTodos(active.map(t => t.id));
        invalidateCache();
        return ` Moved #${r.todo.id} "${r.todo.title}" to position ${args[1]}`;
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  subtasks: {
    desc: 'List subtasks of a todo',
    usage: 'subtasks <row|id|"title">',
    async execute(args) {
      if (!args.length) return ' Usage: subtasks <row | id | "title">';
      const r = await resolveSingleTodo(args[0], { all: true });
      if (r.error) return ` ${r.error}`;
      const todo = await API.getTodo(r.todo.id);
      if (!todo.subtasks || !todo.subtasks.length) return ` #${r.todo.id} has no subtasks.`;
      const lines = [` Subtasks of #${r.todo.id} "${r.todo.title}":`];
      todo.subtasks.forEach(st => { lines.push(`  #${st.id} ${st.title} [${st.status}]`); });
      return lines.join('\n');
    }
  },

  clear: {
    desc: 'Clear the terminal screen',
    usage: 'clear', execute() { return { clear: true }; }
  },

  stats: {
    desc: 'Show todo statistics',
    usage: 'stats',
    async execute() {
      try {
        const s = await API.getStats();
        const pct = s.total ? (s.completed / s.total * 100).toFixed(1) : '0.0';
        return [
          ' Statistics:',
          `  Total:        ${s.total}`,
          `  Active:       ${(s.pending || 0) + (s.in_progress || 0)}`,
          `  Pending:      ${s.pending || 0}`,
          `  In Progress:  ${s.in_progress || 0}`,
          `  Completed:    ${s.completed}  (${pct}%)`,
          `  Learned:      ${s.learned || 0}`,
          `  Categories:   ${s.categories}`,
        ].join('\n');
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  share: {
    desc: 'Create a shareable link',
    usage: 'share [--ids 1,2,3] [--password SECRET] [--days 7]',
    async execute(args) {
      const data = {};
      for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
          case '--ids': data.todo_ids = args[++i].split(',').map(Number); break;
          case '--password': data.password = args[++i]; break;
          case '--days': data.expires_in_days = parseInt(args[++i]); break;
        }
      }
      try {
        const link = await API.createShareLink(data);
        return [` Share link created!`, ` URL: ${link.url}`, data.password ? ' (password protected)' : ' (public)'].join('\n');
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  export: {
    desc: 'Export todos (json, csv, md)',
    usage: 'export [--csv|--md]',
    async execute(args) {
      try {
        invalidateCache();
        const todos = await API.listTodos();
        if (args.includes('--csv')) {
          const header = 'id,title,status,priority,category,due_date,tags';
          const rows = todos.map(t => `"${t.id}","${t.title}","${t.status}","${t.priority}","${t.category || ''}","${t.due_date || ''}","${(t.tags||[]).join(';')}"`);
          return [header, ...rows].join('\n');
        }
        if (args.includes('--md')) {
          const lines = ['| # | Title | Status | Priority | Due | Tags |', '|---|-------|--------|----------|-----|------|'];
          todos.forEach(t => lines.push(`| ${t.id} | ${t.title} | ${t.status} | ${t.priority} | ${t.due_date || '-'} | ${(t.tags||[]).join(', ') || '-'} |`));
          return lines.join('\n');
        }
        return JSON.stringify(todos, null, 2);
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  import: {
    desc: 'Import todos from JSON',
    usage: 'import <json_string>',
    async execute(args) {
      if (!args.length) return ' Usage: import <json_string>';
      try {
        const data = JSON.parse(args.join(' '));
        const items = Array.isArray(data) ? data : [data];
        let count = 0;
        for (const item of items) {
          if (item.title) { await API.addTodo(item); count++; }
        }
        invalidateCache();
        return ` Imported ${count} todo(s).`;
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  cats: {
    desc: 'Manage categories',
    usage: 'cats [rename OLD NEW] [delete CATEGORY]',
    async execute(args) {
      try {
        const todos = await getTodos();
        const catMap = {};
        todos.forEach(t => {
          if (t.category) {
            if (!catMap[t.category]) catMap[t.category] = { count: 0, done: 0 };
            catMap[t.category].count++;
            if (t.status === 'completed' || t.status === 'learned') catMap[t.category].done++;
          }
        });
        if (!args.length) {
          const cats = Object.entries(catMap).sort((a, b) => b[1].count - a[1].count);
          if (!cats.length) return ' No categories found.';
          const lines = [' Categories:\n'];
          cats.forEach(([name, info]) => {
            const pct = info.count ? (info.done / info.count * 100).toFixed(0) : 0;
            lines.push(`  ${name.padEnd(16)} ${String(info.count).padStart(3)} todos  ${String(info.done).padStart(3)} done  (${pct}%)`);
          });
          return lines.join('\n');
        }
        if (args[0] === 'rename' && args.length >= 3) {
          const oldName = args[1], newName = args[2];
          if (!catMap[oldName]) return ` Category "${oldName}" not found.`;
          const todosToUpdate = todos.filter(t => t.category === oldName);
          for (const t of todosToUpdate) {
            await API.updateTodo(t.id, { category: newName });
          }
          invalidateCache();
          return ` Renamed "${oldName}" → "${newName}" (${todosToUpdate.length} todos updated).`;
        }
        if (args[0] === 'delete' && args.length >= 2) {
          const catName = args[1];
          if (!catMap[catName]) return ` Category "${catName}" not found.`;
          const todosToUpdate = todos.filter(t => t.category === catName);
          for (const t of todosToUpdate) {
            await API.updateTodo(t.id, { category: null });
          }
          invalidateCache();
          return ` Deleted category "${catName}" (${todosToUpdate.length} todos un-categorized).`;
        }
        return ' Usage: cats [rename OLD NEW] [delete CATEGORY]';
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  focus: {
    desc: 'Start focus timer on a todo',
    usage: 'focus <row|id|"title"> [minutes]',
    async execute(args) {
      if (!args.length) return ' Usage: focus <row> [minutes]';
      const minutes = parseInt(args[args.length - 1]) && !args[args.length - 1].startsWith('#') ? parseInt(args.pop()) : 25;
      const r = await resolveSingleTodo(args[0]);
      if (r.error) return ` ${r.error}`;
      try {
        await API.timeStart(r.todo.id);
        invalidateCache();
        const end = new Date(Date.now() + minutes * 60 * 1000);
        const timeStr = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return [`` + ` ⏱ Focus started on #${r.todo.id} "${r.todo.title}" for ${minutes}m`, `   Stop at ${timeStr} with: track #${r.todo.id} stop`].join('\n');
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  deps: {
    desc: 'Show dependencies of a todo',
    usage: 'deps <row|id|"title">',
    async execute(args) {
      if (!args.length) return ' Usage: deps <row>';
      const r = await resolveSingleTodo(args[0], { all: true });
      if (r.error) return ` ${r.error}`;
      try {
        const deps = await API.listDependencies(r.todo.id);
        const blocked = await API.checkBlocked(r.todo.id);
        const lines = [` Dependencies of #${r.todo.id} "${r.todo.title}":`];
        if (!deps.length) { lines.push('  (none)'); }
        else {
          deps.forEach(d => {
            const mark = d.completed ? '✓' : '✗';
            lines.push(`  ${mark} #${d.id} "${d.title}" [${d.status}]`);
          });
        }
        if (blocked.blocked) {
          lines.push(`\n  ⛔ Blocked by: ${blocked.dependencies.map(d => `#${d.id} "${d.title}"`).join(', ')}`);
        }
        return lines.join('\n');
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  depends: {
    desc: 'Add a dependency (A depends on B)',
    usage: 'depends <row> on <row>',
    async execute(args) {
      const onIdx = args.indexOf('on');
      if (onIdx < 1 || onIdx >= args.length - 1) return ' Usage: depends <row> on <row>';
      const aSel = args.slice(0, onIdx).join(' ');
      const bSel = args.slice(onIdx + 1).join(' ');
      const rA = await resolveSingleTodo(aSel, { all: true });
      if (rA.error) return ` ${rA.error}`;
      const rB = await resolveSingleTodo(bSel, { all: true });
      if (rB.error) return ` ${rB.error}`;
      if (rA.todo.id === rB.todo.id) return ' A todo cannot depend on itself.';
      try {
        await API.addDependency(rA.todo.id, rB.todo.id);
        invalidateCache();
        return ` #${rA.todo.id} "${rA.todo.title}" now depends on #${rB.todo.id} "${rB.todo.title}"`;
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },

  undep: {
    desc: 'Remove a dependency',
    usage: 'undep <row> <row>',
    async execute(args) {
      if (args.length < 2) return ' Usage: undep <row> <row>';
      const rA = await resolveSingleTodo(args[0], { all: true });
      if (rA.error) return ` ${rA.error}`;
      const rB = await resolveSingleTodo(args[1], { all: true });
      if (rB.error) return ` ${rB.error}`;
      try {
        await API.removeDependency(rA.todo.id, rB.todo.id);
        invalidateCache();
        return ` Removed: #${rA.todo.id} no longer depends on #${rB.todo.id}`;
      } catch (err) { return ` Error: ${err.message}`; }
    }
  },
};
