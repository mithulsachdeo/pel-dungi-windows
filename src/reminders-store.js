// Reminders persisted as JSON. Mirrors the Mac app's store: save, remove, mark fired, first due.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STYLES = ['meeting', 'balloon', 'motivation', 'scold'];

// A reminder missed by more than this (e.g. the PC was off) is marked missed instead of
// popping up long after the fact.
const MISSED_GRACE_MS = 10 * 60 * 1000;

class ReminderStore {
  constructor(file) {
    this.file = file;
    this.items = [];
    this.load();
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.items = Array.isArray(data) ? data.filter(r => r && r.id && typeof r.at === 'number') : [];
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('[store] could not read', this.file, e.message);
      this.items = [];
    }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    // write-then-rename so a crash mid-write cannot leave a truncated file
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.items, null, 2));
    fs.renameSync(tmp, this.file);
  }

  list() {
    return [...this.items].sort((a, b) => a.at - b.at);
  }

  save({ text, link, style, at }) {
    const r = {
      id: crypto.randomUUID(),
      text: String(text || '').trim() || 'Team call in 5 minutes',
      link: link || '',
      style: STYLES.includes(style) ? style : 'meeting',
      at,
      fired: false,
      createdAt: Date.now(),
    };
    this.items.push(r);
    this.persist();
    return r;
  }

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter(r => r.id !== id);
    if (this.items.length !== before) this.persist();
  }

  markFired(id, missed = false) {
    const r = this.items.find(x => x.id === id);
    if (!r) return;
    r.fired = true;
    r.firedAt = Date.now();
    if (missed) r.missed = true;
    this.persist();
  }

  // Earliest unfired reminder whose time has come. Long-overdue ones are marked missed.
  firstDue(now = Date.now()) {
    let changed = false;
    let due = null;
    for (const r of this.list()) {
      if (r.fired || r.at > now) continue;
      if (now - r.at > MISSED_GRACE_MS) {
        r.fired = true; r.missed = true; r.firedAt = now; changed = true;
        continue;
      }
      if (!due) due = r;
    }
    if (changed) this.persist();
    return due;
  }
}

module.exports = { ReminderStore, STYLES, MISSED_GRACE_MS };
