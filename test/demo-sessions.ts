import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { platform, arch, release, cpus } from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Socket } from 'socket.io-client';
import { Answer } from '../src/sessions/answer.entity';
import { SessionParticipant } from '../src/sessions/session-participant.entity';
import { SessionQuestion } from '../src/sessions/session-question.entity';
import type {
  ParticipantView,
  SessionState,
} from '../src/sessions/session.contracts';
import type {
  RealtimeJoinResult,
  RoomEnvelope,
  SessionAck,
} from '../src/sessions/realtime/session-realtime.contracts';
import { SESSION_EVENTS } from '../src/sessions/realtime/session-realtime.contracts';
import {
  ackData,
  createLocalGameHarness,
  localCommand,
} from './support/local-game-harness';
import {
  evaluateLevel,
  highestPassedLevel,
  parseDemoOptions,
  percentiles,
  reportMarkdown,
  type DemoLevel,
  type DemoOptions,
} from './support/demo-report';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
async function runLevel(
  players: number,
  options: DemoOptions,
): Promise<DemoLevel> {
  const result: DemoLevel = {
    players,
    targetSockets: players + 3,
    minObservedSockets: null,
    peakObservedSockets: 0,
    durationMs: 0,
    warmupMs: 0,
    commands: 0,
    expectedRejections: 0,
    unexpectedErrors: 0,
    timeouts: 0,
    ackLatencyMs: percentiles([]),
    invariantFailures: [],
    passed: false,
    reason: 'Sin ejecutar',
  };
  const h = await createLocalGameHarness();
  const samples: number[] = [];
  let measurement = false;
  async function send<T = RoomEnvelope>(
    socket: Socket,
    event: string,
    payload: unknown,
    expected?: string,
  ): Promise<SessionAck<T>> {
    const started = performance.now();
    result.commands++;
    try {
      const ack = await localCommand<T>(
        socket,
        event,
        payload,
        options.ackTimeoutMs,
      );
      if (measurement) samples.push(performance.now() - started);
      if (expected) {
        if (ack.ok || ack.error.code !== expected)
          throw new Error('Código esperado no recibido');
        result.expectedRejections++;
      } else if (!ack.ok) throw new Error(`Ack inesperado ${ack.error.code}`);
      return ack;
    } catch (error) {
      result.unexpectedErrors++;
      if (error instanceof Error && /timed? ?out/i.test(error.message))
        result.timeouts++;
      throw error;
    }
  }
  const check = (condition: boolean, message: string) => {
    if (!condition) result.invariantFailures.push(message);
  };
  try {
    await h.start();
    const warming = performance.now();
    const rooms: Array<{
      host: Socket;
      users: string[];
      sockets: Socket[];
      participants: ParticipantView[];
      state: SessionState;
    }> = [];
    for (const [duration, review] of [
      [5, 3],
      [6, 4],
    ]) {
      const r = await h.seedRoom(duration, review, 10);
      const host = await h.connect(r.host);
      ackData(await send(host, 'room:subscribe', { sessionId: r.state.id }));
      const users = Array.from({ length: players / 2 }, () => randomUUID());
      const sockets = await Promise.all(users.map((id) => h.connect(id)));
      const participants: ParticipantView[] = [];
      for (const socket of sockets)
        participants.push(
          ackData(
            await send<RealtimeJoinResult>(socket, 'room:join', {
              code: r.state.code,
            }),
          ).participant,
        );
      const room = { ...r, host, users, sockets, participants };
      for (const socket of [host, ...sockets])
        for (const event of SESSION_EVENTS)
          socket.on(event, (envelope: RoomEnvelope) =>
            check(
              envelope.sessionId === r.state.id,
              'Broadcast cruzado entre salas',
            ),
          );
      rooms.push(room);
    }
    const [a, b] = rooms;
    const duplicate = await h.connect(a.users[0]);
    const repeated = ackData(
      await send<RealtimeJoinResult>(duplicate, 'room:join', {
        code: a.state.code,
      }),
    );
    check(
      repeated.participant.id === a.participants[0].id,
      'Participante duplicado',
    );
    const opens = await Promise.all(
      rooms.map((r) =>
        send(r.host, 'game:start', { sessionId: r.state.id }).then(ackData),
      ),
    );
    const inputA = {
      sessionQuestionId: opens[0].state.currentQuestion!.id,
      choice: true,
    };
    const inputB = {
      sessionQuestionId: opens[1].state.currentQuestion!.id,
      choice: true,
    };
    const first = await send(a.sockets[0], 'answer:submit', inputA);
    const replay = await send(duplicate, 'answer:submit', inputA);
    check(
      JSON.stringify(first) === JSON.stringify(replay),
      'Comprobante idempotente distinto',
    );
    await send(
      duplicate,
      'answer:submit',
      { ...inputA, choice: false },
      'ANSWER_ALREADY_SUBMITTED',
    );
    await send(
      a.sockets[0],
      'game:start',
      { sessionId: a.state.id },
      'HOST_REQUIRED',
    );
    await send(a.sockets[0], 'answer:submit', inputB, 'SESSION_NOT_FOUND');
    await Promise.all(
      a.sockets.slice(1, -1).map((s) => send(s, 'answer:submit', inputA)),
    );
    await Promise.all(
      b.sockets.map((s, i) =>
        send(s, 'answer:submit', { ...inputB, choice: i !== 0 }),
      ),
    );
    result.warmupMs = performance.now() - warming;
    const started = performance.now();
    measurement = true;
    while (performance.now() - started < options.seconds * 1000) {
      const observed = (await h.getMetrics()).connections;
      result.minObservedSockets = Math.min(
        result.minObservedSockets ?? observed,
        observed,
      );
      result.peakObservedSockets = Math.max(
        result.peakObservedSockets,
        observed,
      );
      await Promise.all(
        rooms.flatMap((r) =>
          r.sockets.map((s) =>
            send(s, 'room:subscribe', { sessionId: r.state.id }),
          ),
        ),
      );
      await sleep(50);
    }
    result.durationMs = performance.now() - started;
    measurement = false;
    await sleep(
      Date.parse(opens[0].state.currentQuestion!.closesAt) - Date.now() + 100,
    );
    await send(a.sockets.at(-1)!, 'answer:submit', inputA, 'ANSWER_TOO_LATE');
    a.sockets[0].disconnect();
    const reconnect = await h.connect(a.users[0]);
    const recovered = ackData(
      await send<RealtimeJoinResult>(reconnect, 'room:join', {
        code: a.state.code,
      }),
    );
    check(
      recovered.participant.id === a.participants[0].id &&
        recovered.participant.joinedAt === a.participants[0].joinedAt,
      'Reconexión creó otra identidad',
    );
    const recoveredHttp = await h.snapshot(a.users[0], a.state.code);
    check(
      JSON.stringify(recoveredHttp.scoreboard) ===
        JSON.stringify(recovered.room.scoreboard),
      'Acumulado HTTP/WS distinto',
    );
    const answers = await h.dataSource.getRepository(Answer).find();
    check(answers.length === players - 1, 'Cantidad de respuestas inesperada');
    check(
      (await h.dataSource.getRepository(SessionParticipant).count()) ===
        players,
      'Cantidad de participantes inesperada',
    );
    for (const [index, r] of rooms.entries()) {
      const q = await h.dataSource
        .getRepository(SessionQuestion)
        .findOneByOrFail({ id: opens[index].state.currentQuestion!.id });
      const accepted = answers.filter((row) => row.sessionQuestionId === q.id);
      const fast = accepted.filter(
        (row) =>
          row.choice === q.correctBoolean &&
          row.answeredAt.getTime() - q.openedAt!.getTime() < 3000,
      );
      const earliest = fast.length
        ? Math.min(...fast.map((row) => row.answeredAt.getTime()))
        : null;
      for (const answer of accepted)
        check(
          answer.score ===
            (answer.choice !== q.correctBoolean
              ? 0
              : answer.answeredAt.getTime() === earliest
                ? 3
                : 1),
          'Puntuación no cumple 0/1/3',
        );
      const finished = ackData(
        await send(r.host, 'game:finish', { sessionId: r.state.id }),
      );
      check(
        finished.state.results?.length === players / 2,
        'Resultados finales incompletos',
      );
      check(
        JSON.stringify(finished.scoreboard) ===
          JSON.stringify(finished.state.results),
        'Resultados/scoreboard finales distintos',
      );
    }
  } catch (error) {
    result.invariantFailures.push(
      error instanceof Error ? error.message : 'Fallo de ejecución',
    );
  } finally {
    try {
      await h.close();
    } catch (error) {
      result.invariantFailures.push(
        error instanceof Error
          ? error.message
          : 'No se pudo limpiar el harness local; revisar sus recursos propios',
      );
    }
  }
  result.ackLatencyMs = percentiles(samples);
  return evaluateLevel(result, options);
}

