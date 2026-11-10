import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Answer } from '../src/sessions/answer.entity';
import { SessionParticipant } from '../src/sessions/session-participant.entity';
import type { RealtimeJoinResult } from '../src/sessions/realtime/session-realtime.contracts';
import {
  ackData,
  createLocalGameHarness,
  localCommand,
} from './support/local-game-harness';

const PLAYERS = 40;

async function main() {
  const harness = await createLocalGameHarness();
  const started = performance.now();
  try {
    const boot = await harness.start();
    console.log(`Servidor local pid=${boot.pid} url=${boot.url}`);
    const room = await harness.seedRoom(30, 5, 2);
    const host = await harness.connect(room.host);
    ackData(await localCommand(host, 'room:subscribe', { sessionId: room.state.id }));

    const ids = Array.from({ length: PLAYERS }, () => randomUUID());
    const joinStarted = performance.now();
    const sockets = await Promise.all(ids.map((id) => harness.connect(id)));
    const joined = await Promise.all(
      sockets.map((socket) =>
        localCommand<RealtimeJoinResult>(socket, 'room:join', { code: room.state.code }).then(ackData),
      ),
    );
    const joinMs = Math.round(performance.now() - joinStarted);
    const unique = new Set(joined.map((row) => row.participant.id));
    if (unique.size !== PLAYERS) throw new Error(`Se esperaban ${PLAYERS} participantes y hay ${unique.size}`);

    const opened = ackData(await localCommand(host, 'game:start', { sessionId: room.state.id }));
    const questionId = opened.state.currentQuestion?.id;
    if (!questionId) throw new Error('La partida no abrió pregunta');

    const answerStarted = performance.now();
    const answers = await Promise.all(
      sockets.map((socket, index) =>
        localCommand(socket, 'answer:submit', {
          sessionQuestionId: questionId,
          choice: index % 2 === 0,
        }).then(ackData),
      ),
    );
    const answerMs = Math.round(performance.now() - answerStarted);
    if (answers.length !== PLAYERS) throw new Error('Faltan comprobantes de respuesta');

    const metrics = await harness.getMetrics();
    const snapshot = await harness.snapshot(ids[0], room.state.code);
    const finished = ackData(await localCommand(host, 'game:finish', { sessionId: room.state.id }));
    const storedPlayers = await harness.dataSource.getRepository(SessionParticipant).count();
    const storedAnswers = await harness.dataSource.getRepository(Answer).count();
    const stillUp = await harness.getMetrics();

    console.log(
      JSON.stringify(
        {
          players: PLAYERS,
          joinMs,
          answerMs,
          peakConnections: metrics.connections,
          connectionsAfterFinish: stillUp.connections,
          httpParticipants: snapshot.state.participants.length,
          results: finished.state.results?.length ?? 0,
          storedPlayers,
          storedAnswers,
          totalMs: Math.round(performance.now() - started),
          serverAlive: true,
        },
        null,
        2,
      ),
    );
    if (snapshot.state.participants.length !== PLAYERS) throw new Error('El estado HTTP no tiene 40 jugadores');
    if ((finished.state.results?.length ?? 0) !== PLAYERS) throw new Error('El cierre no generó 40 resultados');
    if (storedPlayers !== PLAYERS || storedAnswers !== PLAYERS) throw new Error('La base no guardó los 40');
  } finally {
    await harness.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
