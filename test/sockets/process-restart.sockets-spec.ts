import { randomUUID } from 'node:crypto';
import { Answer } from '../../src/sessions/answer.entity';
import { SessionParticipant } from '../../src/sessions/session-participant.entity';
import type { AnswerReceipt } from '../../src/sessions/session.contracts';
import type { RealtimeJoinResult } from '../../src/sessions/realtime/session-realtime.contracts';
import {
  ackData,
  createLocalGameHarness,
  localCommand,
  type LocalGameHarness,
} from '../support/local-game-harness';

describe('Reinicio de un proceso backend real con PostgreSQL persistido', () => {
  let h: LocalGameHarness;
  afterEach(async () => {
    await h?.close();
  });
  it('una caída pierde el ticket y el INSERT sin commit; retry nuevo no se retrofecha', async () => {
    h = await createLocalGameHarness({ profile: true });
    await h.start();
    const r = await h.seedRoom(120, 15);
    const host = await h.connect(r.host);
    const user = randomUUID();
    const socket = await h.connect(user);
    ackData(await localCommand(socket, 'room:join', { code: r.state.code }));
    const opened = ackData(
      await localCommand(host, 'game:start', { sessionId: r.state.id }),
    );
    const input = {
      sessionQuestionId: opened.state.currentQuestion!.id,
      choice: true,
    };
    const hold = await h.holdNextAnswer();
    const lost = localCommand(socket, 'answer:submit', input, 2000).catch(
      () => undefined,
    );
    await hold.inserted;
    // A different PostgreSQL connection cannot see the uncommitted INSERT.
    expect(await h.dataSource.getRepository(Answer).count()).toBe(0);
    await h.crash();
    await lost;
    expect(await h.dataSource.getRepository(Answer).count()).toBe(0);
    await h.start();
    const reconnected = await h.connect(user);
    ackData(
      await localCommand(reconnected, 'room:join', { code: r.state.code }),
    );
    const retriedAt = Date.now();
    const receipt = ackData(
      await localCommand<{ answer: AnswerReceipt }>(
        reconnected,
        'answer:submit',
        input,
      ),
    ).answer;
    expect(Date.parse(receipt.answeredAt)).toBeGreaterThanOrEqual(retriedAt);
    expect(await h.dataSource.getRepository(Answer).count()).toBe(1);
    expect(
      ackData(
        await localCommand<{ answer: AnswerReceipt }>(
          reconnected,
          'answer:submit',
          input,
        ),
      ).answer,
    ).toEqual(receipt);
  });
  it.each([
    { phase: 'ANSWERING', expired: false },
    { phase: 'ANSWERING', expired: true },
    { phase: 'REVIEW', expired: false },
    { phase: 'REVIEW', expired: true },
  ])(
    '$phase vencido=$expired conserva identidad, puntaje y protocolo de plazos',
    async ({ phase, expired }) => {
      h = await createLocalGameHarness();
      const first = await h.start();
      const r = await h.seedRoom(expired ? 5 : 120, expired ? 3 : 15);
      const host = await h.connect(r.host);
      const users = [randomUUID(), randomUUID()];
      const sockets = await Promise.all(users.map((id) => h.connect(id)));
      const joined = [] as RealtimeJoinResult[];
      for (const socket of sockets)
        joined.push(
          ackData(
            await localCommand<RealtimeJoinResult>(socket, 'room:join', {
              code: r.state.code,
            }),
          ),
        );
      const opened = ackData(
        await localCommand(host, 'game:start', { sessionId: r.state.id }),
      );
      const input = {
        sessionQuestionId: opened.state.currentQuestion!.id,
        choice: true,
      };
      ackData(await localCommand(sockets[0], 'answer:submit', input));
      if (phase === 'REVIEW')
        ackData(await localCommand(sockets[1], 'answer:submit', input));
      const before = await h.snapshot(users[0], r.state.code);
      const answers = await h.dataSource
        .getRepository(Answer)
        .find({ order: { id: 'ASC' } });
      const count = await h.dataSource
        .getRepository(SessionParticipant)
        .count();
      await h.stop();
      if (expired) {
        const deadline = Date.parse(
          phase === 'ANSWERING'
            ? before.state.currentQuestion!.closesAt
            : before.state.currentQuestion!.reviewEndsAt!,
        );
        await new Promise<void>((resolve) =>
          setTimeout(
            resolve,
            Math.max(
              0,
              deadline - Date.now() + (phase === 'ANSWERING' ? 3100 : 100),
            ),
          ),
        );
      }
      const second = await h.start();
      expect(second.pid).not.toBe(first.pid);
      const player = await h.connect(users[0]);
      const recovered = ackData(
        await localCommand<RealtimeJoinResult>(player, 'room:join', {
          code: r.state.code,
        }),
      );
      const snapshot = await h.snapshot(users[0], r.state.code);
      expect(recovered.participant).toEqual(joined[0].participant);
      expect(snapshot.streamId).not.toBe(before.streamId);
      expect(snapshot.scoreboard).toEqual(recovered.room.scoreboard);
      expect(await h.dataSource.getRepository(SessionParticipant).count()).toBe(
        count,
      );
      const after = await h.dataSource
        .getRepository(Answer)
        .find({ order: { id: 'ASC' } });
      expect(
        after.map(({ id, answeredAt, choice }) => ({ id, answeredAt, choice })),
      ).toEqual(
        answers.map(({ id, answeredAt, choice }) => ({
          id,
          answeredAt,
          choice,
        })),
      );
      if (!expired) {
        expect(snapshot.state.currentQuestion!.id).toBe(
          before.state.currentQuestion!.id,
        );
        expect(snapshot.state.currentQuestion!.closesAt).toBe(
          before.state.currentQuestion!.closesAt,
        );
        expect(snapshot.state.currentQuestion!.reviewEndsAt).toBe(
          before.state.currentQuestion!.reviewEndsAt,
        );
        expect(snapshot.scoreboard).toEqual(before.scoreboard);
      } else {
        expect(snapshot.state.currentIndex).toBe(1);
        expect(snapshot.state.phase).toBe('ANSWERING');
        expect(snapshot.state.currentQuestion).not.toHaveProperty(
          'correctBoolean',
        );
        expect(
          snapshot.scoreboard.find(
            (row) => row.participantId === joined[0].participant.id,
          )!.totalScore,
        ).toBe(3);
        expect(snapshot.state.currentQuestion!.id).not.toBe(
          input.sessionQuestionId,
        );
      }
      const outsider = await h.connect(randomUUID());
      expect(
        await localCommand(outsider, 'room:join', { code: r.state.code }),
      ).toMatchObject({ ok: false, error: { code: 'SESSION_NOT_JOINABLE' } });
    },
  );
});
