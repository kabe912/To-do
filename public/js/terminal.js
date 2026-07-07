(function () {
  const output = document.getElementById('output');
  const input = document.getElementById('command-input');
  const suggestions = document.getElementById('suggestions');
  if (!output || !input || !suggestions) {
    console.error('Terminal: Required DOM elements not found');
    return;
  }
  const history = [];
  let historyIndex = -1;
  let commandCache = '';
  let suggestionIndex = -1;
  let suggestionItems = [];
  let busy = false;

  const ANSI_MAP = {
    '\x1b[91m': 'red', '\x1b[92m': 'green', '\x1b[93m': 'yellow',
    '\x1b[94m': 'cyan', '\x1b[95m': 'magenta', '\x1b[90m': 'gray',
    '\x1b[97m': 'white', '\x1b[1m': 'bold', '\x1b[0m': '',
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

  function addPrompt(cmd) {
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
    output.innerHTML = '<div class="line"><span class="dim">-- screen cleared --</span></div>';
  }

  function showTable(todos) {
    if (!todos || !todos.length) return;

    todos.forEach((t, i) => { if (t._row === undefined) t._row = i + 1; });

    const statusLabels = { pending: 'pending', in_progress: 'learn', completed: 'done', learned: 'known' };
    const statusColors = { pending: 'status-pending', in_progress: 'status-progress', completed: 'status-done', learned: 'status-learned' };

    const frag = document.createDocumentFragment();
    const table = document.createElement('div');
    table.className = 'todo-table';

    const header = document.createElement('div');
    header.className = 'todo-row header';
    header.innerHTML = `
      <div class="todo-cell id">#</div>
      <div class="todo-cell title">Title</div>
      <div class="todo-cell status">Status</div>
      <div class="todo-cell priority">Pri</div>
      <div class="todo-cell due">Due</div>
      <div class="todo-cell category">Cat</div>
      <div class="todo-cell tags">Tags</div>`;
    table.appendChild(header);

    todos.forEach(t => {
      const row = document.createElement('div');
      row.className = 'todo-row';
      if (t.status === 'completed' || t.status === 'learned') row.classList.add('done');
      const priClass = t.priority === 'high' ? 'priority-high' : t.priority === 'low' ? 'priority-low' : 'priority-medium';
      const sc = statusColors[t.status] || 'status-pending';
      const sl = statusLabels[t.status] || t.status;
      row.innerHTML = `
        <div class="todo-cell id">${t._row || t.id}</div>
        <div class="todo-cell title${t.status === 'completed' || t.status === 'learned' ? ' done' : ''}"><span class="title-text">${escapeHtml(t.title)}</span></div>
        <div class="todo-cell status"><span class="status-badge ${sc}">${sl}</span></div>
        <div class="todo-cell priority ${priClass}">${t.priority.toUpperCase().substring(0, 4)}</div>
        <div class="todo-cell due">${typeof formatDate === 'function' ? formatDate(t.due_date) : (t.due_date || '')}</div>
        <div class="todo-cell category">${escapeHtml(t.category || '')}</div>
        <div class="todo-cell tags">${t.tags ? escapeHtml(t.tags.join(', ')) : ''}</div>`;
      table.appendChild(row);
    });

    frag.appendChild(table);
    output.appendChild(frag);
    output.scrollTop = output.scrollHeight;
  }

  function printResult(result) {
    if (typeof result === 'string') {
      addLine(ansiToHtml(result));
    } else if (result && result.clear) {
      clearScreen();
    } else if (result && result.todos) {
      showTable(result.todos);
    }
  }

  async function executeCommand(cmd) {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    addPrompt(trimmed);
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
      if (ch === '"' || ch === "'") { inQuote = !inQuote; continue; }
      if (ch === ' ' && !inQuote) {
        if (current) { args.push(current); current = ''; }
        continue;
      }
      current += ch;
    }
    if (current) args.push(current);
    return args;
  }

  /* ── Suggestions dropdown ── */
  function buildSuggestions(filter) {
    const q = filter.toLowerCase();
    let entries = Object.entries(COMMANDS);
    if (q) {
      const start = entries.filter(([name]) => name.startsWith(q));
      entries = start.length > 0 ? start : entries.filter(([name]) => name.includes(q));
    }
    return entries.map(([name, cmd]) => ({ name, desc: cmd.desc }));
  }

  async function buildTagSuggestions(filter) {
    try {
      const tags = await API.autocompleteTags(filter || '');
      return tags.map(t => ({ name: '+' + t.name, desc: `${t.count} todo(s)` }));
    } catch (e) { return []; }
  }

  function renderSuggestions(items) {
    suggestions.innerHTML = '';
    suggestionItems = items;
    suggestionIndex = -1;

    if (!items.length) {
      suggestions.classList.add('hidden');
      return;
    }

    items.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'suggestion-item';
      el.innerHTML = `
        <span class="cmd-name">${escapeHtml(item.name)}</span>
        <span class="cmd-desc">${escapeHtml(item.desc)}</span>
        <span class="cmd-hotkey">⏎</span>`;
      el.addEventListener('mousedown', (e) => { e.preventDefault(); selectSuggestion(i); });
      el.addEventListener('mouseenter', () => setActiveSuggestion(i));
      suggestions.appendChild(el);
    });

    suggestions.classList.remove('hidden');
    if (items.length > 0) setActiveSuggestion(0);
  }

  function setActiveSuggestion(idx) {
    const els = suggestions.querySelectorAll('.suggestion-item');
    els.forEach((el, i) => el.classList.toggle('active', i === idx));
    suggestionIndex = idx;
    if (els[idx]) els[idx].scrollIntoView({ block: 'nearest' });
  }

  function selectSuggestion(idx) {
    const item = suggestionItems[idx];
    if (!item) return;
    _lastInputForSuggestions = '';
    input.value = item.name + ' ';
    hideSuggestions();
    input.focus();
  }

  function hideSuggestions() {
    suggestions.classList.add('hidden');
    suggestions.innerHTML = '';
    suggestionItems = [];
    suggestionIndex = -1;
    _lastInputForSuggestions = '';
  }

  let _suggestionTimer = null;
  let _justSubmitted = false;
  let _lastInputForSuggestions = '';

  function renderSuggestionsForInput() {
    if (_justSubmitted) { _justSubmitted = false; return; }
    const val = input.value;
    if (val === _lastInputForSuggestions) return;
    _lastInputForSuggestions = val;
    if (val.startsWith('/')) {
      const filter = val.slice(1).trim();
      const items = buildSuggestions(filter);
      renderSuggestions(items);
    } else {
      const parts = val.split(' ');
      if (parts.length >= 2 && (parts[0] === 'tag' || parts[0] === 'depends' || parts[0] === 'undep')) {
        const lastPart = parts[parts.length - 1];
        if (lastPart.startsWith('+') || lastPart === '') {
          const filter = lastPart.startsWith('+') ? lastPart.slice(1) : '';
          buildTagSuggestions(filter).then(items => {
            if (items.length && input.value === val) renderSuggestions(items);
            else hideSuggestions();
          });
          return;
        }
      }
      hideSuggestions();
    }
  }

  function updateSuggestions() {
    clearTimeout(_suggestionTimer);
    _suggestionTimer = setTimeout(renderSuggestionsForInput, 30);
  }

  async function submitInput() {
    const trimmed = input.value.trim();
    if (!trimmed) return;
    busy = true;
    _justSubmitted = true;
    history.push(trimmed);
    historyIndex = history.length;
    input.value = '';
    await executeCommand(trimmed);
    input.value = '';
    busy = false;
  }

  input.addEventListener('input', updateSuggestions);
  input.addEventListener('focus', () => {
    clearTimeout(_suggestionTimer);
    renderSuggestionsForInput();
  });

  input.addEventListener('keydown', async (e) => {
    if (busy) { e.preventDefault(); return; }
    const isOpen = !suggestions.classList.contains('hidden');
    const cmd = input.value;

    /* ── Enter ── */
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen) {
        if (suggestionIndex >= 0 && suggestionItems[suggestionIndex]) {
          const selected = suggestionItems[suggestionIndex];
          if (input.value.trim() === selected.name) {
            hideSuggestions();
            await submitInput();
          } else {
            selectSuggestion(suggestionIndex);
          }
        }
        return;
      }
      hideSuggestions();
      await submitInput();
    }

    /* ── ArrowUp ── */
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isOpen) {
        const els = suggestions.querySelectorAll('.suggestion-item');
        if (!els.length) return;
        const prev = suggestionIndex <= 0 ? els.length - 1 : suggestionIndex - 1;
        setActiveSuggestion(prev);
      } else {
        if (history.length) {
          if (historyIndex === history.length) commandCache = cmd;
          if (historyIndex > 0) { historyIndex--; input.value = history[historyIndex]; }
        }
      }
    }

    /* ── ArrowDown ── */
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (isOpen) {
        const els = suggestions.querySelectorAll('.suggestion-item');
        if (!els.length) return;
        const next = suggestionIndex >= els.length - 1 ? 0 : suggestionIndex + 1;
        setActiveSuggestion(next);
      } else {
        if (historyIndex < history.length) {
          historyIndex++;
          input.value = historyIndex === history.length ? (commandCache || '') : history[historyIndex];
        }
      }
    }

    /* ── Tab ── */
    else if (e.key === 'Tab') {
      e.preventDefault();
      if (isOpen && suggestionIndex >= 0 && suggestionItems[suggestionIndex]) {
        selectSuggestion(suggestionIndex);
        return;
      }
      // Tab complete: show arg suggestions
      const parts = cmd.split(' ');
      if (parts.length === 2 && parts[0] && COMMANDS[parts[0]] && !parts[0].startsWith('/')) {
        const filter = parts[1];
        if (typeof getTodos === 'function') {
          getTodos().then(todos => {
            const active = (ACTIVE_STATUSES ? todos.filter(t => ACTIVE_STATUSES.includes(t.status)) : todos);
            active.forEach((t, i) => { if (t._row === undefined) t._row = i + 1; });
            const q = filter.replace(/^#+/, '').toLowerCase();
            const matched = active.filter(t => !q || String(t._row).includes(q) || t.title.toLowerCase().includes(q));
            const items = matched.map(t => ({ type: 'arg', name: '#' + t._row, desc: t.title }));
            if (items.length) {
              suggestionItems = items;
              suggestions.innerHTML = '';
              suggestionIndex = -1;
              items.forEach((item, i) => {
                const el = document.createElement('div');
                el.className = 'suggestion-item';
                el.innerHTML = `<span class="cmd-name">${escapeHtml(item.name)}</span><span class="cmd-desc">${escapeHtml(item.desc)}</span><span class="cmd-hotkey">⏎</span>`;
                el.addEventListener('mousedown', (e) => { e.preventDefault(); selectSuggestion(i); });
                el.addEventListener('mouseenter', () => setActiveSuggestion(i));
                suggestions.appendChild(el);
              });
              suggestions.classList.remove('hidden');
              setActiveSuggestion(0);
            }
          }).catch(() => {});
        }
      }
    }

    /* ── Ctrl+L / Cmd+L → clear ── */
    else if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      clearScreen();
    }

    /* ── Ctrl+D / Cmd+D → done (first arg = last active todo) ── */
    else if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!input.value.trim()) { input.value = 'done #1'; }
      else { input.value = 'done ' + input.value.trim(); }
    }

    /* ── Ctrl+N / Cmd+N → new todo shorthand ── */
    else if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      input.value = 'add ';
    }

    /* ── Ctrl+Z / Cmd+Z → undo ── */
    else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      input.value = 'undo';
      submitInput();
    }

    /* ── Escape ── */
    else if (e.key === 'Escape') {
      if (isOpen) { e.preventDefault(); hideSuggestions(); }
      else if (input.value) { input.value = ''; }
    }
  });

  document.addEventListener('click', (e) => {
    if (document.activeElement !== input && !e.target.closest('#suggestions')) {
      input.focus();
    }
    if (!e.target.closest('#suggestions') && !e.target.closest('#input-line')) {
      hideSuggestions();
    }
  });

  window.closeOverlay = function () {
    document.getElementById('overlay').classList.add('hidden');
  };

  window.Terminal = { clear: clearScreen, addLine, output };

  input.focus();
})();
