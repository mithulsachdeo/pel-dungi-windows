const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const toLocalInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function defaultTime() {
  const d = new Date(Date.now() + 15 * 60 * 1000);
  d.setSeconds(0, 0);
  return toLocalInput(d);
}

function current() {
  return {
    text: $('text').value.trim() || 'Team call in 5 minutes',
    link: $('link').value.trim(),
    style: $('style').value,
  };
}

function showError(msg) { $('error').textContent = msg || ''; }

const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

async function render() {
  const res = await window.pel.list();
  if (!res) return;
  const { items, labels } = res;
  const ul = $('list');
  ul.textContent = '';
  $('empty').hidden = items.length > 0;
  for (const r of items) {
    const li = document.createElement('li');
    if (r.fired) li.className = 'past';
    const body = document.createElement('div'); body.className = 'body';
    const text = document.createElement('div'); text.className = 'text'; text.textContent = r.text;
    const tag = document.createElement('span'); tag.className = 'tag';
    tag.textContent = r.missed ? 'Missed' : r.fired ? 'Done' : 'Upcoming';
    text.appendChild(tag);
    const meta = document.createElement('div'); meta.className = 'meta';
    let host = '';
    if (r.link) { try { host = ' · ' + new URL(r.link).host; } catch (e) { host = ''; } }
    meta.textContent = `${fmt.format(new Date(r.at))} · ${labels[r.style] || r.style}${host}`;
    body.append(text, meta);
    const rm = document.createElement('button'); rm.className = 'remove'; rm.type = 'button';
    rm.title = 'Remove'; rm.setAttribute('aria-label', 'Remove reminder'); rm.textContent = '×';
    rm.onclick = async () => { await window.pel.remove(r.id); render(); };
    li.append(body, rm);
    ul.appendChild(li);
  }
}

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  showError('');
  const v = $('at').value;
  if (!v) { showError('Pick a time.'); return; }
  const at = new Date(v).getTime(); // datetime-local is parsed as local time
  const res = await window.pel.add({ ...current(), at });
  if (res && res.error) { showError(res.error); return; }
  $('text').value = ''; $('link').value = ''; $('at').value = defaultTime();
  render();
});

$('preview').addEventListener('click', async () => {
  showError('');
  const res = await window.pel.preview(current());
  if (res && res.error) showError(res.error);
});

window.pel.onChanged(render);
$('at').value = defaultTime();
render();
