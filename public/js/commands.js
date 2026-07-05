const STATUS_LABELS = {
  pending: 'pending',
  in_progress: 'learn',
  completed: 'done',
  learned: 'known',
};

const STATUS_VALUES = ['pending', 'in_progress', 'completed', 'learned'];
const ARCHIVE_STATUSES = ['completed', 'learned'];
const ACTIVE_STATUSES = ['pending', 'in_progress'];

let _todoCache = null;
let _cacheTime = 0;
const CACHE_TTL = 1500;

function invalidateCache() { _todoCache = null; }

async function getTodos() {
  if (_todoCache && Date.now() - _cacheTime < CACHE_TTL) return _todoCache;
  _todoCache = await API.listTodos();
  _cacheTime = Date.now();
  return _todoCache;
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
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

const COMMANDS = {
  help: {
    desc: 'Show available commands',
    usage: 'help [command]',
    async execute(args) {
      if (args.length) {
        const cmd = args[0];
        if (COMMANDS[cmd]) return ` ${cmd} — ${COMMANDS[cmd].desc}\n Usage: ${COMMANDS[cmd].usage}`;
        return ` Unknown command: ${cmd}`;
      }
      const lines = [' Available commands:\n'];
      for (const [name, cmd] of Object.entries(COMMANDS)) {
        lines.push(`  ${name.padEnd(14)} ${cmd.desc}`);
      }
      lines.push('\n Tips:');
      lines.push('  ↑/↓  Navigate command history');
      lines.push('  /    Show command suggestions');
      return lines.join('\n');
    }
  },

  ls: {
    desc: 'List active todos (pending + in_progress)',
    usage: 'ls [--all] [--archived] [--status pending|in_progress] [--priority high|medium|low] [--category NAME] [--search TEXT]',
    async execute(args) {
      const filters = {};
      let showAll = false;
      let showArchived = false;

      for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
          case '--all': showAll = true; break;
          case '--archived': showArchived = true; break;
          case '--done': filters.status = 'completed'; break;
          case '--status': filters.status = args[++i]; break;
          case '--priority': filters.priority = args[++i]; break;
          case '--category': filters.category = args[++i]; break;
          case '--search': filters.search = args[++i]; break;
        }
      }

      try {
        let todos = await getTodos();
        if (filters.search) todos = todos.filter(t => t.title.toLowerCase().includes(filters.search.toLowerCase()));
        if (filters.status) todos = todos.filter(t => t.status === filters.status);
        if (filters.priority) todos = todos.filter(t => t.priority === filters.priority);
        if (filters.category) todos = todos.filter(t => t.category === filters.category);

        if (!showAll && !showArchived && !filters.status) {
          todos = todos.filter(t => ACTIVE_STATUSES.includes(t.status));
        }
        if (showArchived) {
          todos = todos.filter(t => ARCHIVE_STATUSES.includes(t.status));
        }
        todos = addRowNumbers(todos);

        if (!todos.length) {
          if (showArchived) return ' No archived todos.';
          return ' No active todos. Use add to create one.';
        }
        return { todos, showRow: true };
      } catch (err) {
        return ` Error: ${err.message}`;
      }
    }
  },

  add: {
    desc: 'Add a new todo (auto due_date = today)',
    usage: 'add "Title" [-s pending|in_progress] [-p high|medium|low] [-d YYYY-MM-DD] [-c CATEGORY] [--desc "description"]',
    async execute(args) {
      if (!args.length) return ' Usage: add "Title" [-s pending|in_progress] [-p high|medium|low] [-d YYYY-MM-DD] [-c CATEGORY]';

      let title = '';
      const todo = { status: 'pending', due_date: todayStr() };
      let i = 0;

      if (args[i] && !args[i].startsWith('-')) {
        title = args[i++];
      }

      while (i < args.length) {
        switch (args[i]) {
          case '-s': case '--status': todo.status = args[++i]; break;
          case '-p': case '--priority': todo.priority = args[++i]; break;
          case '-d': case '--due': case '--due-date': todo.due_date = args[++i]; break;
          case '-c': case '--category': todo.category = args[++i]; break;
          case '--desc': case '--description': todo.description = args[++i]; break;
          default: title = (title ? title + ' ' : '') + args[i]; i++; continue;
        }
        i++;
      }

      if (!title) return ' Error: Title is required';
      todo.title = title;

      try {
        const created = await API.addTodo(todo);
        invalidateCache();
        return ` Created #${created.id}: "${created.title}" [${created.due_date}]`;
      } catch (err) {
        return ` Error: ${err.message}`;
      }
    }
  },

  async execOnIds(args, statusField, successMsg, opts) {
    if (!args.length) return;
    const resolved = await resolveTodos(args, opts);
    const results = [];
    for (const r of resolved) {
      if (r.error) { results.push(` ${r.error}`); continue; }
      try {
        const update = typeof statusField === 'object' ? statusField : { status: statusField };
        const todo = await API.updateTodo(r.todo.id, update);
        invalidateCache();
        results.push(successMsg ? successMsg(todo) : ` #${r.todo.id} → ${STATUS_LABELS[todo.status] || todo.status}`);
      } catch (err) {
        results.push(` #${r.todo.id}: ${err.message}`);
      }
    }
    return results.join('\n');
  },

  done: {
    desc: 'Mark a todo as completed (archived from active list)',
    usage: 'done <row|id|"title"> [more...]',
    async execute(args) {
      if (!args.length) return ' Usage: done <row | id | "title">';
      return COMMANDS.execOnIds(args, { status: 'completed', completed: true }, t =>
        ` ✓ #${t.id} "${t.title}" → done (archived)`);
    }
  },

  start: {
    desc: 'Mark a todo as in progress',
    usage: 'start <row|id|"title"> [more...]',
    async execute(args) {
      if (!args.length) return ' Usage: start <row | id | "title">';
      return COMMANDS.execOnIds(args, { status: 'in_progress' }, t =>
        ` → #${t.id} "${t.title}" learning`);
    }
  },

  learned: {
    desc: 'Mark a todo as learned (archived from active list)',
    usage: 'learned <row|id|"title"> [more...]',
    async execute(args) {
      if (!args.length) return ' Usage: learned <row | id | "title">';
      return COMMANDS.execOnIds(args, { status: 'learned' }, t =>
        ` ✓ #${t.id} "${t.title}" → learned (archived)`);
    }
  },

  pending: {
    desc: 'Reset a todo to pending',
    usage: 'pending <row|id|"title"> [more...]',
    async execute(args) {
      if (!args.length) return ' Usage: pending <row | id | "title">';
      return COMMANDS.execOnIds(args, { status: 'pending', completed: false }, t =>
        ` → #${t.id} "${t.title}" pending`);
    }
  },

  status: {
    desc: 'Change status of a todo',
    usage: 'status <row|id|"title"> <pending|in_progress|completed|learned>',
    async execute(args) {
      if (args.length < 2) return ' Usage: status <row | id | "title"> <pending|in_progress|completed|learned>';
      const s = args[1].toLowerCase().replace(/-/g, '_');
      if (!STATUS_VALUES.includes(s)) return ' Status must be: pending, in_progress, completed, or learned';

      const r = await resolveSingleTodo(args[0]);
      if (r.error) return ` ${r.error}`;
      const cv = (s === 'completed' || s === 'learned') ? true : (s === 'pending' ? false : undefined);
      try {
        const todo = await API.updateTodo(r.todo.id, { status: s, ...(cv !== undefined ? { completed: cv } : {}) });
        invalidateCache();
        return ` #${todo.id} "${todo.title}" → ${STATUS_LABELS[s]}`;
      } catch (err) {
        return ` Error: ${err.message}`;
      }
    }
  },

  archive: {
    desc: 'List archived todos (completed + learned)',
    usage: 'archive',
    async execute() {
      return COMMANDS.ls.execute(['--archived']);
    }
  },

  purge: {
    desc: 'Delete all archived todos (completed + learned)',
    usage: 'purge',
    async execute() {
      try {
        const todos = await API.listTodos();
        const archived = todos.filter(t => ARCHIVE_STATUSES.includes(t.status));
        if (!archived.length) return ' No archived todos to purge.';
        for (const t of archived) await API.deleteTodo(t.id);
        invalidateCache();
        return ` Purged ${archived.length} archived todo(s).`;
      } catch (err) {
        return ` Error: ${err.message}`;
      }
    }
  },

  rm: {
    desc: 'Delete a todo',
    usage: 'rm <row|id|"title"> [more...]',
    async execute(args) {
      if (!args.length) return ' Usage: rm <row | id | "title">';
      const resolved = await resolveTodos(args);
      const results = [];
      for (const r of resolved) {
        if (r.error) { results.push(` ${r.error}`); continue; }
        try { await API.deleteTodo(r.todo.id); invalidateCache(); results.push(` Deleted #${r.todo.id} "${r.todo.title}"`); }
        catch (err) { results.push(` #${r.todo.id}: ${err.message}`); }
      }
      return results.join('\n');
    }
  },

  edit: {
    desc: 'Edit a todo',
    usage: 'edit <row|id|"title"> "new title" [-s status] [-p priority] [-d date] [-c category] [--desc "description"]',
    async execute(args) {
      if (args.length < 2) return ' Usage: edit <row | id | "title"> "new title" ...';

      const r = await resolveSingleTodo(args[0]);
      if (r.error) return ` ${r.error}`;
      const todoId = r.todo.id;

      const updates = {};
      let title = '';
      let i = 1;

      if (!args[i].startsWith('-')) { title = args[i++]; }

      while (i < args.length) {
        switch (args[i]) {
          case '-s': case '--status': updates.status = args[++i]; break;
          case '-p': case '--priority': updates.priority = args[++i]; break;
          case '-d': case '--due': updates.due_date = args[++i]; break;
          case '-c': case '--category': updates.category = args[++i]; break;
          case '--desc': updates.description = args[++i]; break;
          default: title = (title ? title + ' ' : '') + args[i]; i++; continue;
        }
        i++;
      }

      if (title) updates.title = title;

      try {
        const updated = await API.updateTodo(todoId, updates);
        invalidateCache();
        return ` Updated #${updated.id}: "${updated.title}"`;
      } catch (err) {
        return ` Error: ${err.message}`;
      }
    }
  },

  priority: {
    desc: 'Change priority of a todo',
    usage: 'priority <row|id|"title"> <high|medium|low>',
    async execute(args) {
      if (args.length < 2) return ' Usage: priority <row | id | "title"> <high|medium|low>';
      const pri = args[1].toLowerCase();
      if (!['high', 'medium', 'low'].includes(pri)) return ' Priority must be: high, medium, or low';

      const r = await resolveSingleTodo(args[0]);
      if (r.error) return ` ${r.error}`;
      try {
        const updated = await API.updateTodo(r.todo.id, { priority: pri });
        invalidateCache();
        return ` #${updated.id} "${updated.title}" priority → ${pri}`;
      } catch (err) {
        return ` Error: ${err.message}`;
      }
    }
  },

  search: {
    desc: 'Search todos by keyword',
    usage: 'search <keyword>',
    async execute(args) {
      if (!args.length) return ' Usage: search <keyword>';
      return COMMANDS.ls.execute(['--search', args.join(' '), '--all']);
    }
  },

  clear: {
    desc: 'Clear the terminal screen',
    usage: 'clear',
    execute() { return { clear: true }; }
  },

  stats: {
    desc: 'Show todo statistics by status',
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
      } catch (err) {
        return ` Error: ${err.message}`;
      }
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
      } catch (err) {
        return ` Error: ${err.message}`;
      }
    }
  },

  export: {
    desc: 'Export todos as JSON',
    usage: 'export',
    async execute() {
      try {
        invalidateCache();
        const todos = await API.listTodos();
        return JSON.stringify(todos, null, 2);
      } catch (err) {
        return ` Error: ${err.message}`;
      }
    }
  },
};
