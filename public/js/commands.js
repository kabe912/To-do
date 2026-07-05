const STATUS_LABELS = {
  pending: 'pending',
  in_progress: 'learn',
  completed: 'done',
  learned: 'known',
};

const STATUS_VALUES = ['pending', 'in_progress', 'completed', 'learned'];

const COMMANDS = {
  help: {
    desc: 'Show available commands',
    usage: 'help [command]',
    async execute(args) {
      if (args.length) {
        const cmd = args[0];
        if (COMMANDS[cmd]) {
          return ` ${cmd} — ${COMMANDS[cmd].desc}\n Usage: ${COMMANDS[cmd].usage}`;
        }
        return ` Unknown command: ${cmd}`;
      }

      const lines = [' Available commands:\n'];
      for (const [name, cmd] of Object.entries(COMMANDS)) {
        lines.push(`  ${name.padEnd(14)} ${cmd.desc}`);
      }
      lines.push('\n Tips:');
      lines.push('  ↑/↓  Navigate command history');
      lines.push('  Tab  Autocomplete commands');
      return lines.join('\n');
    }
  },

  ls: {
    desc: 'List all todos',
    usage: 'ls [--status pending|in_progress|completed|learned] [--done] [--active] [--priority high|medium|low] [--category NAME] [--search TEXT]',
    async execute(args) {
      const filters = {};
      for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
          case '--done': filters.status = 'completed'; break;
          case '--active': filters.status = 'pending'; break;
          case '--status': filters.status = args[++i]; break;
          case '--priority': filters.priority = args[++i]; break;
          case '--category': filters.category = args[++i]; break;
          case '--search': filters.search = args[++i]; break;
        }
      }

      try {
        const todos = await API.listTodos(filters);
        if (!todos.length) {
          return ' No todos found. Use add to create one.';
        }

        const rows = [
          { id: '#', title: 'Title', status: 'Status', priority: 'Pri', due: 'Due', category: 'Cat' },
          ...todos.map(t => ({
            id: t.id,
            title: t.title,
            status: STATUS_LABELS[t.status] || t.status,
            priority: t.priority.toUpperCase().substring(0, 4),
            due: t.due_date || '',
            category: t.category || '',
            _status: t.status,
            _pri: t.priority,
          })),
        ];

        const colWidths = {
          id: Math.max(...rows.map(r => String(r.id).length)) + 2,
          title: Math.min(Math.max(...rows.map(r => r.title.length)) + 2, 50),
          status: Math.max(...rows.map(r => r.status.length)) + 2,
          priority: Math.max(...rows.map(r => r.priority.length)) + 2,
          due: Math.max(...rows.map(r => r.due.length)) + 2,
          category: Math.max(...rows.map(r => r.category.length)) + 2,
        };

        const hline = ` ${'─'.repeat(Object.values(colWidths).reduce((a, b) => a + b, 0) + 5)}`;

        let out = hline + '\n';

        const renderRow = (r, isHeader) => {
          const cells = [
            String(r.id).padStart(colWidths.id - 1),
            r.title.padEnd(colWidths.title),
            r.status.padEnd(colWidths.status),
            r.priority.padEnd(colWidths.priority),
            r.due.padEnd(colWidths.due),
            r.category.padEnd(colWidths.category),
          ];
          if (isHeader) return ` ${cells.join(' ')}`;

          const style = r._status === 'completed' || r._status === 'learned' ?
            cells.map((c, i) => i === 1 ? c.replace(/./g, '─') : c).join(' ') :
            cells.join(' ');

          return ` ${style}`;
        };

        rows.forEach((r, i) => {
          if (i === 0) {
            out += renderRow(r, true) + '\n';
            out += hline + '\n';
          } else {
            out += renderRow(r, false) + '\n';
          }
        });

        out += hline;
        return { raw: out, todos };
      } catch (err) {
        return ` Error: ${err.message}`;
      }
    }
  },

  add: {
    desc: 'Add a new todo',
    usage: 'add "Title" [-s pending|in_progress|completed|learned] [-p high|medium|low] [-d YYYY-MM-DD] [-c CATEGORY] [--desc "description"]',
    async execute(args) {
      if (!args.length) return ' Usage: add "Title" [-s pending|in_progress|completed|learned] [-p high|medium|low] [-d YYYY-MM-DD] [-c CATEGORY]';

      let title = '';
      const todo = { status: 'pending' };
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
        return ` Created todo #${created.id}: "${created.title}" [${STATUS_LABELS[created.status] || created.status}]`;
      } catch (err) {
        return ` Error: ${err.message}`;
      }
    }
  },

  done: {
    desc: 'Mark a todo as completed (set status = completed)',
    usage: 'done <id> [id2 id3 ...]',
    async execute(args) {
      if (!args.length) return ' Usage: done <id>';
      const results = [];
      for (const arg of args) {
        const id = parseInt(arg);
        if (isNaN(id)) { results.push(` Invalid id: ${arg}`); continue; }
        try {
          const todo = await API.updateTodo(id, { status: 'completed', completed: true });
          results.push(` Todo #${id} → completed ✓`);
        } catch (err) {
          results.push(` Todo #${id}: ${err.message}`);
        }
      }
      return results.join('\n');
    }
  },

  start: {
    desc: 'Mark a todo as in progress (set status = in_progress)',
    usage: 'start <id> [id2 id3 ...]',
    async execute(args) {
      if (!args.length) return ' Usage: start <id>';
      const results = [];
      for (const arg of args) {
        const id = parseInt(arg);
        if (isNaN(id)) { results.push(` Invalid id: ${arg}`); continue; }
        try {
          const todo = await API.updateTodo(id, { status: 'in_progress' });
          results.push(` Todo #${id} → learning in progress`);
        } catch (err) {
          results.push(` Todo #${id}: ${err.message}`);
        }
      }
      return results.join('\n');
    }
  },

  learned: {
    desc: 'Mark a todo as learned (set status = learned)',
    usage: 'learned <id> [id2 id3 ...]',
    async execute(args) {
      if (!args.length) return ' Usage: learned <id>';
      const results = [];
      for (const arg of args) {
        const id = parseInt(arg);
        if (isNaN(id)) { results.push(` Invalid id: ${arg}`); continue; }
        try {
          const todo = await API.updateTodo(id, { status: 'learned' });
          results.push(` Todo #${id} → learned ✓`);
        } catch (err) {
          results.push(` Todo #${id}: ${err.message}`);
        }
      }
      return results.join('\n');
    }
  },

  pending: {
    desc: 'Reset a todo to pending (set status = pending)',
    usage: 'pending <id> [id2 id3 ...]',
    async execute(args) {
      if (!args.length) return ' Usage: pending <id>';
      const results = [];
      for (const arg of args) {
        const id = parseInt(arg);
        if (isNaN(id)) { results.push(` Invalid id: ${arg}`); continue; }
        try {
          const todo = await API.updateTodo(id, { status: 'pending' });
          results.push(` Todo #${id} → pending`);
        } catch (err) {
          results.push(` Todo #${id}: ${err.message}`);
        }
      }
      return results.join('\n');
    }
  },

  status: {
    desc: 'Change status of a todo (pending | in_progress | completed | learned)',
    usage: 'status <id> <pending|in_progress|completed|learned>',
    async execute(args) {
      if (args.length < 2) return ' Usage: status <id> <pending|in_progress|completed|learned>';
      const id = parseInt(args[0]);
      if (isNaN(id)) return ` Invalid id: ${args[0]}`;
      const s = args[1].toLowerCase().replace(/-/g, '_');
      if (!STATUS_VALUES.includes(s)) return ' Status must be: pending, in_progress, completed, or learned';

      try {
        const updated = await API.updateTodo(id, {
          status: s,
          ...(s === 'completed' ? { completed: true } : s === 'pending' ? { completed: false } : {}),
        });
        return ` Todo #${updated.id} status → ${STATUS_LABELS[s]}`;
      } catch (err) {
        return ` Error: ${err.message}`;
      }
    }
  },

  rm: {
    desc: 'Delete a todo',
    usage: 'rm <id> [id2 id3 ...]',
    async execute(args) {
      if (!args.length) return ' Usage: rm <id>';
      const results = [];
      for (const arg of args) {
        const id = parseInt(arg);
        if (isNaN(id)) { results.push(` Invalid id: ${arg}`); continue; }
        try {
          await API.deleteTodo(id);
          results.push(` Deleted todo #${id}`);
        } catch (err) {
          results.push(` Todo #${id}: ${err.message}`);
        }
      }
      return results.join('\n');
    }
  },

  edit: {
    desc: 'Edit a todo',
    usage: 'edit <id> "new title" [-s status] [-p priority] [-d date] [-c category] [--desc "description"]',
    async execute(args) {
      if (args.length < 2) return ' Usage: edit <id> "new title" [-s status] [-p priority] [-d date] [-c category]';

      const id = parseInt(args[0]);
      if (isNaN(id)) return ` Invalid id: ${args[0]}`;

      const updates = {};
      let title = '';
      let i = 1;

      if (!args[i].startsWith('-')) {
        title = args[i++];
      }

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
        const updated = await API.updateTodo(id, updates);
        return ` Updated todo #${updated.id}: "${updated.title}" [${STATUS_LABELS[updated.status] || updated.status}]`;
      } catch (err) {
        return ` Error: ${err.message}`;
      }
    }
  },

  priority: {
    desc: 'Change priority of a todo',
    usage: 'priority <id> <high|medium|low>',
    async execute(args) {
      if (args.length < 2) return ' Usage: priority <id> <high|medium|low>';
      const id = parseInt(args[0]);
      if (isNaN(id)) return ` Invalid id: ${args[0]}`;
      const pri = args[1].toLowerCase();
      if (!['high', 'medium', 'low'].includes(pri)) return ' Priority must be: high, medium, or low';

      try {
        const updated = await API.updateTodo(id, { priority: pri });
        return ` Todo #${updated.id} priority set to ${pri}`;
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
      const keyword = args.join(' ');
      const result = await COMMANDS.ls.execute(['--search', keyword]);
      return result;
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
        const learning = s.in_progress || 0;
        const known = s.learned || 0;
        return [
          ' Statistics:',
          `  Total:        ${s.total}`,
          `  Pending:      ${s.pending || 0}`,
          `  In Progress:  ${learning}`,
          `  Completed:    ${s.completed}  (${pct}%)`,
          `  Learned:      ${known}`,
          `  Categories:   ${s.categories}`,
        ].join('\n');
      } catch (err) {
        return ` Error: ${err.message}`;
      }
    }
  },

  share: {
    desc: 'Create a shareable link for your todos',
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
        return [
          ` Share link created!`,
          ` URL: ${link.url}`,
          ` Token: ${link.token}`,
          data.password ? ' (password protected)' : ' (public)',
        ].join('\n');
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
        const todos = await API.listTodos();
        return JSON.stringify(todos, null, 2);
      } catch (err) {
        return ` Error: ${err.message}`;
      }
    }
  },
};
