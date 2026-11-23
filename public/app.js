const $ = (id) => document.getElementById(id);
const statuses = ['todo', 'doing', 'done'];
const labels = { todo: '未着手', doing: '進行中', done: '完了' };
const localKey = 'shizuku.tasks.v1';
const icons = {
  drop: '<path d="M12 3c3 4.4 6.5 8 6.5 11.8a6.5 6.5 0 1 1-13 0C5.5 11 9 7.4 12 3Z"/><path d="M9 15.1c0 1.6 1 2.6 2.4 2.9"/>',
  user: '<circle cx="12" cy="8" r="3.3"/><path d="M5 20v-2a7 5 0 0 1 14 0v2"/>',
  pen: '<path d="m15 5 4 4M4 20l1.1-4.6L16.5 4a2 2 0 0 1 3 3L8.2 18.9 4 20Z"/>',
  spark: '<path d="M10 2l1.8 5.2L17 9l-5.2 1.8L10 16l-1.8-5.2L3 9l5.2-1.8L10 2Zm8 11 1 2.8 2.8 1-2.8 1L18 21l-1-3.2-2.8-1 2.8-1L18 13Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  device: '<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18.5h2"/>',
  cloud: '<path d="M6.5 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.6 1A4 4 0 0 1 18 18Z"/>',
  inbox: '<path d="M4 5h16l2 10-2 4H4l-2-4 2-10Zm-2 9h6l1.5 2h5l1.5-2h6"/>',
  todo: '<circle cx="12" cy="12" r="8.5"/>',
  doing: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  done: '<circle cx="12" cy="12" r="8.5"/><path d="m8 12 2.5 2.5L16 9"/>',
  more: '<circle cx="5" cy="12" r=".8"/><circle cx="12" cy="12" r=".8"/><circle cx="19" cy="12" r=".8"/>',
  swipe: '<path d="M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4"/>',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}
for (const node of document.querySelectorAll('[data-icon]')) node.innerHTML = icon(node.dataset.icon);

function localTasks() {
  try {
    const value = JSON.parse(localStorage.getItem(localKey) || '[]');
    return Array.isArray(value) ? value.filter((task) => task && typeof task.title === 'string' &&
      typeof task.id === 'string' && statuses.includes(task.status) && Number.isSafeInteger(task.createdAt)) : [];
  } catch {
    return [];
  }
}

let user = null;
let tasks = localTasks();
let filter = 'all';
let connected = false;
let authAvailable = null;
let changing = false;
let activeEdit;
let result;
let toastTimer;
const memo = $('memo');
const taskList = $('tasks');
const filters = [...document.querySelectorAll('[data-filter]')];
const date = new Date();
$('today').textContent = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' }).format(date);
$('today').dateTime = new Intl.DateTimeFormat('sv-SE').format(date);
try { memo.value = localStorage.getItem('shizuku.draft.v1') || ''; } catch {}

function saveDraft() {
  try { localStorage.setItem('shizuku.draft.v1', memo.value); } catch {}
}
memo.addEventListener('input', saveDraft);
memo.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
    event.preventDefault();
    $('composer').requestSubmit();
  }
});

function notify(message, undo) {
  const dialog = document.querySelector('dialog[open]');
  if (dialog) {
    let status = dialog.querySelector('.dialog-message');
    if (!status) {
      status = document.createElement('p');
      status.className = 'dialog-message';
      status.setAttribute('role', 'status');
      dialog.append(status);
      dialog.addEventListener('close', () => status.remove(), { once: true });
    }
    status.textContent = message;
    return;
  }
  clearTimeout(toastTimer);
  $('toast-message').textContent = message;
  $('toast').hidden = false;
  $('undo').hidden = !undo;
  $('undo').onclick = undo ? () => {
    $('toast').hidden = true;
    void undo();
  } : null;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, undo ? 8500 : 4300);
}

async function api(path, body, timeout = 6500) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '通信に失敗しました。');
  return data;
}

async function change(upserts = [], deletes = [], { preserveExisting = false } = {}) {
  if (changing) return false;
  changing = true;
  const currentUser = user;
  const next = new Map(tasks.map((task) => [task.id, task]));
  deletes.forEach((id) => next.delete(id));
  upserts.forEach((task) => {
    if (!preserveExisting || !next.has(task.id)) next.set(task.id, task);
  });
  try {
    if (currentUser) {
      const data = await api('/api/tasks', { upserts, deletes, preserveExisting });
      tasks = data.tasks;
    } else {
      const values = [...next.values()];
      localStorage.setItem(localKey, JSON.stringify(values));
      tasks = values;
    }
    render();
    return true;
  } catch (error) {
    notify(currentUser ? error.message : '端末に保存できませんでした。');
    return false;
  } finally {
    changing = false;
  }
}

function makeTask(title) {
  return { id: crypto.randomUUID(), title, status: 'todo', createdAt: Date.now() };
}

function showFilter(value) {
  filter = value;
  render();
}

