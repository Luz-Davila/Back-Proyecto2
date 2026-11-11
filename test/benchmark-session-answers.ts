import 'reflect-metadata';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem } from 'node:os';
import type { Socket } from 'socket.io-client';
import { Profile } from '../src/profiles/profile.entity';
import { Quiz } from '../src/quizzes/quiz.entity';
import { Question } from '../src/quizzes/question.entity';
import { Answer } from '../src/sessions/answer.entity';
import { SessionQuestion } from '../src/sessions/session-question.entity';
import { SessionParticipant } from '../src/sessions/session-participant.entity';
import { GameResult } from '../src/sessions/game-result.entity';
import type {
  AnswerReceipt,
  SessionState,
} from '../src/sessions/session.contracts';
import type { RoomEnvelope } from '../src/sessions/realtime/session-realtime.contracts';
import {
  ackData,
  createLocalGameHarness,
  localCommand,
} from './support/local-game-harness';
import type { AnswerProfileRecord } from './support/answer-profiler';
import {
  ClosedScoreVerifier,
  verifyAnswerRow,
} from './support/answer-benchmark-verifier';

const ACK_BUDGET_MS = 8000;
const interruption = new AbortController();
const configurations = [
  { name: '30x3', questions: 3, play: 3, latencyMs: 0 },
  { name: '30x30', questions: 30, play: 30, latencyMs: 0 },
  { name: '20ms', questions: 30, play: 2, latencyMs: 20 },
  { name: '50ms', questions: 30, play: 2, latencyMs: 50 },
];
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) =>
    Math.round(
      (sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0) * 100,
    ) / 100;
  return {
    count: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: percentile(1),
  };
}
function aggregate(records: AnswerProfileRecord[]) {
  return {
    operations: records.length,
    queries: records.reduce((n, r) => n + r.queries, 0),
    queriesPerOperation: stats(records.map((r) => r.queries)),
    durationMs: stats(records.map((r) => r.durationMs)),
    queueMs: stats(records.map((r) => r.queueMs)),
    sqlMs: stats(records.map((r) => r.sqlMs)),
    artificialMs: records.reduce((n, r) => n + r.artificialMs, 0),
    snapshots: records.reduce((n, r) => n + r.snapshots, 0),
    snapshotAnswerRows: records.reduce((n, r) => n + r.snapshotAnswerRows, 0),
    scoreBatches: records.reduce((n, r) => n + r.scoreBatches, 0),
    scoreRows: records.reduce((n, r) => n + r.scoreRows, 0),
    queryGroups: records.reduce<Record<string, number>>((groups, r) => {
      for (const [key, count] of Object.entries(r.groups))
        groups[key] = (groups[key] ?? 0) + count;
      return groups;
    }, {}),
  };
}

