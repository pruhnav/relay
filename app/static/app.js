(() => {
  const API = '/api';
  const state = { team: null, user: null, users: [], conversations: [], conversation: null, items: [], sending: false, creating: false, pollTimer: null, lastActivityAt: null };
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
    state.team = null; state.user = null; state.users = []; state.conversations = []; state.conversation = null;
    $('app-shell').hidden = true; $('auth-screen').hidden = false; $('login-error').textContent = message;
    if (message) $('login-password').focus(); else $('login-email').focus();
  }
  function showApp() { $('auth-screen').hidden = true; $('app-shell').hidden = false; }
  function notice(message, retry) {
    const node = $('app-notice'); node.replaceChildren(document.createTextNode(message));
    if (retry) { const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Retry'; button.onclick = () => { node.hidden = true; retry(); }; node.append(button); }
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = 'Dismiss'; dismiss.onclick = () => { node.hidden = true; }; node.append(dismiss); node.hidden = false;
  }
  function busy(button, on, label) { button.disabled = on; button.setAttribute('aria-busy', String(on)); if (label) { button.dataset.label ||= button.textContent; button.textContent = on ? label : button.dataset.label; } }
  function renderIdentity() { $('active-user-name').textContent = state.user.name; $('active-user-avatar').textContent = initials(state.user.name); $('active-team-name').textContent = state.team.name; }
  function renderConversations() {
    $('conversation-list').innerHTML = state.conversations.length ? state.conversations.map((item) => `<button class="conversation ${item.id === state.conversation ? 'active' : ''}" data-conversation="${esc(item.id)}" type="button">${esc(item.title)}</button>`).join('') : '<p class="loading">No conversations yet.</p>';
    $('conversation-title').textContent = state.conversations.find((item) => item.id === state.conversation)?.title || 'New research conversation';
  }
  function messageMarkup(message) {
    const assistant = message.role === 'assistant'; const author = assistant ? { name: 'Relay' } : state.user;
    return `<article class="message"><span class="avatar ${assistant ? 'assistant-avatar' : ''}">${assistant ? 'r' : initials(author.name)}</span><div><div class="message-meta">${esc(author.name)}<time>${time(message.created_at)}</time></div><div class="message-body">${esc(message.content)}</div></div></article>`;
  }
  function welcome() { $('messages').innerHTML = $('welcome-template').innerHTML; }
  function scrollMessages() { $('messages').scrollTop = $('messages').scrollHeight; }
  function retrievedWork(response) {
    if (!response.duplicate_resolution?.detected && !(response.matches || []).length) return '';
    const matches = (response.matches || []).slice(0, 3).map((item) => `<div class="match-card"><strong>${esc(item.title)}</strong><span class="match-status">${esc(item.status)}</span><p>${esc(item.author_name || 'Team')} · ${esc(item.description)}</p></div>`).join('');
    const artifacts = (response.artifacts || []).slice(0, 3).map((artifact) => `<button type="button" class="artifact-link" data-artifact="${esc(artifact.id)}">Open saved ${esc(artifact.kind)}: ${esc(artifact.title)}</button>`).join('');
    return `<section class="match-block"><div class="match-label">TEAM MEMORY CHECKED</div>${matches}${artifacts}</section>`;
  }
  async function loadMessages() {
    if (!state.conversation) { welcome(); return; }
    $('messages').innerHTML = '<p class="loading">Loading private conversation…</p>';
    try { const data = await api(`/conversations/${encodeURIComponent(state.conversation)}/messages`); data.messages?.length ? $('messages').innerHTML = data.messages.map(messageMarkup).join('') : welcome(); scrollMessages(); }
    catch (error) { $('messages').innerHTML = '<p class="loading">Conversation could not load.</p>'; if (state.user) notice(error.message, loadMessages); }
  }
  async function loadContext() {
    if (!state.team) return;
    try { state.items = (await api('/context')).items || []; renderContext(); }
    catch { $('memory-list').innerHTML = '<p class="empty-state">Team memory is temporarily unavailable.</p>'; }
  }
  function renderContext() {
    const query = $('context-search').value.toLowerCase(); const filter = $('hub-filters').querySelector('.active')?.dataset.filter || 'all';
    const visible = state.items.filter((item) => (filter === 'all' || item.status === filter) && `${item.title} ${item.description}`.toLowerCase().includes(query));
    $('memory-list').innerHTML = visible.length ? visible.map((item) => `<article class="memory-card" data-status="${esc(item.status)}"><div class="memory-top"><span class="type-dot"></span>${esc(item.type)} · ${esc(item.status)}</div><h3>${esc(item.title)}</h3><p>${esc(item.description)}</p><footer>${esc(item.author_name || 'Team')} · ${time(item.updated_at)}</footer></article>`).join('') : '<p class="empty-state">No shared work matches this view.</p>';
  }
  function pending() { $('messages').insertAdjacentHTML('beforeend', '<article class="message pending" id="request-pending"><span class="avatar assistant-avatar">r</span><div><div class="message-meta">Relay</div><div class="message-body"><span class="dots"><i></i><i></i><i></i></span> Checking team memory and preparing a response…</div></div></article>'); scrollMessages(); }
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
    if ($('messages').querySelector('.welcome')) $('messages').innerHTML = ''; pending();
    try {
      const data = await api(`/conversations/${encodeURIComponent(state.conversation)}/messages`, { method: 'POST', body: JSON.stringify({ content: text, client_message_id: crypto.randomUUID?.() }) });
      $('request-pending')?.remove(); $('messages').insertAdjacentHTML('beforeend', messageMarkup(data.user_message) + messageMarkup(data.assistant_message) + retrievedWork(data)); $('share-nudge').hidden = !data.share_suggestion; scrollMessages();
    } catch (error) { $('request-pending')?.remove(); input.value = text; if (state.user) notice(`Message was not sent: ${error.message}`, () => send({ preventDefault() {} })); }
    finally { state.sending = false; busy(button, false); input.disabled = false; input.focus(); }
  }
  function openShare() { $('share-error').textContent = ''; $('share-dialog').showModal(); }
  async function share(event) {
    event.preventDefault(); const submit = event.currentTarget.querySelector('.submit-share'); const files = $('share-files').value.split(',').map((value) => value.trim()).filter(Boolean); busy(submit, true, 'Publishing…'); $('share-error').textContent = '';
    try {
      await api('/context', { method: 'POST', body: JSON.stringify({ type: $('share-type').value, title: $('share-title').value, description: $('share-description').value, status: $('share-status').value, files, endpoint: $('share-endpoint').value || undefined, source_type: 'chat', source_reference: `Private conversation ${state.conversation || 'handoff'}`, artifacts: [] }) });
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
  async function openArtifact(id) {
    try { const artifact = (await api(`/artifacts/${encodeURIComponent(id)}`)).artifact; notice(`${artifact.title}: ${artifact.content || artifact.url || artifact.files?.join(', ') || 'No preview is available for this artifact.'}`); }
    catch (error) { if (state.user) notice(`Could not open artifact: ${error.message}`); }
  }
  async function mountAuthenticated(identity) {
    state.user = identity.user; state.team = identity.team; showApp(); renderIdentity();
    try {
      const bootstrap = await api('/bootstrap'); state.users = bootstrap.users || []; state.conversations = bootstrap.conversations || []; state.conversation = state.conversations[0]?.id || null; renderConversations();
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
  $('messages').onclick = (event) => { const prompt = event.target.closest('[data-prompt]'); const artifact = event.target.closest('[data-artifact]'); if (prompt) { $('message-input').value = prompt.dataset.prompt; $('message-input').focus(); } if (artifact) openArtifact(artifact.dataset.artifact); };
  $('context-search').oninput = renderContext;
  $('hub-filters').onclick = (event) => { const button = event.target.closest('.filter'); if (button) { $('hub-filters').querySelectorAll('.filter').forEach((filter) => filter.classList.toggle('active', filter === button)); renderContext(); } };
  $('refresh-button').onclick = () => Promise.all([loadContext(), pollActivity()]); $('open-share').onclick = openShare; $('nudge-share').onclick = openShare; $('close-share').onclick = () => $('share-dialog').close(); $('cancel-share').onclick = () => $('share-dialog').close(); $('share-form').onsubmit = share; $('catchup-dismiss').onclick = () => { $('catchup-banner').hidden = true; };
  start();
})();