function render() {
  const focus = document.activeElement?.closest('.task');
  const focusId = focus?.dataset.id;
  const focusAction = document.activeElement?.dataset.action;
  const counts = { all: tasks.length, todo: 0, doing: 0, done: 0 };
  tasks.forEach((task) => { counts[task.status]++; });
  $('completion').textContent = `${counts.done} / ${counts.all} 件完了`;
  for (const button of filters) {
    const value = button.dataset.filter;
    button.setAttribute('aria-pressed', String(filter === value));
    button.querySelector('span').textContent = counts[value];
  }
  const selected = tasks.filter((task) => filter === 'all' || task.status === filter)
    .sort((a, b) => b.createdAt - a.createdAt);
  const old = new Map([...taskList.querySelectorAll('.task')].map((node) => [node.dataset.id, node]));
  const rows = selected.map((task) => {
    const row = old.get(task.id);
    return row?.task === task ? row : taskRow(task);
  });
  $('gesture-guide').hidden = rows.length === 0;
  taskList.setAttribute('aria-busy', 'false');
  if (rows.length) {
    // Keep unaffected rows in the DOM so rapid entry does not replay their animations.
    [...taskList.children].filter((node) => !rows.includes(node)).forEach((node) => node.remove());
    rows.forEach((row, index) => {
      if (taskList.children[index] !== row) taskList.insertBefore(row, taskList.children[index] || null);
    });
  } else {
    taskList.innerHTML = `<div class="empty glass"><span class="empty-icon">${icon('inbox')}</span><p></p></div>`;
    taskList.querySelector('p').textContent = filter === 'all' ? 'タスクはまだありません' : `${labels[filter]}のタスクはありません`;
  }
  if (focusId && focusAction && !document.activeElement?.closest('.task')) {
    const replacement = rows.find((row) => row.dataset.id === focusId);
    (replacement?.querySelector(`[data-action="${focusAction}"]`) || filters.find((button) => button.dataset.filter === filter))?.focus();
  }
}

function taskRow(task) {
  const row = document.createElement('article');
  row.className = 'task glass';
  row.dataset.id = task.id;
  row.dataset.status = task.status;
  row.task = task;
  row.innerHTML = `
    <div class="swipe-target" aria-hidden="true"><span></span><span></span></div>
    <div class="task-track">
      <button class="task-button" data-action="status" type="button">${icon(task.status)}</button>
      <div class="task-text"><span class="task-name"></span><span class="status"></span></div>
      <button class="task-button" data-action="edit" type="button">${icon('more')}</button>
    </div>`;
  row.querySelector('.task-name').textContent = task.title;
  const status = row.querySelector('.status');
  status.textContent = labels[task.status];
  status.dataset.status = task.status;
  const step = statuses.indexOf(task.status);
  const button = row.querySelector('[data-action="status"]');
  button.dataset.status = task.status;
  const next = statuses[(step + 1) % statuses.length];
  button.setAttribute('aria-label', `${task.title}を${labels[next]}にする`);
  button.onclick = () => { void setStatus(task, next); };
  const edit = row.querySelector('[data-action="edit"]');
  edit.setAttribute('aria-label', `${task.title}を編集`);
  edit.onclick = () => {
    activeEdit = task;
    $('edit-memo').value = task.title;
    $('edit-status').value = task.status;
    $('edit-dialog').showModal();
  };

  const track = row.querySelector('.task-track');
  const hints = row.querySelector('.swipe-target').children;
  hints[0].textContent = labels[statuses[step - 1]] || '';
  hints[1].textContent = labels[statuses[step + 1]] || '';
  let pointer;
  track.addEventListener('pointerdown', (event) => {
    if (changing || event.button !== 0 || !event.isPrimary || event.target.closest('button')) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, horizontal: false };
    track.setPointerCapture(event.pointerId);
  });
  track.addEventListener('pointermove', (event) => {
    if (pointer?.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (!pointer.horizontal) {
      if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { reset(); return; }
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      pointer.horizontal = true;
      track.classList.add('dragging');
    }
    const target = statuses[step + (dx < 0 ? 1 : -1)];
    pointer.dx = target ? dx : 0;
    const offset = target ? Math.max(-135, Math.min(dx, 135)) : dx * .12;
    track.style.transform = `translateX(${offset}px)`;
  });
  track.addEventListener('pointerup', async (event) => {
    if (pointer?.id !== event.pointerId) return;
    const dx = pointer.dx;
    const threshold = Math.max(46, Math.min(75, track.clientWidth * .18));
    const target = Math.abs(dx) >= threshold && statuses[step + (dx < 0 ? 1 : -1)];
    reset();
    if (target) await setStatus(task, target);
  });
  track.addEventListener('pointercancel', reset);
  track.addEventListener('lostpointercapture', reset);
  function reset() {
    pointer = undefined;
    track.classList.remove('dragging');
    track.style.transform = '';
  }
  return row;
}

