import { randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { io, type Socket } from 'socket.io-client';
import { Profile } from '../../src/profiles/profile.entity';
import { Quiz } from '../../src/quizzes/quiz.entity';
import { Question } from '../../src/quizzes/question.entity';
import type { SessionState } from '../../src/sessions/session.contracts';
import type {
  RoomEnvelope,
  SessionAck,
} from '../../src/sessions/realtime/session-realtime.contracts';
import type { GameMetricReader } from './game-metric-reader';
import { localGameDatabase } from './local-game-database';

export async function createLocalGameHarness() {
  const admin = localGameDatabase();
  const schema = `game_local_${randomUUID().replaceAll('-', '')}`;
  const ds = localGameDatabase(schema);
  const keys = await generateKeyPair('ES256');
  const publicKey = await exportJWK(keys.publicKey);
  let child: ChildProcess | undefined;
  let url = '';
  const sockets = new Set<Socket>();
  let closed = false;
  await admin.initialize();
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await ds.initialize();
    await ds.runMigrations();
  } catch (error) {
    try {
      if (ds.isInitialized) await ds.destroy();
      if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await admin.destroy();
    }
    throw error;
  }

  async function token(id: string) {
    return new SignJWT({ user_metadata: { display_name: 'Jugador local' } })
      .setProtectedHeader({ alg: 'ES256', kid: 'local-game' })
      .setSubject(id)
      .setIssuer('https://game.local.test/auth/v1')
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(keys.privateKey);
  }
  async function stop() {
    for (const socket of sockets) {
      socket.disconnect();
      socket.removeAllListeners();
    }
    sockets.clear();
    const processToStop = child;
    child = undefined;
    if (
      !processToStop ||
      processToStop.exitCode !== null ||
      processToStop.signalCode !== null
    )
      return;
    await new Promise<void>((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        processToStop.kill('SIGKILL');
      }, 15000);
      processToStop.once('exit', () => {
        clearTimeout(timer);
        if (timedOut)
          reject(
            new Error('Timeout al cerrar el hijo local; terminó forzadamente'),
          );
        else resolve();
      });
      if (processToStop.connected) processToStop.send({ kind: 'stop' });
      else processToStop.kill();
    });
  }
  async function close() {
    if (closed) return;
    closed = true;
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    const failures: unknown[] = [];
    try {
      await stop();
    } catch (error) {
      failures.push(error);
    }
    try {
      if (ds.isInitialized) await ds.destroy();
    } catch (error) {
      failures.push(error);
    }
    try {
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    } catch (error) {
      failures.push(error);
    }
    try {
      await admin.destroy();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length)
      throw new Error(`Revisar limpieza del esquema propio ${schema}`, {
        cause: new AggregateError(failures),
      });
  }
  const onSignal = () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  async function start() {
    if (closed || child)
      throw new Error('El harness está cerrado o ya tiene un proceso');
    const spawned = fork(join(__dirname, 'local-game-child.ts'), [], {
      execArgv: ['-r', 'ts-node/register'],
      env: {
        ...process.env,
        OTEL_EXPORTER_OTLP_ENDPOINT: '',
        LOCAL_GAME_SCHEMA: schema,
        LOCAL_GAME_JWKS: JSON.stringify({
          keys: [{ ...publicKey, kid: 'local-game', alg: 'ES256' }],
        }),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    child = spawned;
    let stderr = '';
    spawned.stdout?.resume();
    spawned.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-3000);
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error('Timeout de arranque local')),
        30000,
      );
      const exited = () =>
        finish(
          new Error(`El hijo local terminó durante el arranque: ${stderr}`),
        );
      const message = (value: unknown) => {
        if (value && typeof value === 'object' && 'kind' in value) {
          if (
            value.kind === 'ready' &&
            'url' in value &&
            typeof value.url === 'string'
          ) {
            url = value.url;
            finish();
          }
          if (value.kind === 'failure')
            finish(new Error(`Fallo de arranque local: ${stderr}`));
        }
      };
      const finish = (error?: Error) => {
        clearTimeout(timer);
        spawned.off('exit', exited);
        spawned.off('message', message);
        spawned.off('error', finish);
        if (error) reject(error);
        else resolve();
      };
      spawned.once('exit', exited);
      spawned.once('error', finish);
      spawned.on('message', message);
    });
    return { url, pid: spawned.pid! };
  }
  async function getMetrics() {
    const current = child;
    if (!current?.connected) throw new Error('El hijo local no está conectado');
    const id = randomUUID();
    return new Promise<{
      connections: number;
      points: Awaited<ReturnType<GameMetricReader['points']>>;
    }>((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error('Timeout al consultar métricas locales')),
        5000,
      );
      const message = (value: unknown) => {
        if (
          value &&
          typeof value === 'object' &&
          'id' in value &&
          value.id === id
        ) {
          if ('kind' in value && value.kind === 'metrics') {
            finish();
            resolve(
              value as unknown as {
                connections: number;
                points: Awaited<ReturnType<GameMetricReader['points']>>;
              },
            );
          } else finish(new Error('Fallo al recolectar métricas locales'));
        }
      };
      const exited = () =>
        finish(new Error('El proceso terminó antes de recolectar métricas'));
      const finish = (error?: Error) => {
        clearTimeout(timer);
        current.off('message', message);
        current.off('exit', exited);
        if (error) reject(error);
      };
      current.on('message', message);
      current.once('exit', exited);
      current.send({ kind: 'metrics', id });
    });
  }
  async function http<T>(
    id: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const result = await fetch(`${url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await token(id)}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const payload: unknown = await result.json();
    if (!result.ok)
      throw new Error(`HTTP ${result.status}: ${JSON.stringify(payload)}`);
    return payload as T;
  }
  async function connect(id: string) {
    const socket = io(`${url}/sessions`, {
      auth: { token: await token(id) },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      autoConnect: false,
    });
    sockets.add(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error('Timeout de conexión local')),
        10000,
      );
      const ready = () => finish();
      const finish = (error?: Error) => {
        clearTimeout(timer);
        socket.off('connect', ready);
        socket.off('connect_error', finish);
        if (error) reject(error);
        else resolve();
      };
      socket.once('connect', ready);
      socket.once('connect_error', finish);
      socket.connect();
    });
    return socket;
  }
  async function seedRoom(duration = 30, review = 5, questions = 3) {
    const host = randomUUID();
    await ds
      .getRepository(Profile)
      .save({ userId: host, displayName: 'Host local' });
    const quiz = await ds
      .getRepository(Quiz)
      .save({ ownerId: host, title: 'Demo local' });
    for (let position = 0; position < questions; position++)
      await ds.getRepository(Question).save({
        quizId: quiz.id,
        position,
        statement: `Pregunta ${position}`,
        correctBoolean: position % 2 === 0,
      });
    return {
      host,
      state: await http<SessionState>(host, 'POST', '/sessions', {
        quizId: quiz.id,
        questionDurationSeconds: duration,
        reviewDurationSeconds: review,
      }),
    };
  }
  return {
    dataSource: ds,
    schema,
    start,
    stop,
    close,
    token,
    connect,
    http,
    seedRoom,
    getMetrics,
    snapshot: (id: string, code: string) =>
      http<RoomEnvelope>(id, 'GET', `/sessions/${code}/state`),
  };
}
export type LocalGameHarness = Awaited<
  ReturnType<typeof createLocalGameHarness>
>;
export function localCommand<T = RoomEnvelope>(
  socket: Socket,
  event: string,
  payload: unknown,
  timeout = 10000,
): Promise<SessionAck<T>> {
  return socket.timeout(timeout).emitWithAck(event, payload) as Promise<
    SessionAck<T>
  >;
}
export function ackData<T>(ack: SessionAck<T>): T {
  if (!ack.ok) throw new Error(ack.error.code);
  return ack.data;
}
