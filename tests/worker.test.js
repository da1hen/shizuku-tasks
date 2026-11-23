import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker, { parseSuggestions, validateMutation } from '../src/worker.js';

const app = 'https://tasks.example';
const cookie = (token) => `shizuku_session=${token}`;
const tokenA = 'A'.repeat(43);
const tokenB = 'B'.repeat(43);
const task = { id: 'c4f102c6-7eea-46d3-bc11-b0c40f2d5703', title: '書類を提出する', status: 'todo', createdAt: 10 };

function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  const insert = sqlite.prepare('INSERT INTO sessions (token_hash, owner, name, expires_at) VALUES (?, ?, ?, ?)');
  for (const [owner, token] of [['a', tokenA], ['b', tokenB]]) {
    insert.run(createHash('sha256').update(token).digest('base64url'), owner, owner, Date.now() + 60000);
  }
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...values) {
          return {
            first: async () => statement.get(...values) || null,
            all: async () => ({ results: statement.all(...values) }),
            run: async () => ({ meta: statement.run(...values) }),
          };
        },
      };
    },
    async batch(queries) {
      sqlite.exec('BEGIN');
      try {
        await Promise.all(queries.map((query) => query.run()));
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function request(env, route, { token, body, origin = app } = {}) {
  const headers = token ? { Cookie: cookie(token) } : {};
  if (body === undefined) return worker.fetch(new Request(app + route, { headers }), env);
  return worker.fetch(new Request(app + route, {
    method: 'POST', headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), env);
}

test('same-origin and a live account session are required for writes', async (t) => {
  const env = { DB: database(t) };
  const body = { upserts: [task], deletes: [] };
  assert.equal((await request(env, '/api/tasks', { body })).status, 401);
  assert.equal((await request(env, '/api/tasks', { token: tokenA, body, origin: 'https://other.example' })).status, 403);
  assert.equal((await request(env, '/api/tasks')).status, 405);
  assert.equal((await request(env, '/api/session', { token: 'C'.repeat(43) })).headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await (await request(env, '/api/session', { token: 'C'.repeat(43) })).json(),
    { authAvailable: false, user: null, tasks: [] });
});

test('SQL migration, account isolation, retry-safe import, deletion, and session revocation', async (t) => {
  const env = { DB: database(t) };
  const post = (token, upserts, deletes = [], preserveExisting = false) =>
    request(env, '/api/tasks', { token, body: { upserts, deletes, preserveExisting } });
  const list = async (token) => (await (await request(env, '/api/session', { token })).json()).tasks;
  assert.equal((await post(tokenA, [task])).status, 200);
  assert.deepEqual(await list(tokenA), [task]);
  assert.deepEqual(await list(tokenB), []);
  await post(tokenB, [{ ...task, title: '別のアカウント' }]);
  await post(tokenA, [{ ...task, status: 'done' }]);
  await post(tokenA, [task], [], true);
  assert.equal((await list(tokenA))[0].status, 'done');
  await post(tokenB, [], [task.id]);
  assert.equal((await list(tokenB)).length, 0);
  assert.equal((await list(tokenA)).length, 1);
  const logout = await request(env, '/api/logout', { token: tokenA, body: {} });
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0; Secure/);
  assert.equal((await post(tokenA, [task])).status, 401);
});

test('rejects malformed, oversized and duplicate task changes', () => {
  const mutation = (upserts, deletes = []) => validateMutation({ upserts, deletes });
  assert.equal(mutation([task]), true);
  assert.equal(mutation([{ ...task, title: ' '.repeat(600) }]), false);
  assert.equal(mutation([{ ...task, title: 'x'.repeat(601) }]), false);
  assert.equal(mutation([{ ...task, status: 'archived' }]), false);
  assert.equal(mutation([task, task]), false);
  assert.equal(mutation([task], [task.id]), false);
  assert.equal(mutation([], Array(51).fill(task.id)), false);
});

test('Google is the only login provider and state plus PKCE are sent', async (t) => {
  const env = { DB: database(t), GOOGLE_CLIENT_ID: 'fixture', GOOGLE_CLIENT_SECRET: 'fixture' };
  const response = await request(env, '/auth/google');
  const url = new URL(response.headers.get('Location'));
  const saved = response.headers.get('Set-Cookie');
  assert.equal(response.status, 303);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('redirect_uri'), app + '/auth/google/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('code_challenge'), /^[\w-]{43}$/);
  assert.match(saved, /HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  assert.equal((await request(env, '/auth/google/callback?code=test&state=bad')).headers.get('Location'), '/?auth=failed');
  assert.equal((await request({}, '/auth/google')).headers.get('Location'), '/?auth=unavailable');
});

test('AI split validates the response, rate-limits per account and rejects anonymous usage', async (t) => {
  const env = { DB: database(t), AI: { async run(model, input) {
    assert.equal(model, '@cf/meta/llama-3.1-8b-instruct-fast');
    assert.equal(input.messages[1].content, '買い物して片付ける');
    assert.equal(input.response_format.type, 'json_schema');
    return { response: '{"tasks":["買い物に行く","片付ける","片付ける"]}' };
  } } };
  const body = { memo: '買い物して片付ける' };
  const split = (token) => request(env, '/api/ai/split', { token, body });
  assert.equal((await split()).status, 401);
  assert.deepEqual(await (await split(tokenA)).json(), { suggestions: ['買い物に行く', '片付ける'] });
  assert.equal((await split(tokenA)).status, 429);
  assert.equal((await split(tokenB)).status, 200);
  assert.deepEqual(parseSuggestions({ response: 'invalid' }), []);
  assert.deepEqual(parseSuggestions({ response: { tasks: ['', 5, '準備'] } }), ['準備']);
});
