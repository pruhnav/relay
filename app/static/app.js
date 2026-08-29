(() => {
  const API = '/api';
  const MESSAGE_PAGE_SIZE = 50;
  const state = { team: null, user: null, capabilities: null, users: [], conversations: [], conversation: null, records: [], config: null, configEntries: [], editingEntry: null, messages: [], messageIds: new Set(), nextBefore: null, hasMoreMessages: false, messagesLoading: false, loadingOlder: false, historyError: '', messageLoadId: 0, sending: false, creating: false, pollTimer: null, lastActivityAt: null };
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const time = (value) => value ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '';
  const initials = (name = '') => name.split(' ').filter(Boolean).map((word) => word[0]).join('').slice(0, 2).toUpperCase() || '?';

  async function api(path, options = {}, { allowUnauthorized = false } = {}) {
    let response;
    try {
      response = await fetch(`${API}${path}`, { credentials: 'include', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }, ...options });
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
  function configKind(kind) { return ({ tool: 'Tool', mcp_server: 'MCP server', skill: 'Skill', markdown: 'Markdown', prompt_template: 'Template' }[kind] || kind); }
  function renderConfigEntries() {
    const filter = $('admin-tabs').querySelector('.active')?.dataset.adminFilter || 'all';
    const visible = state.configEntries.filter((entry) => filter === 'all' || entry.kind === filter);
    $('config-entry-list').innerHTML = visible.length ? visible.map((entry) => `<article class="config-entry ${entry.enabled ? '' : 'disabled'}"><div><span class="config-kind">${esc(configKind(entry.kind))}</span><h4>${esc(entry.name)}</h4><p>${esc(entry.description || 'No description')}</p></div><div class="config-entry-actions"><button class="text-button" data-edit-entry="${esc(entry.id)}" type="button">Edit</button><button class="text-button" data-toggle-entry="${esc(entry.id)}" type="button">${entry.enabled ? 'Disable' : 'Enable'}</button><button class="danger-button" data-delete-entry="${esc(entry.id)}" type="button">Remove</button></div></article>`).join('') : '<p class="empty-state">No configuration resources in this view.</p>';
  }
  async function loadAdminConfiguration() { const data = await api('/admin/configuration'); state.config = data.configuration; state.configEntries = data.entries || []; $('system-prompt').value = state.config.system_prompt; renderConfigEntries(); }
  async function openAdmin() { if (!hasAdminConfigurationCapability()) return; try { await loadAdminConfiguration(); $('system-prompt-status').textContent = ''; $('admin-dialog').showModal(); } catch (error) { notice(`Could not load administration: ${error.message}`, openAdmin); } }
  async function saveSystemPrompt() { const button = $('save-system-prompt'); busy(button, true, 'Saving…'); $('system-prompt-status').textContent = ''; try { const data = await api('/admin/configuration', { method: 'PUT', body: JSON.stringify({ system_prompt: $('system-prompt').value }) }); state.config = data.configuration; $('system-prompt-status').textContent = 'Saved for all team members.'; } catch (error) { $('system-prompt-status').textContent = error.message; } finally { busy(button, false, 'Saving…'); } }
  function openEntry(id = null) { state.editingEntry = id ? state.configEntries.find((entry) => entry.id === id) : null; const entry = state.editingEntry; $('entry-title').textContent = entry ? 'Edit resource' : 'Add resource'; $('save-entry').textContent = entry ? 'Save resource' : 'Add resource'; $('entry-kind').value = entry?.kind || 'tool'; $('entry-kind').disabled = Boolean(entry); $('entry-name').value = entry?.name || ''; $('entry-description').value = entry?.description || ''; $('entry-content').value = entry?.content || ''; $('entry-enabled').checked = entry?.enabled ?? true; $('entry-error').textContent = ''; $('entry-dialog').showModal(); }
  async function saveEntry(event) { event.preventDefault(); const button = $('save-entry'); busy(button, true, 'Saving…'); $('entry-error').textContent = ''; const payload = { kind: $('entry-kind').value, name: $('entry-name').value, description: $('entry-description').value, content: $('entry-content').value, enabled: $('entry-enabled').checked }; try { const entry = state.editingEntry ? (await api(`/admin/configuration/entries/${encodeURIComponent(state.editingEntry.id)}`, { method: 'PATCH', body: JSON.stringify(payload) })).entry : (await api('/admin/configuration/entries', { method: 'POST', body: JSON.stringify(payload) })).entry; state.configEntries = state.editingEntry ? state.configEntries.map((item) => item.id === entry.id ? entry : item) : [...state.configEntries, entry]; $('entry-dialog').close(); renderConfigEntries(); } catch (error) { $('entry-error').textContent = error.message; } finally { busy(button, false, 'Saving…'); } }
  async function configEntryAction(event) { const edit = event.target.closest('[data-edit-entry]'); const toggle = event.target.closest('[data-toggle-entry]'); const remove = event.target.closest('[data-delete-entry]'); if (edit) return openEntry(edit.dataset.editEntry); const id = toggle?.dataset.toggleEntry || remove?.dataset.deleteEntry; if (!id) return; const entry = state.configEntries.find((item) => item.id === id); if (!entry) return; try { if (remove) { await api(`/admin/configuration/entries/${encodeURIComponent(id)}`, { method: 'DELETE' }); state.configEntries = state.configEntries.filter((item) => item.id !== id); } else { const updated = (await api(`/admin/configuration/entries/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: !entry.enabled }) })).entry; state.configEntries = state.configEntries.map((item) => item.id === id ? updated : item); } renderConfigEntries(); } catch (error) { notice(`Could not update resource: ${error.message}`); } }
  function renderConversations() {
    $('conversation-list').innerHTML = state.conversations.length ? state.conversations.map((item) => `<button class="conversation ${item.id === state.conversation ? 'active' : ''}" data-conversation="${esc(item.id)}" type="button">${esc(item.title)}</button>`).join('') : '<p class="loading">No conversations yet.</p>';
    $('conversation-title').textContent = state.conversations.find((item) => item.id === state.conversation)?.title || 'New research conversation';
  }
  function messageMarkup(message) {
    const assistant = message.role === 'assistant'; const author = assistant ? { name: 'Relay' } : state.user;
    return `<article class="message"><span class="avatar ${assistant ? 'assistant-avatar' : ''}">${assistant ? 'r' : initials(author.name)}</span><div><div class="message-meta">${esc(author.name)}<time>${time(message.created_at)}</time></div><div class="message-body">${esc(message.content)}</div></div></article>`;
  }
  function messageList() { return $('message-list'); }
  function welcome() { messageList().innerHTML = $('welcome-template').innerHTML; }
  function scrollMessages() { $('messages').scrollTop = $('messages').scrollHeight; }
  function resetMessages() {
    state.messages = []; state.messageIds = new Set(); state.nextBefore = null; state.hasMoreMessages = false; state.messagesLoading = false; state.loadingOlder = false; state.historyError = ''; state.messageLoadId += 1;
    if ($('message-list')) { messageList().replaceChildren(); renderHistoryControl(); }
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
  async function loadMessages() {
    const conversationId = state.conversation;
    resetMessages();
    if (!conversationId) { welcome(); return; }
    const requestId = state.messageLoadId;
    state.messagesLoading = true; messageList().innerHTML = '<p class="loading">Loading recent private messages…</p>';
    try {
      const data = await api(`/conversations/${encodeURIComponent(conversationId)}/messages?limit=${MESSAGE_PAGE_SIZE}`);
      if (requestId !== state.messageLoadId || conversationId !== state.conversation) return;
      messageList().replaceChildren(); addMessages(data.messages); if (!data.messages?.length) welcome();
      state.nextBefore = data.next_before || null; state.hasMoreMessages = data.has_more === true; state.historyError = ''; renderHistoryControl(); scrollMessages();
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
    try { const data = await api('/conversations', { method: 'POST', body: JSON.stringify({}) }); state.conversations.unshift(data.conversation); state.conversation = data.conversation.id; renderConversations(); await loadMessages(); $('message-input').focus(); }
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
      const data = await api(`/conversations/${encodeURIComponent(state.conversation)}/messages`, { method: 'POST', body: JSON.stringify({ content: text, client_message_id: crypto.randomUUID?.() }) });
      $('request-pending')?.remove(); addMessages([data.user_message, data.assistant_message]); messageList().insertAdjacentHTML('beforeend', retrievedWork(data)); $('share-nudge').hidden = !data.share_suggestion; scrollMessages();
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
      state.capabilities = bootstrap.capabilities; state.users = bootstrap.users || []; state.conversations = bootstrap.conversations || []; state.conversation = state.conversations[0]?.id || null; showApp(); renderIdentity(); renderConversations();
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
  $('conversation-list').onclick = (event) => { const button = event.target.closest('[data-conversation]'); if (button && !state.sending) { state.conversation = button.dataset.conversation; renderConversations(); loadMessages(); } };
  $('messages').onclick = (event) => { const prompt = event.target.closest('[data-prompt]'); const record = event.target.closest('[data-record]'); if (prompt) { $('message-input').value = prompt.dataset.prompt; $('message-input').focus(); } if (record) openRecord(record.dataset.record); };
  $('messages').onscroll = () => { if ($('messages').scrollTop <= 80) loadOlderMessages(); };
  $('history-control').onclick = (event) => { if (event.target.closest('[data-load-older]')) loadOlderMessages(); };
  $('context-search').oninput = renderContext;
  $('hub-filters').onclick = (event) => { const button = event.target.closest('.filter'); if (button) { $('hub-filters').querySelectorAll('.filter').forEach((filter) => filter.classList.toggle('active', filter === button)); renderContext(); } };
  $('refresh-button').onclick = () => Promise.all([loadContext(), pollActivity()]); $('open-share').onclick = openShare; $('nudge-share').onclick = openShare; $('close-share').onclick = () => $('share-dialog').close(); $('cancel-share').onclick = () => $('share-dialog').close(); $('share-form').onsubmit = share; $('catchup-dismiss').onclick = () => { $('catchup-banner').hidden = true; };
  $('open-admin').onclick = openAdmin; $('close-admin').onclick = () => $('admin-dialog').close(); $('save-system-prompt').onclick = saveSystemPrompt; $('new-config-entry').onclick = () => openEntry(); $('close-entry').onclick = () => $('entry-dialog').close(); $('cancel-entry').onclick = () => $('entry-dialog').close(); $('entry-form').onsubmit = saveEntry; $('config-entry-list').onclick = configEntryAction;
  $('admin-tabs').onclick = (event) => { const button = event.target.closest('[data-admin-filter]'); if (button) { $('admin-tabs').querySelectorAll('.filter').forEach((item) => item.classList.toggle('active', item === button)); renderConfigEntries(); } };
  start();
})();
