import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import worker from '../src/worker.js';
import { calendarHTML } from '../src/cloud-image.js';

const env = {
  DISCORD_GUILD_ID: '100000000000000001', DISCORD_CHANNEL_ID: '100000000000000002',
};
const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
env.DISCORD_PUBLIC_KEY = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey)).toString('hex');
const ctx = { waitUntil: () => {} };

async function invoke(data, signed = true) {
  const body = JSON.stringify(data);
  const time = String(Math.floor(Date.now() / 1000));
  const raw = await crypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(time + body));
  const signature = Buffer.from(raw).toString('hex');
  return worker.fetch(new Request('https://calendar.example/interactions', {
    method: 'POST', body, headers: {
      'x-signature-timestamp': time, 'x-signature-ed25519': signed ? signature : '0'.repeat(128),
    },
  }), env, ctx);
}

test('Worker answers a valid Discord PING and rejects a bad signature', async () => {
  assert.deepEqual(await (await invoke({ type: 1 })).json(), { type: 1 });
  assert.equal((await invoke({ type: 1 }, false)).status, 401);
});

test('Worker permits date form only in the intended guild and channel', async () => {
  const request = {
    type: 3, guild_id: env.DISCORD_GUILD_ID, channel_id: env.DISCORD_CHANNEL_ID,
    data: { custom_id: 'wcal:add:2026-11-20' },
    member: { user: { id: '42' }, permissions: '0' },
  };
  const { type, data } = await (await invoke(request)).json();
  assert.equal(type, 9);
  assert.equal(data.custom_id, 'wcal:save-new:2026-11-20');
  const elsewhere = await (await invoke({ ...request, channel_id: 'other' })).json();
  assert.equal(elsewhere.type, 4);
  assert.equal(elsewhere.data.flags, 64);
});

test('Cloud renderer escapes Discord input and DB revisions move with edits', () => {
  const title = '<img src=x onerror=alert(1)>';
  const image = { kind: 'month', month: '2026-11', currentDay: '2026-11-17',
    events: [{ title, date: '2026-11-20', status: 'active' }] };
  const html = calendarHTML(image, { month: 'data:image/webp;base64,AAAA' });
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes(title));
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(new URL('../migrations/0001_calendar.sql', import.meta.url), 'utf8'));
    db.prepare(`
      INSERT INTO events(date,title,location,notes,owner,created_interaction) VALUES (?, ?, '', '', 'member', 'click')
    `).run('2026-11-20', title);
    db.exec("UPDATE events SET status = 'cancelled' WHERE id = 1");
    assert.equal(db.prepare('SELECT revision FROM board WHERE id = 1').get().revision, 3);
  } finally {
    db.close();
  }
});