async function runCase(
  config: (typeof configurations)[number],
  repetition: number,
) {
  console.log(
    JSON.stringify({
      phase: 'start',
      ...config,
      repetition,
      players: 30,
      expectedAnswers: config.play * 30,
      ackBudgetMs: ACK_BUDGET_MS,
      windowSeconds: 30,
    }),
  );
  const harness = await createLocalGameHarness({ profile: true });
  const started = performance.now();
  const samples: Array<{
    player: number;
    question: number;
    ms: number;
    ok: boolean;
    code?: string;
  }> = [];
  const failures: string[] = [];
  const invariants = {
    choices: true,
    dates: true,
    scores: true,
    stableClosedScores: true,
    ranking: true,
    history: true,
  };
  let cleaned = false;
  let result: { status: string; [key: string]: unknown } = { status: 'ERROR' };
  try {
    await harness.start();
    const ds = harness.dataSource;
    const postgres = await ds.query<Array<{ server_version: string }>>(
      'SHOW server_version',
    );
    const host = randomUUID();
    await ds
      .getRepository(Profile)
      .save({ userId: host, displayName: 'Host benchmark local' });
    const quiz = await ds
      .getRepository(Quiz)
      .save({ ownerId: host, title: 'Benchmark respuestas local' });
    const sources: Question[] = [];
    for (let position = 0; position < config.questions; position++) {
      const variant = position % 3;
      sources.push(
        await ds.getRepository(Question).save({
          quizId: quiz.id,
          position,
          statement: `Pregunta ${position + 1}`,
          kind: variant === 0 ? 'boolean' : 'multiple',
          correctBoolean: variant === 0 && position % 2 === 0,
          options: variant === 0 ? null : ['A', 'B', 'C', 'D'],
          correctIndexes:
            variant === 0 ? null : variant === 1 ? [position % 4] : [0, 1],
        }),
      );
    }
    const room = await harness.http<SessionState>(host, 'POST', '/sessions', {
      quizId: quiz.id,
      questionDurationSeconds: 30,
      reviewDurationSeconds: 3,
    });
    const hostSocket = await harness.connect(host);
    ackData(
      await localCommand(hostSocket, 'room:subscribe', { sessionId: room.id }),
    );
    const players: string[] = Array.from({ length: 30 }, () => randomUUID());
    const sockets: Socket[] = await Promise.all(
      players.map((id) => harness.connect(id)),
    );
    await Promise.all(
      sockets.map(async (socket) =>
        ackData(await localCommand(socket, 'room:join', { code: room.code })),
      ),
    );
    const participants = await ds.getRepository(SessionParticipant).find();
    const playerByParticipant = new Map(
      participants.map((p) => [p.id, players.indexOf(p.userId)]),
    );
    const sent = new Set<string>();
    const tasks: Promise<void>[] = [];
    const receipts = new Map<string, AnswerReceipt>();
    const submittedAt = new Map<string, number>();
    const closedScores = new ClosedScoreVerifier();
    let receiptIntegrity = true;
    const choice = (player: number, position: number) =>
      sources[position].kind === 'multiple'
        ? (player + position) % 4
        : (player + position) % 2 === 0;
    let completed!: () => void;
    const completion = new Promise<void>((resolve) => {
      completed = resolve;
    });
    const envelope = (value: RoomEnvelope) => {
      if (value.sessionId !== room.id) return;
      if (value.state.status === 'FINISHED') {
        completed();
        return;
      }
      const current = value.state.currentQuestion;
      const position = value.state.currentIndex;
      if (
        !current ||
        current.status !== 'OPEN' ||
        position >= config.play ||
        sent.has(current.id)
      )
        return;
      sent.add(current.id);
      const task = (async () => {
        await Promise.all(
          sockets.map(async (socket, player) => {
            const selected = choice(player, position);
            const payload =
              typeof selected === 'boolean'
                ? { sessionQuestionId: current.id, choice: selected }
                : { sessionQuestionId: current.id, choiceIndex: selected };
            const at = performance.now();
            const sentAt = Date.now();
            submittedAt.set(`${position}:${player}`, sentAt);
            try {
              const ack = await localCommand<{ answer: AnswerReceipt }>(
                socket,
                'answer:submit',
                payload,
                ACK_BUDGET_MS,
              );
              samples.push({
                player,
                question: position,
                ms: performance.now() - at,
                ok: ack.ok,
                ...(!ack.ok ? { code: ack.error.code } : {}),
              });
              if (ack.ok) {
                receipts.set(`${position}:${player}`, ack.data.answer);
                const date = Date.parse(ack.data.answer.answeredAt);
                receiptIntegrity &&= date >= sentAt && date <= Date.now();
              }
            } catch {
              samples.push({
                player,
                question: position,
                ms: performance.now() - at,
                ok: false,
                code: 'TIMEOUT',
              });
            }
          }),
        );
        const scoredQuestions = await ds.getRepository(SessionQuestion).find();
        const answers = await ds.getRepository(Answer).find();
        invariants.stableClosedScores &&= closedScores.observe(
          scoredQuestions,
          answers,
        );
        if (position + 1 === config.play && config.play < config.questions)
          ackData(
            await localCommand(hostSocket, 'game:finish', {
              sessionId: room.id,
            }),
          );
      })();
      tasks.push(task);
      void task.catch(() => {
        failures.push(`Fallo en ronda ${position + 1}`);
        completed();
      });
    };
    for (const event of [
      'room:state',
      'question:opened',
      'question:closed',
      'game:finished',
    ])
      hostSocket.on(event, envelope);
    await harness.profile('reset', config.latencyMs);
    ackData(
      await localCommand(hostSocket, 'game:start', { sessionId: room.id }),
    );
    let wallTimer: NodeJS.Timeout | undefined;
    let onAbort = () => {};
    try {
      await Promise.race([
        completion,
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error('Ejecución interrumpida'));
          interruption.signal.addEventListener('abort', onAbort, {
            once: true,
          });
          if (interruption.signal.aborted) onAbort();
        }),
        new Promise<never>((_, reject) => {
          wallTimer = setTimeout(
            () => reject(new Error('Límite total de 6 minutos')),
            360_000,
          );
        }),
      ]);
      await Promise.all(tasks);
    } finally {
      clearTimeout(wallTimer);
      interruption.signal.removeEventListener('abort', onAbort);
    }
    const profile = await harness.profile('read');
    const answers = await ds.getRepository(Answer).find();
    const questions = await ds
      .getRepository(SessionQuestion)
      .find({ order: { position: 'ASC' } });
    const results = await ds.getRepository(GameResult).find();
    invariants.stableClosedScores &&= closedScores.observe(questions, answers);
    const correct = (player: number, position: number) => {
      const source = sources[position];
      const selected = choice(player, position);
      return typeof selected === 'boolean'
        ? source.correctBoolean === selected
        : (source.correctIndexes ?? []).includes(selected);
    };
    const totals = new Map(participants.map((p) => [p.id, 0]));
    let expectedCorrect = 0;
    for (let position = 0; position < config.play; position++) {
      const q = questions[position];
      const rows = answers.filter((a) => a.sessionQuestionId === q.id);
      const fastCorrect = rows.filter(
        (a) =>
          correct(playerByParticipant.get(a.participantId)!, position) &&
          a.answeredAt.getTime() - q.openedAt!.getTime() < 3000,
      );
      const earliest = Math.min(
        ...fastCorrect.map((a) => a.answeredAt.getTime()),
      );
      for (const answer of rows) {
        const player = playerByParticipant.get(answer.participantId)!;
        const selected = choice(player, position);
        const receipt = receipts.get(`${position}:${player}`);
        const verified = verifyAnswerRow(
          answer,
          q,
          selected,
          submittedAt.get(`${position}:${player}`) ?? Infinity,
          Date.now(),
          receipt,
        );
        invariants.choices &&= verified.choices;
        invariants.dates &&= verified.dates;
        if (verified.receiptMatches !== null)
          receiptIntegrity &&= verified.receiptMatches;
        let expected = 0;
        if (correct(player, position)) {
          expectedCorrect++;
          expected = answer.answeredAt.getTime() === earliest ? 3 : 1;
          for (
            let previous = position - 1;
            previous >= 0 && correct(player, previous);
            previous--
          )
            expected++;
        }
        invariants.scores &&= answer.score === expected;
        totals.set(
          answer.participantId,
          totals.get(answer.participantId)! + expected,
        );
      }
    }
    const distinctTotals = [...new Set(totals.values())].sort((a, b) => b - a);
    invariants.ranking =
      results.length === 30 &&
      results.every(
        (r) =>
          r.totalScore === totals.get(r.participantId) &&
          r.rank === distinctTotals.indexOf(r.totalScore) + 1,
      );
    const history = (
      await harness.http<
        Array<{
          id: string;
          correctCount: number;
          wrongCount: number;
          unansweredCount: number;
        }>
      >(host, 'GET', '/sessions/history')
    ).find((h) => h.id === room.id);
    invariants.history =
      history?.correctCount === expectedCorrect &&
      history.wrongCount === answers.length - expectedCorrect &&
      history.unansweredCount === config.questions * 30 - answers.length;
    const byPhase = Object.fromEntries(
      [...new Set(profile.records.map((r) => r.type))].map((type) => [
        type,
        aggregate(profile.records.filter((r) => r.type === type)),
      ]),
    );
    const all = aggregate(profile.records);
    const normal = profile.records.filter(
      (r) => r.type === 'answer' && r.snapshots === 0,
    );
    const integrity =
      answers.length === config.play * 30 &&
      new Set(answers.map((a) => `${a.participantId}:${a.sessionQuestionId}`))
        .size === answers.length &&
      participants.length === 30 &&
      Object.values(invariants).every(Boolean);
    const overBudget = samples.filter((s) => s.ms > ACK_BUDGET_MS).length;
    const rejected = samples.filter(
      (s) => !s.ok && s.code !== 'TIMEOUT',
    ).length;
    const timeouts = samples.filter((s) => s.code === 'TIMEOUT').length;
    const receiptCoverage = receipts.size === config.play * 30;
    const structural =
      profile.active === 0 &&
      normal.length === config.play * 29 &&
      all.queries < 10000 &&
      all.scoreBatches === config.play &&
      all.scoreRows === config.play * 30 &&
      normal.every((r) => r.queries <= 8) &&
      profile.records
        .filter((r) => r.type === 'answer')
        .reduce((n, r) => n + r.snapshots, 0) === config.play;
    result = {
      integrity,
      receiptIntegrity,
      receiptCoverage,
      invariants,
      structural,
      status:
        integrity &&
        receiptIntegrity &&
        receiptCoverage &&
        structural &&
        !overBudget &&
        !rejected &&
        !timeouts &&
        !failures.length
          ? 'PASS'
          : 'FAIL',
      ackMs: stats(samples.map((s) => s.ms)),
      overBudget,
      rejected,
      timeouts,
      participants: participants.length,
      persistedAnswers: answers.length,
      results: results.length,
      uniqueReceipts: new Set([...receipts.values()].map((r) => r.id)).size,
      peakConcurrentCommands: profile.peak,
      activeAtRead: profile.active,
      normalQueries: stats(normal.map((r) => r.queries)),
      total: all,
      byPhase,
      postgres,
      failures,
      errors: samples.filter((s) => !s.ok),
    };
  } catch (error) {
    result = {
      ...result,
      status: 'ERROR',
      partialAcks: stats(samples.map((s) => s.ms)),
      partialAccepted: samples.filter((s) => s.ok).length,
      failures: [
        ...failures,
        error instanceof Error
          ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')
          : 'Fallo no identificado',
      ],
    };
  } finally {
    try {
      await harness.close();
      cleaned = true;
    } catch {
      result.status = 'ERROR';
      result.cleanupFailure = true;
    }
  }
  return {
    ...config,
    repetition,
    ackBudgetMs: ACK_BUDGET_MS,
    players: 30,
    responseWindowSeconds: 30,
    ...result,
    cleaned,
    elapsedMs: Math.round(performance.now() - started),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const selected = args.find((a) => a.startsWith('--case='))?.slice(7) ?? 'all';
  const repetitions = Number(
    args.find((a) => a.startsWith('--repetitions='))?.split('=')[1] ?? 2,
  );
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 3)
    throw new Error('Repeticiones permitidas: 1–3');
  const cases =
    selected === 'all'
      ? configurations
      : configurations.filter((c) => c.name === selected);
  if (!cases.length)
    throw new Error('Caso inválido: all, 30x3, 30x30, 20ms o 50ms');
  const output = resolve(
    args.find((a) => a.startsWith('--output='))?.slice(9) ??
      '.tmp/session-answer-benchmark.json',
  );
  const sourceFiles = [
    'src/sessions/session-admissions.ts',
    'src/sessions/session-answers.service.ts',
    'src/sessions/session-lifecycle.service.ts',
    'src/sessions/session-coordinator.ts',
    'src/sessions/session-deadlines.service.ts',
    'src/sessions/sessions.repository.ts',
    'src/sessions/session-answer-context.ts',
    'src/sessions/session-sql.ts',
    'src/sessions/session-scoring.ts',
    'src/sessions/session.rules.ts',
    'test/support/local-game-child.ts',
    'test/support/local-game-harness.ts',
    'test/support/answer-profiler.ts',
    'test/support/answer-benchmark-verifier.ts',
    'test/benchmark-session-answers.ts',
  ];
  const sourceHash = createHash('sha256');
  for (const file of sourceFiles)
    sourceHash.update(file).update(readFileSync(file));
  const report = {
    createdAt: new Date().toISOString(),
    revision: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8',
    }).trim(),
    sourceSha256: sourceHash.digest('hex'),
    sourceFiles,
    node: process.version,
    platform: process.platform,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryGiB: Math.round(totalmem() / 1024 ** 3),
    dependencies: JSON.parse(readFileSync('package.json', 'utf8'))
      .dependencies as Record<string, string>,
    conditions:
      'Una instancia local; PostgreSQL loopback exclusivo; JWT/Storage/telemetría locales; 30 sockets reales, sin navegador ni tráfico externo. Retardo artificial por sentencia perfilada, incluidos BEGIN/COMMIT. Sin otras cargas de pruebas.',
    cases: [] as Awaited<ReturnType<typeof runCase>>[],
  };
  const interrupted = () => {
    interruption.abort();
  };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  const save = () => {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    writeFileSync(
      output.replace(/\.json$/, '') + '.md',
      '# Benchmark de respuestas\n\n' +
        `Revisión: ${report.revision}; dirty: ${report.dirty}; fuente SHA-256: ${report.sourceSha256}.\n\n${report.conditions}\n\n` +
        '| Caso | Repetición | Resultado | Respuestas | ACK p95 / máx ms | >8 s | Consultas | Lotes / filas | Limpio |\n|---|---:|---|---:|---:|---:|---:|---:|---|\n' +
        report.cases
          .map((c) => {
            const r = c as unknown as {
              status: string;
              persistedAnswers?: number;
              ackMs?: ReturnType<typeof stats>;
              overBudget?: number;
              total?: ReturnType<typeof aggregate>;
            };
            return `| ${c.name} | ${c.repetition} | ${r.status} | ${r.persistedAnswers ?? '—'} | ${r.ackMs?.p95 ?? '—'} / ${r.ackMs?.max ?? '—'} | ${r.overBudget ?? '—'} | ${r.total?.queries ?? '—'} | ${r.total?.scoreBatches ?? '—'} / ${r.total?.scoreRows ?? '—'} | ${c.cleaned} |`;
          })
          .join('\n') +
        '\n',
    );
  };
  save();
  for (const config of cases)
    for (let repetition = 1; repetition <= repetitions; repetition++) {
      if (interruption.signal.aborted) break;
      const index = report.cases.length;
      report.cases.push({
        ...config,
        repetition,
        ackBudgetMs: ACK_BUDGET_MS,
        players: 30,
        responseWindowSeconds: 30,
        status: 'RUNNING',
        cleaned: false,
        elapsedMs: 0,
      });
      save();
      const result = await runCase(config, repetition);
      report.cases[index] = result;
      save();
      console.log(JSON.stringify({ phase: 'complete', ...result }));
    }
  process.off('SIGINT', interrupted);
  process.off('SIGTERM', interrupted);
  if (report.cases.some((c) => c.status !== 'PASS')) process.exitCode = 1;
  console.log(`Evidencia: ${output}`);
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Fallo del benchmark');
  process.exitCode = 1;
});
