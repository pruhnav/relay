(() => {
  const API = '/api';
  const MESSAGE_PAGE_SIZE = 50;
  const state = { team: null, user: null, capabilities: null, users: [], conversations: [], conversation: null, records: [], config: null, configEntries: [], editingEntry: null, executions: [], messages: [], messageIds: new Set(), nextBefore: null, hasMoreMessages: false, messagesLoading: false, loadingOlder: false, historyError: '', messageLoadId: 0, sending: false, creating: false, pollTimer: null, lastActivityAt: null };
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const time = (value) => value ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '';
  const initials = (name = '') => name.split(' ').filter(Boolean).map((word) => word[0]).join('').slice(0, 2).toUpperCase() || '?';

  async function api(path, options = {}, { allowUnauthorized = false } = {}) {
    let response;
    try {
      const isMultipart = options.body instanceof FormData;
      response = await fetch(`${API}${path}`, { credentials: 'include', headers: { ...(options.body && !isMultipart ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }, ...options });
    } catch { throw Error('Cannot reach the local server.'); }
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && !allowUnauthorized) showLogin('Your session has ended. Please sign in again.');
      throw Error(data.detail || (response.status === 401 ? 'Your session has ended.' : `Request failed (${response.status})`));
    }
    return data;
  }

  function showLogin(message = '') {
    clearInterval(state.pollTimer); state.pollTimer = null;
    state.team = null; state.user = null; state.capabilities = null; state.users = []; state.conversations = []; state.conversation = null; state.config = null; state.configEntries = []; resetMessages();
    $('app-shell').hidden = true; $('identity-error-screen').hidden = true; $('auth-screen').hidden = false; $('login-error').textContent = message;
    if (message) $('login-password').focus(); else $('login-email').focus();
  }
  function showApp() { $('identity-error-screen').hidden = true; $('auth-screen').hidden = true; $('app-shell').hidden = false; }
  function showIdentityError(message, retry) {
    clearInterval(state.pollTimer); state.pollTimer = null;
    $('app-shell').hidden = true; $('auth-screen').hidden = true; $('identity-error-message').textContent = message; $('identity-error-screen').hidden = false;
    $('retry-identity').onclick = retry; $('return-login').onclick = () => showLogin(); $('retry-identity').focus();
  }
  function notice(message, retry) {
    const node = $('app-notice'); node.replaceChildren(document.createTextNode(message));
    if (retry) { const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Retry'; button.onclick = () => { node.hidden = true; retry(); }; node.append(button); }
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = 'Dismiss'; dismiss.onclick = () => { node.hidden = true; }; node.append(dismiss); node.hidden = false;
  }
  function busy(button, on, label) { button.disabled = on; button.setAttribute('aria-busy', String(on)); if (label) { button.dataset.label ||= button.textContent; button.textContent = on ? label : button.dataset.label; } }
  function hasAdminConfigurationCapability(identity = { user: state.user, capabilities: state.capabilities }) { return identity?.capabilities?.admin_configuration === true; }
  function identityProblem(identity) {
    if (!identity?.user?.id || !identity?.team?.id || typeof identity?.capabilities?.admin_configuration !== 'boolean') return 'Relay received an incomplete account profile. Retry verification after the server finishes starting.';
    const isJohn = identity.user.name === 'John';
    if ((isJohn && (identity.user.role !== 'admin' || !hasAdminConfigurationCapability(identity))) || (identity.user.role === 'admin' && !hasAdminConfigurationCapability(identity))) return 'Your administrator access could not be verified. The admin panel is being withheld until this is resolved.';
    if (identity.user.role !== 'admin' && hasAdminConfigurationCapability(identity)) return 'Relay received conflicting access permissions. The workspace is unavailable until they are resolved.';
    return '';
  }
  function renderIdentity() { $('active-user-name').textContent = state.user.name; $('active-user-avatar').textContent = initials(state.user.name); $('active-team-name').textContent = state.team.name; $('open-admin').hidden = !hasAdminConfigurationCapability(); }
  const entryKinds = { function_tool: 'HTTP tool', mcp: 'MCP server', skill: 'SKILL.md', markdown: 'Markdown', prompt_template: 'Prompt template' };
  function configKind(kind) { return entryKinds[kind] || kind; }
  function endpointFor(kind) { return ({ markdown: 'documents', skill: 'documents', prompt_template: 'prompt-templates', function_tool: 'function-tools', mcp: 'mcp-servers' }[kind]); }
  function entryName(entry) { return entry.kind === 'function_tool' ? entry.label : entry.kind === 'mcp' ? entry.label : entry.name || entry.title || entry.filename; }
  function entryDescription(entry) {
    if (entry.kind === 'function_tool') return entry.description;
    if (entry.kind === 'mcp') return entry.server_url;
    if (entry.kind === 'skill') return entry.filename;
    return entry.content ? `${entry.content.slice(0, 150)}${entry.content.length > 150 ? '…' : ''}` : '';
  }
  function flattenConfig(data) {
    return [
      ...(data.documents || []).map((item) => ({ ...item, kind: item.kind })),
      ...(data.prompt_templates || []).map((item) => ({ ...item, kind: 'prompt_template' })),
      ...(data.function_tools || []).map((item) => ({ ...item, kind: 'function_tool' })),
      ...(data.mcp_servers || []).map((item) => ({ ...item, kind: 'mcp' })),
    ];
  }
  function entryStatus(entry) {
    if (entry.kind !== 'mcp') return '';
    const validation = entry.last_validation || { status: 'not_checked' };
    const detail = validation.detail ? ` · ${validation.detail}` : '';
    return `<span class="audit-status ${esc(validation.status)}">${esc(validation.status.replace('_', ' '))}${esc(detail)}</span>`;
  }
  function renderConfigEntries() {
    const filter = $('admin-tabs').querySelector('.active')?.dataset.adminFilter || 'all';
    const visible = state.configEntries.filter((entry) => filter === 'all' || entry.kind === filter);
    $('config-entry-list').innerHTML = visible.length ? visible.map((entry) => `<article class="config-entry ${entry.enabled ? '' : 'disabled'}"><div class="entry-summary"><span class="config-kind">${esc(configKind(entry.kind))}</span><h4>${esc(entryName(entry))}</h4><p>${esc(entryDescription(entry) || 'No description')}</p><div class="entry-meta"><span>${entry.enabled ? 'Enabled for all users' : 'Disabled'}</span>${entryStatus(entry)}</div></div><div class="config-entry-actions"><button class="text-button" data-edit-entry="${esc(entry.id)}" type="button">Edit</button><button class="text-button" data-toggle-entry="${esc(entry.id)}" type="button">${entry.enabled ? 'Disable' : 'Enable'}</button><button class="danger-button" data-delete-entry="${esc(entry.id)}" type="button">Remove</button></div></article>`).join('') : '<p class="empty-state">No configuration resources in this view.</p>';
  }
  async function loadAdminConfiguration() { const data = await api('/admin/configuration'); state.config = data.configuration; state.configEntries = flattenConfig(data); $('system-prompt').value = state.config.system_prompt; renderConfigEntries(); }
  async function openAdmin() { if (!hasAdminConfigurationCapability()) return; try { await loadAdminConfiguration(); $('system-prompt-status').textContent = ''; $('admin-dialog').showModal(); } catch (error) { notice(`Could not load administration: ${error.message}`, openAdmin); } }
  async function saveSystemPrompt() { const button = $('save-system-prompt'); busy(button, true, 'Saving…'); $('system-prompt-status').textContent = ''; try { const data = await api('/admin/configuration', { method: 'PUT', body: JSON.stringify({ system_prompt: $('system-prompt').value, expected_revision: state.config.revision }) }); state.config = data.configuration; $('system-prompt-status').textContent = 'Saved for all team members.'; } catch (error) { $('system-prompt-status').textContent = error.message; } finally { busy(button, false, 'Saving…'); } }
  function parseJson(id, label, optional = false) { const value = $(id).value.trim(); if (!value && optional) return undefined; if (!value) throw Error(`${label} is required.`); try { const parsed = JSON.parse(value); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Error(); return parsed; } catch { throw Error(`${label} must be a JSON object.`); } }
  function required(value, label) { const trimmed = String(value || '').trim(); if (!trimmed) throw Error(`${label} is required.`); return trimmed; }
  function httpsUrl(value, label) { const url = required(value, label); try { if (new URL(url).protocol !== 'https:') throw Error(); return url; } catch { throw Error(`${label} must be an HTTPS URL.`); } }
  function mcpServerLabel(value) { const label = required(value, 'Provider server label'); if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(label)) throw Error('Provider server label must start with a letter and contain only letters, numbers, underscores, or hyphens.'); return label; }
  function setEntryKind(kind) {
    document.querySelectorAll('[data-entry-fields]').forEach((section) => { section.hidden = section.dataset.entryFields !== kind && !(section.dataset.entryFields === 'document' && (kind === 'markdown' || kind === 'skill')); });
    const documentKind = kind === 'markdown' || kind === 'skill';
    $('document-file').accept = kind === 'skill' ? '.md,text/markdown,text/plain' : '.md,text/markdown,text/plain';
    $('document-file-hint').textContent = kind === 'skill' ? 'a UTF-8 file named exactly SKILL.md (48 KiB maximum)' : 'a UTF-8 .md file (48 KiB maximum)';
    $('entry-intro').textContent = ({ markdown: 'Upload a Markdown reference. Relay reads enabled references as team-wide context.', skill: 'Upload a SKILL.md instruction bundle. Relay uses its enabled instructions across the team.', prompt_template: 'Write reusable team-wide prompt instructions. This is configuration, not an executable script.', function_tool: 'Describe a validated HTTPS function Relay can call when the model requests it.', mcp: 'Connect a remote HTTPS MCP server and restrict Relay to the allowed tools.' }[kind] || '');
    if (!documentKind) $('entry-dialog').classList.remove('is-editing-document');
  }
  function openEntry(id = null) {
    state.editingEntry = id ? state.configEntries.find((entry) => entry.id === id) : null;
    const entry = state.editingEntry; const kind = entry?.kind || 'function_tool';
    $('entry-title').textContent = entry ? `Edit ${configKind(kind)}` : 'Add capability'; $('save-entry').textContent = entry ? 'Save changes' : 'Add capability';
    $('entry-kind').value = kind; $('entry-kind').disabled = Boolean(entry); $('entry-enabled').checked = entry?.enabled ?? true; $('entry-error').textContent = '';
    $('document-title').value = entry?.title || ''; $('document-file').value = ''; $('document-content').value = entry?.content || '';
    $('template-name').value = entry?.name || ''; $('template-content').value = entry?.kind === 'prompt_template' ? entry.content || '' : '';
    $('tool-name').value = entry?.kind === 'function_tool' ? entry.name || '' : ''; $('tool-label').value = entry?.kind === 'function_tool' ? entry.label || '' : ''; $('tool-description').value = entry?.kind === 'function_tool' ? entry.description || '' : ''; $('tool-url').value = entry?.kind === 'function_tool' ? entry.endpoint_url || '' : ''; $('tool-method').value = entry?.kind === 'function_tool' ? entry.method || 'POST' : 'POST'; $('tool-schema').value = entry?.kind === 'function_tool' ? JSON.stringify(entry.input_schema || {}, null, 2) : ''; $('tool-headers').value = entry?.kind === 'function_tool' && entry.headers ? JSON.stringify(entry.headers, null, 2) : '';
    $('mcp-label').value = entry?.kind === 'mcp' ? entry.label || '' : ''; $('mcp-url').value = entry?.kind === 'mcp' ? entry.server_url || '' : ''; $('mcp-tools').value = entry?.kind === 'mcp' ? (entry.allowed_tools || []).join('\n') : ''; $('mcp-approval').value = entry?.kind === 'mcp' ? entry.approval_policy || 'always' : 'always';
    $('entry-dialog').classList.toggle('is-editing-document', Boolean(entry && (kind === 'markdown' || kind === 'skill'))); setEntryKind(kind); $('entry-dialog').showModal();
  }
  function entryPayload(kind) {
    if (kind === 'prompt_template') return { name: required($('template-name').value, 'Template name'), content: required($('template-content').value, 'Prompt template'), enabled: $('entry-enabled').checked };
    if (kind === 'function_tool') return { name: required($('tool-name').value, 'Function name'), label: required($('tool-label').value, 'Display label'), description: required($('tool-description').value, 'Tool description'), endpoint_url: httpsUrl($('tool-url').value, 'HTTPS endpoint URL'), method: $('tool-method').value, input_schema: parseJson('tool-schema', 'Input JSON Schema'), headers: parseJson('tool-headers', 'Environment header map', true), enabled: $('entry-enabled').checked };
    if (kind === 'mcp') { const allowed_tools = $('mcp-tools').value.split(/[\n,]/).map((name) => name.trim()).filter(Boolean); if (!allowed_tools.length) throw Error('Add at least one allowed MCP tool.'); return { label: mcpServerLabel($('mcp-label').value), server_url: httpsUrl($('mcp-url').value, 'HTTPS server URL'), allowed_tools, approval_policy: $('mcp-approval').value, enabled: $('entry-enabled').checked }; }
    return { title: required($('document-title').value, 'Title'), content: required($('document-content').value, 'Markdown content'), enabled: $('entry-enabled').checked };
  }
  async function saveEntry(event) {
    event.preventDefault(); const button = $('save-entry'); const kind = $('entry-kind').value; busy(button, true, 'Saving…'); $('entry-error').textContent = '';
    try {
      const existing = state.editingEntry; const endpoint = endpointFor(kind); let saved;
      if (existing) {
        const data = await api(`/admin/configuration/${endpoint}/${encodeURIComponent(existing.id)}`, { method: 'PATCH', body: JSON.stringify(entryPayload(kind)) });
        saved = data.document || data.prompt_template || data.function_tool || data.mcp_server;
      } else if (kind === 'markdown' || kind === 'skill') {
        const file = $('document-file').files[0]; if (!file) throw Error(`Select the ${kind === 'skill' ? 'SKILL.md' : '.md'} file to upload.`); if (kind === 'skill' && file.name !== 'SKILL.md') throw Error('Skill bundles must be uploaded as a file named exactly SKILL.md.'); if (kind === 'markdown' && !file.name.toLowerCase().endsWith('.md')) throw Error('Markdown references must use a .md filename.');
        const body = new FormData(); body.append('kind', kind); body.append('title', required($('document-title').value, 'Title')); body.append('file', file);
        const data = await api('/admin/configuration/documents', { method: 'POST', body }); saved = data.document;
      } else {
        const data = await api(`/admin/configuration/${endpoint}`, { method: 'POST', body: JSON.stringify(entryPayload(kind)) }); saved = data.prompt_template || data.function_tool || data.mcp_server;
      }
      state.configEntries = existing ? state.configEntries.map((item) => item.id === existing.id ? { ...saved, kind } : item) : [...state.configEntries, { ...saved, kind }]; $('entry-dialog').close(); renderConfigEntries();
    } catch (error) { $('entry-error').textContent = error.message; } finally { busy(button, false, 'Saving…'); }
  }
  async function configEntryAction(event) {
    const edit = event.target.closest('[data-edit-entry]'); const toggle = event.target.closest('[data-toggle-entry]'); const remove = event.target.closest('[data-delete-entry]'); if (edit) return openEntry(edit.dataset.editEntry);
    const id = toggle?.dataset.toggleEntry || remove?.dataset.deleteEntry; const entry = state.configEntries.find((item) => item.id === id); if (!entry) return;
    try { if (remove) { await api(`/admin/configuration/${endpointFor(entry.kind)}/${encodeURIComponent(id)}`, { method: 'DELETE' }); state.configEntries = state.configEntries.filter((item) => item.id !== id); } else { const data = await api(`/admin/configuration/${endpointFor(entry.kind)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: !entry.enabled }) }); const saved = data.document || data.prompt_template || data.function_tool || data.mcp_server; state.configEntries = state.configEntries.map((item) => item.id === id ? { ...saved, kind: entry.kind } : item); } renderConfigEntries(); } catch (error) { notice(`Could not update capability: ${error.message}`); }
  }
  function renderConversations() {
    $('conversation-list').innerHTML = state.conversations.length ? state.conversations.map((item) => `<button class="conversation ${item.id === state.conversation ? 'active' : ''}" data-conversation="${esc(item.id)}" type="button">${esc(item.title)}</button>`).join('') : '<p class="loading">No conversations yet.</p>';
    $('conversation-title').textContent = state.conversations.find((item) => item.id === state.conversation)?.title || 'New research conversation';
  }
  function conversationTimestamp(conversation) { const value = conversation?.last_activity_at || conversation?.updated_at || conversation?.created_at || ''; const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? timestamp : 0; }
  function orderConversations(conversations) { return [...(conversations || [])].sort((left, right) => conversationTimestamp(right) - conversationTimestamp(left) || String(right.id || '').localeCompare(String(left.id || ''))); }
  function moveConversationToTop(conversation) {
    if (!conversation?.id) return;
    state.conversations = [conversation, ...state.conversations.filter((item) => item.id !== conversation.id)];
    state.conversation = conversation.id; renderConversations();
  }
  function messageMarkup(message) {
    const assistant = message.role === 'assistant'; const author = assistant ? { name: 'Relay' } : state.user;
    return `<article class="message"><span class="avatar ${assistant ? 'assistant-avatar' : ''}">${assistant ? 'r' : initials(author.name)}</span><div><div class="message-meta">${esc(author.name)}<time>${time(message.created_at)}</time></div><div class="message-body">${esc(message.content)}</div></div></article>`;
  }
  function messageList() { return $('message-list'); }
  function welcome() { messageList().innerHTML = $('welcome-template').innerHTML; }
  function scrollMessages() { $('messages').scrollTop = $('messages').scrollHeight; }
  function resetMessages() {
    state.messages = []; state.messageIds = new Set(); state.executions = []; state.nextBefore = null; state.hasMoreMessages = false; state.messagesLoading = false; state.loadingOlder = false; state.historyError = ''; state.messageLoadId += 1;
    if ($('message-list')) { messageList().replaceChildren(); renderHistoryControl(); }
    if ($('execution-list')) renderExecutionsSafely();
  }
  function messageNode(message) {
    const template = document.createElement('template'); template.innerHTML = messageMarkup(message); return template.content.firstElementChild;
  }
  function addMessages(messages, { prepend = false } = {}) {
    const unique = (messages || []).filter((message) => message?.id && !state.messageIds.has(message.id));
    if (!unique.length) return 0;
    const list = messageList();
    list.querySelector('.welcome')?.remove();
    const fragment = document.createDocumentFragment(); unique.forEach((message) => { state.messageIds.add(message.id); fragment.append(messageNode(message)); });
    if (prepend) { list.prepend(fragment); state.messages = [...unique, ...state.messages]; }
    else { list.append(fragment); state.messages = [...state.messages, ...unique]; }
    return unique.length;
  }
  function renderHistoryControl() {
    const control = $('history-control');
    if (!state.conversation || (!state.hasMoreMessages && !state.historyError)) { control.hidden = true; control.replaceChildren(); return; }
    control.hidden = false; control.innerHTML = state.loadingOlder
      ? '<span>Loading earlier messages…</span>'
      : state.historyError
        ? `<span>${esc(state.historyError)}</span><button type="button" data-load-older>Retry loading earlier messages</button>`
        : '<button type="button" data-load-older>Load earlier messages</button>';
  }
  function retrievedWork(response) {
    if (!response.duplicate_resolution?.detected && !(response.matches || []).length) return '';
    const matches = (response.matches || []).slice(0, 3).map((record) => `<div class="match-card"><strong>${esc(record.type)}${record.artifact_type ? ` · ${esc(record.artifact_type)}` : ''}</strong><p>${esc(record.source_user_name || 'Team')} · ${esc(record.content)}</p></div>`).join('');
    const related = (response.related_records || []).slice(0, 2).map((record) => `<button type="button" class="artifact-link" data-record="${esc(record.id)}">Related ${esc(record.type)} from ${esc(record.source_user_name || 'team')}</button>`).join('');
    return `<section class="match-block"><div class="match-label">TEAM MEMORY CHECKED</div>${matches}${related}</section>`;
  }
  const EXECUTION_RESULT_LIMIT = 1200;
  function boundedText(value, limit = EXECUTION_RESULT_LIMIT) {
    const text = String(value ?? '').replace(/\s+$/g, '');
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  }
  function parseExecutionResult(value) {
    let parsed = value;
    for (let attempt = 0; attempt < 3 && typeof parsed === 'string'; attempt += 1) {
      const candidate = parsed.trim();
      if (!['{', '[', '"'].includes(candidate[0])) break;
      try { parsed = JSON.parse(candidate); } catch { break; }
    }
    return parsed;
  }
  function executionItemSummary(item) {
    if (item === null || item === undefined) return 'No result';
    if (typeof item !== 'object') return boundedText(item, 260);
    const title = item.full_name || item.name || item.title || item.login || item.id || item.number || 'Result';
    const context = item.description || item.message || item.state || item.status || item.type || '';
    const link = item.html_url || item.web_url || item.url || item.link || '';
    let safeLink = '';
    try { const url = new URL(link); if (url.protocol === 'https:' || url.protocol === 'http:') safeLink = url.href; } catch { /* Untrusted links are shown nowhere. */ }
    return boundedText(`${title}${context ? ` — ${context}` : ''}${safeLink ? `\n${safeLink}` : ''}`, 360);
  }
  function readableExecutionResult(raw) {
    if (typeof raw === 'string' && raw.includes('[external result truncated]')) return 'This earlier tool response was truncated. Run the request again for a compact summary.';
    const value = parseExecutionResult(raw);
    if (value === null || value === undefined || value === '') return 'The capability completed without a response body.';
    if (typeof value === 'string') return boundedText(value);
    if (Array.isArray(value)) {
      const items = value.slice(0, 5).map((item) => `• ${executionItemSummary(item)}`);
      return boundedText(`Returned ${value.length} item${value.length === 1 ? '' : 's'}${items.length ? `:\n${items.join('\n')}` : '.'}`);
    }
    const githubItems = Array.isArray(value.items) ? value.items : null;
    if (githubItems) {
      const count = Number.isFinite(value.total_count) ? value.total_count : githubItems.length;
      const items = githubItems.slice(0, 5).map((item) => `• ${executionItemSummary(item)}`);
      return boundedText(`GitHub returned ${count} result${count === 1 ? '' : 's'}${items.length ? `:\n${items.join('\n')}` : '.'}`);
    }
    const nested = value.result ?? value.data ?? value.content ?? value.text;
    if (nested !== undefined && Object.keys(value).length <= 3) return readableExecutionResult(nested);
    const preferredKeys = ['message', 'summary', 'title', 'name', 'status', 'state', 'description', 'url', 'html_url', 'id'];
    const keys = [...preferredKeys.filter((key) => value[key] !== undefined), ...Object.keys(value).filter((key) => !preferredKeys.includes(key))].slice(0, 6);
    const lines = keys.map((key) => {
      const item = value[key];
      if (item && typeof item === 'object') return `${key}: ${Array.isArray(item) ? `${item.length} item${item.length === 1 ? '' : 's'}` : 'structured data'}`;
      return `${key}: ${boundedText(item, 260)}`;
    });
    return boundedText(lines.length ? lines.join('\n') : 'The capability returned an empty object.');
  }
  function renderExecutions() {
    const list = $('execution-list');
    const executions = Array.isArray(state.executions) ? state.executions : [];
    list.innerHTML = executions.length ? executions.map((execution) => {
      try {
      const stateLabel = esc((execution.state || 'requested').replace('_', ' ')); const detail = execution.error || execution.result || (execution.state === 'awaiting_approval' ? 'Relay is waiting for your approval before this external call.' : 'Relay recorded this capability call.');
      const approval = execution.state === 'awaiting_approval' ? `<div class="dialog-actions"><button class="cancel-button" type="button" data-execution-approval="false" data-execution-id="${esc(execution.id)}">Reject</button><button class="submit-share" type="button" data-execution-approval="true" data-execution-id="${esc(execution.id)}">Approve and continue</button></div>` : '';
      const summary = execution.error ? 'View error details' : execution.state === 'awaiting_approval' ? 'Review request details' : 'View result';
      return `<article class="execution-card"><header><span>${esc(execution.capability_type === 'mcp' ? 'MCP' : 'HTTP tool')}</span><strong>${esc(execution.tool_name)}</strong><span class="execution-state ${esc(execution.state)}">${stateLabel}</span></header><details><summary>${summary}</summary><p>${esc(readableExecutionResult(detail))}</p></details>${approval}</article>`;
      } catch { return '<article class="execution-card"><header><span>Capability activity</span><span class="execution-state">recorded</span></header><p>The response is available, but this activity detail could not be displayed.</p></article>'; }
    }).join('') : '';
  }
  function renderExecutionsSafely() { try { renderExecutions(); } catch { const list = $('execution-list'); if (list) list.textContent = 'Capability activity is available after refresh.'; } }
  async function loadExecutions() {
    if (!state.conversation) { state.executions = []; renderExecutionsSafely(); return; }
    try { state.executions = (await api(`/conversations/${encodeURIComponent(state.conversation)}/tool-executions`)).executions || []; renderExecutionsSafely(); }
    catch { state.executions = []; renderExecutionsSafely(); }
  }
  function mergeExecutions(executions) {
    const incoming = Array.isArray(executions) ? executions : []; const byId = new Map((Array.isArray(state.executions) ? state.executions : []).map((item) => [item.id, item])); incoming.forEach((item) => byId.set(item.id, item)); state.executions = [...byId.values()]; renderExecutionsSafely();
  }
  async function resolveExecution(executionId, approved, button) {
    busy(button, true, approved ? 'Continuing…' : 'Rejecting…');
    try {
      const data = await api(`/tool-executions/${encodeURIComponent(executionId)}/approve`, { method: 'POST', body: JSON.stringify({ approved }) });
      const turn = data.turn; addMessages([turn?.assistant_message]); mergeExecutions(turn?.executions); await loadExecutions(); scrollMessages();
    } catch (error) { notice(`Could not resolve capability request: ${error.message}`); }
    finally { busy(button, false, approved ? 'Continuing…' : 'Rejecting…'); }
  }
  async function loadMessages() {
    const conversationId = state.conversation;
    resetMessages();
    if (!conversationId) { welcome(); state.executions = []; renderExecutionsSafely(); return; }
    const requestId = state.messageLoadId;
    state.messagesLoading = true; messageList().innerHTML = '<p class="loading">Loading recent private messages…</p>';
    try {
      const data = await api(`/conversations/${encodeURIComponent(conversationId)}/messages?limit=${MESSAGE_PAGE_SIZE}`);
      if (requestId !== state.messageLoadId || conversationId !== state.conversation) return;
      messageList().replaceChildren(); addMessages(data.messages); if (!data.messages?.length) welcome();
      state.nextBefore = data.next_before || null; state.hasMoreMessages = data.has_more === true; state.historyError = ''; renderHistoryControl(); scrollMessages(); loadExecutions();
    } catch (error) {
      if (requestId !== state.messageLoadId || conversationId !== state.conversation) return;
      messageList().innerHTML = '<p class="loading">Conversation could not load.</p>'; if (state.user) notice(error.message, loadMessages);
    } finally { if (requestId === state.messageLoadId) state.messagesLoading = false; }
  }
  async function loadOlderMessages() {
    if (!state.conversation || state.messagesLoading || state.loadingOlder || !state.hasMoreMessages || !state.nextBefore) return;
    const conversationId = state.conversation; const cursor = state.nextBefore; const requestId = state.messageLoadId;
    state.loadingOlder = true; state.historyError = ''; renderHistoryControl();
    try {
      const data = await api(`/conversations/${encodeURIComponent(conversationId)}/messages?limit=${MESSAGE_PAGE_SIZE}&before=${encodeURIComponent(cursor)}`);
      if (requestId !== state.messageLoadId || conversationId !== state.conversation) return;
      const container = $('messages'); const previousHeight = container.scrollHeight; const previousTop = container.scrollTop;
      addMessages(data.messages, { prepend: true });
      state.nextBefore = data.next_before || null; state.hasMoreMessages = data.has_more === true; state.historyError = '';
      container.scrollTop = previousTop + (container.scrollHeight - previousHeight);
    } catch (error) {
      if (requestId !== state.messageLoadId || conversationId !== state.conversation) return;
      state.historyError = `Could not load earlier messages: ${error.message}`;
    } finally {
      if (requestId === state.messageLoadId && conversationId === state.conversation) { state.loadingOlder = false; renderHistoryControl(); }
    }
  }
  async function loadContext() {
    if (!state.team) return;
    try { state.records = (await api('/context')).records || []; renderContext(); }
    catch { $('memory-list').innerHTML = '<p class="empty-state">Team memory is temporarily unavailable.</p>'; }
  }
  function renderContext() {
    const query = $('context-search').value.toLowerCase(); const filter = $('hub-filters').querySelector('.active')?.dataset.filter || 'all';
    const visible = state.records.filter((record) => {
      const matchesFilter = filter === 'all' || (filter === 'chat' && record.type === 'chat') || (filter === 'artifact' && record.type === 'artifact') || (filter === 'conflict' && record.artifact_type === 'conflict');
      return matchesFilter && `${record.content} ${record.source_user_name || ''} ${record.artifact_type || ''}`.toLowerCase().includes(query);
    });
    $('memory-list').innerHTML = visible.length ? visible.map((record) => `<article class="memory-card" data-status="${esc(record.type)}"><div class="memory-top"><span class="type-dot"></span>${esc(record.type)}${record.artifact_type ? ` · ${esc(record.artifact_type)}` : ''}</div><p>${esc(record.content)}</p><footer>${esc(record.source_user_name || 'System')} · ${time(record.created_at)}</footer></article>`).join('') : '<p class="empty-state">No shared work matches this view.</p>';
  }
  function pending() { messageList().insertAdjacentHTML('beforeend', '<article class="message pending" id="request-pending"><span class="avatar assistant-avatar">r</span><div><div class="message-meta">Relay</div><div class="message-body"><span class="dots"><i></i><i></i><i></i></span> Checking team memory and preparing a response…</div></div></article>'); scrollMessages(); }
  async function createConversation() {
    if (state.creating || !state.user) return;
    state.creating = true; const button = $('new-chat'); busy(button, true, 'Creating…');
    try { const data = await api('/conversations', { method: 'POST', body: JSON.stringify({}) }); moveConversationToTop(data.conversation); await loadMessages(); $('message-input').focus(); }
    catch (error) { if (state.user) notice(`Could not create a conversation: ${error.message}`, createConversation); }
    finally { state.creating = false; busy(button, false, 'Creating…'); }
  }
  async function send(event) {
    event.preventDefault(); if (state.sending) return;
    const input = $('message-input'); const text = input.value.trim(); if (!text) return;
    if (!state.conversation) { await createConversation(); if (!state.conversation) return; }
    state.sending = true; const button = $('message-form').querySelector('button[type=submit]'); busy(button, true); input.disabled = true; input.value = '';
    if (messageList().querySelector('.welcome')) messageList().replaceChildren(); pending();
    try {
      const data = await api(`/conversations/${encodeURIComponent(state.conversation)}/messages`, { method: 'POST', body: JSON.stringify({ content: text }) });
      const turn = data.turn || {}; const userMessage = data.user_message || turn.user_message; const assistantMessage = data.assistant_message || turn.assistant_message;
      $('request-pending')?.remove(); addMessages([userMessage, assistantMessage]); mergeExecutions(turn.executions || data.executions); moveConversationToTop(data.conversation); $('share-nudge').hidden = true; scrollMessages();
    } catch (error) { $('request-pending')?.remove(); input.value = text; if (state.user) notice(`Message was not sent: ${error.message}`, () => send({ preventDefault() {} })); }
    finally { state.sending = false; busy(button, false); input.disabled = false; input.focus(); }
  }
  function openShare() { $('share-error').textContent = ''; $('share-dialog').showModal(); }
  async function share(event) {
    event.preventDefault(); const submit = event.currentTarget.querySelector('.submit-share'); busy(submit, true, 'Publishing…'); $('share-error').textContent = '';
    try {
      const type = $('share-type').value;
      const payload = { type, content: $('share-content').value, artifact_type: type === 'artifact' ? ($('share-artifact-type').value || undefined) : undefined };
      await api('/context', { method: 'POST', body: JSON.stringify(payload) });
      $('share-dialog').close(); event.currentTarget.reset(); await loadContext();
    } catch (error) { $('share-error').textContent = error.message; } finally { busy(submit, false, 'Publishing…'); }
  }
  function showCatchup(events) {
    if (!events?.length) return;
    $('catchup-title').textContent = `${events.length} team update${events.length === 1 ? '' : 's'} since your last visit`; $('catchup-text').textContent = events[0].summary || 'Your team shared new work.'; $('catchup-banner').hidden = false;
  }
  async function openSession() {
    try { const data = await api('/sessions', { method: 'POST', body: JSON.stringify({}) }); state.lastActivityAt = data.server_time; showCatchup(data.events); return data; }
    catch (error) { if (state.user) notice(`Could not check team updates: ${error.message}`, openSession); return null; }
  }
  async function pollActivity() {
    if (!state.user) return;
    try { const suffix = state.lastActivityAt ? `?since=${encodeURIComponent(state.lastActivityAt)}` : ''; const data = await api(`/activity${suffix}`); state.lastActivityAt = data.server_time || state.lastActivityAt; if (data.events?.length) { showCatchup(data.events); await loadContext(); } $('poll-status').textContent = 'Team memory up to date'; }
    catch { if (state.user) $('poll-status').textContent = 'Team updates will retry soon'; }
  }
  async function openRecord(id) {
    try { const record = (await api(`/context/${encodeURIComponent(id)}`)).record; notice(`${record.type}${record.artifact_type ? ` (${record.artifact_type})` : ''}: ${record.content}`); }
    catch (error) { if (state.user) notice(`Could not open record: ${error.message}`); }
  }
  async function mountAuthenticated(identity) {
    const initialProblem = identityProblem(identity);
    if (initialProblem) { showIdentityError(initialProblem, () => start()); return; }
    state.user = identity.user; state.team = identity.team; state.capabilities = identity.capabilities;
    try {
      const bootstrap = await api('/bootstrap');
      const bootstrapIdentity = { user: state.user, team: state.team, capabilities: bootstrap.capabilities };
      const bootstrapProblem = identityProblem(bootstrapIdentity);
      if (bootstrapProblem) { showIdentityError(bootstrapProblem, () => start()); return; }
      state.capabilities = bootstrap.capabilities; state.users = bootstrap.users || []; state.conversations = orderConversations(bootstrap.conversations || []); state.conversation = state.conversations[0]?.id || null; showApp(); renderIdentity(); renderConversations();
      await Promise.all([loadMessages(), loadContext(), openSession()]); clearInterval(state.pollTimer); state.pollTimer = setInterval(pollActivity, 45000);
    } catch (error) { if (state.user) notice(`Relay could not load: ${error.message}`, () => mountAuthenticated(identity)); }
  }
  async function login(event) {
    event.preventDefault(); const button = $('login-submit'); const email = $('login-email').value.trim(); const password = $('login-password').value; $('login-error').textContent = ''; busy(button, true, 'Signing in…');
    try { const identity = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, { allowUnauthorized: true }); $('login-password').value = ''; await mountAuthenticated(identity); }
    catch (error) { $('login-error').textContent = error.message === 'Your session has ended.' ? 'Those company credentials were not recognized.' : error.message; }
    finally { busy(button, false, 'Signing in…'); }
  }
  async function logout() {
    const button = $('logout-button'); busy(button, true, 'Signing out…');
    try { await api('/auth/logout', { method: 'POST' }, { allowUnauthorized: true }); showLogin(); }
    catch (error) { notice(`Could not sign out: ${error.message}`); busy(button, false, 'Signing out…'); }
  }
  async function start() { try { await mountAuthenticated(await api('/auth/me', {}, { allowUnauthorized: true })); } catch { showLogin(); } }

  $('login-form').onsubmit = login; $('logout-button').onclick = logout; $('new-chat').onclick = createConversation; $('message-form').onsubmit = send;
  $('message-input').onkeydown = (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!state.sending) $('message-form').requestSubmit(); } };
  $('conversation-list').onclick = (event) => { const button = event.target.closest('[data-conversation]'); if (button && !state.sending) { state.conversation = button.dataset.conversation; renderConversations(); loadMessages(); } };
  $('messages').onclick = (event) => { const prompt = event.target.closest('[data-prompt]'); const record = event.target.closest('[data-record]'); const approval = event.target.closest('[data-execution-approval]'); if (prompt) { $('message-input').value = prompt.dataset.prompt; $('message-input').focus(); } if (record) openRecord(record.dataset.record); if (approval) resolveExecution(approval.dataset.executionId, approval.dataset.executionApproval === 'true', approval); };
  $('messages').onscroll = () => { if ($('messages').scrollTop <= 80) loadOlderMessages(); };
  $('history-control').onclick = (event) => { if (event.target.closest('[data-load-older]')) loadOlderMessages(); };
  $('context-search').oninput = renderContext;
  $('hub-filters').onclick = (event) => { const button = event.target.closest('.filter'); if (button) { $('hub-filters').querySelectorAll('.filter').forEach((filter) => filter.classList.toggle('active', filter === button)); renderContext(); } };
  $('refresh-button').onclick = () => Promise.all([loadContext(), pollActivity()]); $('open-share').onclick = openShare; $('nudge-share').onclick = openShare; $('close-share').onclick = () => $('share-dialog').close(); $('cancel-share').onclick = () => $('share-dialog').close(); $('share-form').onsubmit = share; $('catchup-dismiss').onclick = () => { $('catchup-banner').hidden = true; };
  $('open-admin').onclick = openAdmin; $('close-admin').onclick = () => $('admin-dialog').close(); $('save-system-prompt').onclick = saveSystemPrompt; $('new-config-entry').onclick = () => openEntry(); $('close-entry').onclick = () => $('entry-dialog').close(); $('cancel-entry').onclick = () => $('entry-dialog').close(); $('entry-form').onsubmit = saveEntry; $('entry-kind').onchange = () => setEntryKind($('entry-kind').value); $('config-entry-list').onclick = configEntryAction;
  $('admin-tabs').onclick = (event) => { const button = event.target.closest('[data-admin-filter]'); if (button) { $('admin-tabs').querySelectorAll('.filter').forEach((item) => item.classList.toggle('active', item === button)); renderConfigEntries(); } };
  start();
})();
