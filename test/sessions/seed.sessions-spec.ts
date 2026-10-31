import { execFile } from 'child_process';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { resolve } from 'path';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { createSessionTestContext } from '../support/session-test-context';
import type { SessionTestContext } from '../support/session-test-context';

const executeFile = promisify(execFile);

describe('Regresión del seed contra PostgreSQL local y Auth/Storage simulados', () => {
  let ctx: SessionTestContext;
  let baseUrl: string;
  let userCreated = false;
  let uploaded = 0;
  const user = { id: randomUUID(), email: 'seed-local@example.test' };
  const server = createServer((req, res) => {
    req.resume();
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/auth/v1/admin/users') {
      res.statusCode = userCreated ? 422 : 201;
      userCreated = true;
      res.end(JSON.stringify(user));
    } else if (
      req.method === 'GET' &&
      req.url?.startsWith('/auth/v1/admin/users?')
    ) {
      res.end(JSON.stringify({ users: [user] }));
    } else if (
      req.method === 'GET' &&
      req.url?.startsWith('/storage/v1/bucket/')
    ) {
      res.end(JSON.stringify({ id: 'seed-test' }));
    } else if (
      req.method === 'POST' &&
      req.url?.startsWith('/storage/v1/object/')
    ) {
      uploaded += 1;
      res.end(JSON.stringify({ Key: 'seed-image' }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });

  beforeAll(async () => {
    ctx = await createSessionTestContext();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await ctx?.close();
  });

  it('ejecuta dos veces el seed real sin duplicar perfil, cuestionario, preguntas ni imagen', async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.searchParams.set('options', `-c search_path=${ctx.schema},public`);
    const env = {
      ...process.env,
      DATABASE_URL: url.toString(),
      DATABASE_SSL: process.env.TEST_DATABASE_SSL || 'false',
      SUPABASE_URL: baseUrl,
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_local_test',
      SUPABASE_STORAGE_BUCKET: 'seed-test',
      TEST_USER_EMAIL: user.email,
      TEST_USER_PASSWORD: 'Local-test-only-123',
    };
    const run = () =>
      executeFile(
        process.execPath,
        ['-r', 'ts-node/register', resolve('src/database/seed.ts')],
        { env, timeout: 45_000 },
      );
    const snapshot = () =>
      ctx.dataSource.query(`SELECT
      (SELECT count(*)::int FROM profiles) AS profiles,
      (SELECT count(*)::int FROM quizzes) AS quizzes,
      (SELECT count(*)::int FROM questions) AS questions,
      (SELECT count(*)::int FROM questions WHERE "imageKey" IS NOT NULL) AS images,
      (SELECT id FROM quizzes LIMIT 1) AS "quizId"`);
    expect((await run()).stdout).toContain('5 preguntas');
    const first = await snapshot();
    expect(first[0]).toMatchObject({
      profiles: 1,
      quizzes: 1,
      questions: 5,
      images: 1,
    });
    expect((await run()).stdout).toContain('5 preguntas');
    expect(await snapshot()).toEqual(first);
    expect(uploaded).toBe(1);
  }, 90_000);
});
