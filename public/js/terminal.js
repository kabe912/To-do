(function () {
  const output = document.getElementById('output');
  const input = document.getElementById('command-input');
  if (!output || !input) {
    console.error('Terminal: Required DOM elements not found');
    return;
  }
  const history = [];
  let historyIndex = -1;
  let commandCache = '';

  const ANSI_MAP = {
    '\x1b[91m': 'red',
    '\x1b[92m': 'green',
    '\x1b[93m': 'yellow',
    '\x1b[94m': 'cyan',
    '\x1b[95m': 'magenta',
    '\x1b[90m': 'gray',
    '\x1b[97m': 'white',
    '\x1b[1m': 'bold',
    '\x1b[0m': '',
  };

  function ansiToHtml(text) {
    let html = text;
    for (const [code, cls] of Object.entries(ANSI_MAP)) {
      const replacement = cls ? `<span class="${cls}">` : '</span>';
      html = html.split(code).join(replacement);
    }
    return html;
  }

  function addLine(html, cls = '') {
    const div = document.createElement('div');
    div.className = `line ${cls}`.trim();
    div.innerHTML = html;
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
  }

  function addPromptAndCommand(cmd) {
    const div = document.createElement('div');
    div.className = 'line';
    div.innerHTML = `<span class="green">$</span> ${escapeHtml(cmd)}`;
    output.appendChild(div);
  }

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  function clearScreen() {
    output.innerHTML = '';
  }

  function showTable(results, terminal) {
    if (!results || !results.todos) return;

    const todos = results.todos;
    const table = document.createElement('div');
    table.className = 'todo-table';

    const statusLabels = { pending: 'pending', in_progress: 'learn', completed: 'done', learned: 'known' };
    const statusColors = { pending: 'status-pending', in_progress: 'status-progress', completed: 'status-done', learned: 'status-learned' };

    const header = document.createElement('div');
    header.className = 'todo-row header';
    header.innerHTML = `
      <div class="todo-cell id">#</div>
      <div class="todo-cell title">Title</div>
      <div class="todo-cell status">Status</div>
      <div class="todo-cell priority">Pri</div>
      <div class="todo-cell due">Due</div>
      <div class="todo-cell category">Cat</div>
    `;
    table.appendChild(header);

    todos.forEach(t => {
      const row = document.createElement('div');
      row.className = 'todo-row';
      if (t.status === 'completed' || t.status === 'learned') row.classList.add('done');

      const priClass = t.priority === 'high' ? 'priority-high' : t.priority === 'low' ? 'priority-low' : 'priority-medium';
      const statusClass = statusColors[t.status] || 'status-pending';
      const statusLabel = statusLabels[t.status] || t.status;

      row.innerHTML = `
        <div class="todo-cell id">${t.id}</div>
        <div class="todo-cell title${t.status === 'completed' || t.status === 'learned' ? ' done' : ''}"><span class="title-text">${escapeHtml(t.title)}</span></div>
        <div class="todo-cell status"><span class="status-badge ${statusClass}">${statusLabel}</span></div>
        <div class="todo-cell priority ${priClass}">${t.priority.toUpperCase().substring(0, 4)}</div>
        <div class="todo-cell due">${t.due_date || ''}</div>
        <div class="todo-cell category">${escapeHtml(t.category || '')}</div>
      `;
      table.appendChild(row);
    });

    output.appendChild(table);
    output.scrollTop = output.scrollHeight;
  }

  function printResult(result) {
    if (typeof result === 'string') {
      addLine(ansiToHtml(result));
    } else if (result && result.clear) {
      clearScreen();
    } else if (result && result.raw) {
      addLine('<span class="dim">' + escapeHtml(result.raw.replace(/\x1b\[\d+m/g, '')) + '</span>');
      if (result.todos) {
        showTable(result, true);
      }
    } else if (result && result.todos) {
      showTable(result, true);
    }
  }

  async function executeCommand(cmd) {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    addPromptAndCommand(trimmed);

    const parts = parseCommand(trimmed);
    const commandName = parts[0];
    const args = parts.slice(1);

    if (COMMANDS[commandName]) {
      try {
        const result = await COMMANDS[commandName].execute(args);
        printResult(result);
      } catch (err) {
        addLine(`<span class="red">Error:</span> ${escapeHtml(err.message)}`);
      }
    } else {
      addLine(`<span class="red">Command not found:</span> ${escapeHtml(commandName)}. Type <span class="yellow">help</span> for available commands.`);
    }
  }

  function parseCommand(str) {
    const args = [];
    let current = '';
    let inQuote = false;

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '"' || ch === "'") {
        inQuote = !inQuote;
        continue;
      }
      if (ch === ' ' && !inQuote) {
        if (current) { args.push(current); current = ''; }
        continue;
      }
      current += ch;
    }
    if (current) args.push(current);
    return args;
  }

  function getCompletions(partial) {
    const cmdNames = Object.keys(COMMANDS);
    if (!partial.includes(' ')) {
      return cmdNames.filter(c => c.startsWith(partial));
    }
    return [];
  }

  input.addEventListener('keydown', async (e) => {
    const cmd = input.value;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (cmd.trim()) {
        history.push(cmd.trim());
        historyIndex = history.length;
        input.value = '';
        await executeCommand(cmd);
      }
    }

    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length) {
        if (historyIndex === history.length) { commandCache = cmd; }
        if (historyIndex > 0) {
          historyIndex--;
          input.value = history[historyIndex];
        }
      }
    }

    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex < history.length) {
        historyIndex++;
        input.value = historyIndex === history.length ? (commandCache || '') : history[historyIndex];
      }
    }

    else if (e.key === 'Tab') {
      e.preventDefault();
      const completions = getCompletions(cmd);
      if (completions.length === 1) {
        input.value = completions[0] + ' ';
      } else if (completions.length > 1) {
        addLine(`<span class="gray">${completions.join('  ')}</span>`);
      }
    }
  });

  document.addEventListener('click', () => {
    if (document.activeElement !== input) {
      input.focus();
    }
  });

  window.closeOverlay = function () {
    document.getElementById('overlay').classList.add('hidden');
  };

  window.Terminal = {
    clear: clearScreen,
    addLine,
    output,
  };

  input.focus();
})();