async function main(): Promise<void> {
  const options = parseDemoOptions(process.argv.slice(2));
  // Parse and bound the workload before opening any database or process.
  console.log(`Parámetros efectivos: ${JSON.stringify(options)}`);
  const levels: DemoLevel[] = [];
  for (const players of options.levels) {
    const result = await runLevel(players, options);
    levels.push(result);
    console.log(
      `Nivel ${players}: ${result.passed ? 'APROBADO' : 'FALLIDO'} — ${result.reason}`,
    );
    if (!result.passed) break;
  }
  const report = {
    date: new Date().toISOString(),
    options,
    levels,
    highestPassedLevel: highestPassedLevel(levels),
    environment: {
      node: process.version,
      platform: platform(),
      arch: arch(),
      os: release(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      revision: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      dirty: Boolean(
        execFileSync('git', ['status', '--porcelain'], {
          encoding: 'utf8',
        }).trim(),
      ),
      backend: 'one local child process per level',
      database: 'PostgreSQL local exclusive TEST_DATABASE_URL',
      auth: 'local ES256 JWT',
      storage: 'simulated',
      cpuUsage: null,
      databaseResourceUsage: null,
    },
    latencyScope:
      'client ack RTT during load window; warmup/verification excluded from percentiles',
    external: {
      physicalDevices: 'pending',
      vpsRestart: 'pending',
      grafana: 'pending',
    },
  };
  const directory = join(process.cwd(), 'reports', 'sessions');
  await mkdir(directory, { recursive: true });
  const name = `${report.date.replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
  await writeFile(
    join(directory, `${name}.json`),
    JSON.stringify(report, null, 2) + '\n',
    { flag: 'wx' },
  );
  await writeFile(join(directory, `${name}.md`), reportMarkdown(report), {
    flag: 'wx',
  });
  console.log(`Reporte: reports/sessions/${name}.{json,md}`);
  if (
    levels.length !== options.levels.length ||
    levels.some((level) => !level.passed)
  )
    process.exitCode = 1;
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Fallo de demo');
  process.exitCode = 1;
});