async function setStatus(task, status) {
  if (await change([{ ...task, status }])) {
    notify(`${labels[status]}に変更しました`, () => {
      const current = tasks.find(({ id }) => id === task.id);
      return current && change([{ ...current, status: task.status }]);
    });
  }
}

for (const button of filters) button.onclick = () => showFilter(button.dataset.filter);
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => $(button.dataset.close).close();

$('composer').onsubmit = async (event) => {
  event.preventDefault();
  const draft = memo.value;
  if (!draft.trim()) { memo.focus(); return; }
  if (filter !== 'all' && filter !== 'todo') filter = 'all';
  if (!await change([makeTask(draft.trim())])) return;
  if (memo.value === draft) {
    memo.value = '';
    saveDraft();
  }
  // Retain keyboard focus for keyboard entry without reopening a touch keyboard after a tap.
  if (document.activeElement === memo) memo.focus();
  notify('タスクを追加しました');
};

$('edit-form').onsubmit = async (event) => {
  event.preventDefault();
  const title = $('edit-memo').value.trim();
  if (!title) { $('edit-memo').focus(); return; }
  if (await change([{ ...activeEdit, title, status: $('edit-status').value }])) {
    $('edit-dialog').close();
    notify('タスクを保存しました');
  }
};
$('delete').onclick = async () => {
  const deleted = activeEdit;
  if (await change([], [deleted.id])) {
    $('edit-dialog').close();
    notify('タスクを削除しました', () => change([deleted]));
  }
};

$('ai').onclick = async () => {
  const draft = memo.value;
  if (!draft.trim()) { memo.focus(); return; }
  if (!user) { openAccount('Googleでログインすると、入力したメモをAIで分割できます。'); return; }
  $('ai').disabled = true;
  $('ai').lastChild.textContent = '分割中…';
  try {
    const data = await api('/api/ai/split', { memo: draft.trim() }, 23000);
    result = { draft, suggestions: data.suggestions };
    $('suggestions').replaceChildren(...data.suggestions.map((title) => {
      const node = document.createElement('li');
      node.textContent = title;
      return node;
    }));
    if (!document.querySelector('dialog[open]')) $('ai-dialog').showModal();
    else notify('AIの分割案ができました。');
  } catch (error) {
    notify(error.message);
  } finally {
    $('ai').disabled = false;
    $('ai').lastChild.textContent = 'AIで分ける';
  }
};
$('accept-ai').onclick = async () => {
  if (filter !== 'all' && filter !== 'todo') filter = 'all';
  if (!await change(result.suggestions.map(makeTask))) return;
  if (memo.value === result.draft) { memo.value = ''; saveDraft(); }
  $('ai-dialog').close();
  notify('分割したタスクを追加しました');
};

function openAccount(message) {
  $('account-title').textContent = user ? 'アカウント' : 'ログイン';
  const availability = !connected ? '接続状態を確認してください。' :
    authAvailable === false ? 'Googleログインの設定が必要です。' : '';
  const description = user ? user.name : message || 'Googleでログインすると、タスクを端末間で同期できます。';
  $('account-description').textContent = [description, user ? '' : availability].filter(Boolean).join('\n');
  $('google').hidden = Boolean(user);
  $('logout').hidden = !user;
  $('import').hidden = !user || !localTasks().length;
  $('account-dialog').showModal();
}
$('account').onclick = () => openAccount();
$('import').onclick = async () => {
  const guest = localTasks().slice(0, 50);
  if (!guest.length || !await change(guest, [], { preserveExisting: true })) return;
  const rest = localTasks().filter((task) => !guest.some(({ id }) => id === task.id));
  try { localStorage.setItem(localKey, JSON.stringify(rest)); } catch {}
  $('account-dialog').close();
  notify('端末のタスクを取り込みました');
};
$('logout').onclick = async () => {
  if (changing) return;
  $('logout').disabled = true;
  try {
    await api('/api/logout', {});
    location.assign('/');
  } catch (error) {
    notify(error.message);
    $('logout').disabled = false;
  }
};

// Dismiss the full screen shell on the first rendered frame. D1 can finish independently.
requestAnimationFrame(() => requestAnimationFrame(() => $('launch').classList.add('leaving')));
if (tasks.length) render();
const authNotice = new URLSearchParams(location.search).get('auth');
if (authNotice) {
  history.replaceState(null, '', '/');
  if (authNotice === 'unavailable') notify('Googleログインの設定が必要です。');
  else if (authNotice === 'failed') notify('Googleログインを完了できませんでした。');
}
try {
  const session = await api('/api/session', undefined, 4000);
  connected = true;
  authAvailable = session.authAvailable;
  if (session.user) {
    user = session.user;
    tasks = session.tasks;
    $('account-label').textContent = user.name;
    $('storage-label').textContent = 'Googleアカウントに同期';
    document.querySelector('footer [data-icon]').innerHTML = icon('cloud');
    if (authNotice === 'success') notify('Googleでログインしました');
  }
} catch {
  notify('サーバーに接続できません。端末のタスクを表示しています。');
}
render();
