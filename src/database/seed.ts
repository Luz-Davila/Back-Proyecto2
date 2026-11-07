import 'dotenv/config';
import { DataSource } from 'typeorm';
import { DEFAULT_BUCKET } from '../storage/bucket-config';
import { ensureBucket } from '../storage/ensure-bucket';
import { serviceHeaders } from '../storage/service-headers';
import { buildDatabaseOptions } from './database.options';
import { createGradientPng } from './demo-image';

const QUIZ_TITLE = 'Quiz de demostración';
const DEMO_QUESTIONS: Array<{ statement: string; correctBoolean: boolean }> = [
  { statement: 'El sol es una estrella', correctBoolean: true },
  { statement: 'Los pingüinos pueden volar', correctBoolean: false },
  { statement: 'El agua hierve a 100 °C al nivel del mar', correctBoolean: true },
  { statement: 'La luna es un planeta', correctBoolean: false },
  { statement: 'Costa Rica tiene dos costas', correctBoolean: true },
];

interface AuthUser {
  id: string;
  email: string;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;

  if (!databaseUrl || !supabaseUrl || !serviceKey || !email || !password) {
    throw new Error(
      'Faltan variables: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ' +
        'TEST_USER_EMAIL y TEST_USER_PASSWORD deben estar definidas en .env',
    );
  }

  const dataSource = new DataSource(
    buildDatabaseOptions(databaseUrl, process.env.DATABASE_SSL === 'true'),
  );
  await dataSource.initialize();

  try {
    const user = await ensureAuthUser(supabaseUrl, serviceKey, email, password);
    console.log(`Usuario de prueba: ${user.email} (${user.id})`);

    await dataSource.query(
      `INSERT INTO profiles("userId", "displayName", role) VALUES ($1, $2, 'teacher')
       ON CONFLICT ("userId") DO UPDATE SET "displayName" = EXCLUDED."displayName", role = 'teacher'`,
      [user.id, 'Profe de prueba'],
    );

    const quizId = await ensureQuiz(dataSource, user.id);
    await ensureQuestions(dataSource, quizId);
    await ensureImage(dataSource, supabaseUrl, serviceKey, bucket, quizId);
    const history = await ensureDemoHistory(dataSource, user.id, quizId);

    const summary = await dataSource.query(
      `SELECT count(*)::int AS preguntas FROM questions WHERE "quizId" = $1`,
      [quizId],
    );
    console.log(`Quiz "${QUIZ_TITLE}" listo con ${summary[0].preguntas} preguntas`);
    console.log(`Historial demo: ${history.join(', ')}`);
  } finally {
    await dataSource.destroy();
  }
}

async function ensureAuthUser(
  supabaseUrl: string,
  serviceKey: string,
  email: string,
  password: string,
): Promise<AuthUser> {
  const headers = {
    ...serviceHeaders(serviceKey),
    'Content-Type': 'application/json',
  };

  const created = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: 'Profe de prueba' },
    }),
  });

  if (created.ok) {
    return (await created.json()) as AuthUser;
  }

  const listed = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
    method: 'GET',
    headers,
  });

  if (!listed.ok) {
    throw new Error(`No se pudo crear ni buscar el usuario de prueba (${created.status})`);
  }

  const body = (await listed.json()) as { users: AuthUser[] };
  const existing = body.users.find((item) => item.email === email);
  if (!existing) {
    throw new Error(`El usuario ${email} no existe y no se pudo crear`);
  }

  return existing;
}

async function ensureQuiz(dataSource: DataSource, ownerId: string): Promise<string> {
  const existing = await dataSource.query(
    'SELECT id FROM quizzes WHERE "ownerId" = $1 AND title = $2 LIMIT 1',
    [ownerId, QUIZ_TITLE],
  );

  if (existing.length > 0) {
    return existing[0].id as string;
  }

  const created = await dataSource.query(
    'INSERT INTO quizzes("ownerId", title, description) VALUES ($1, $2, $3) RETURNING id',
    [ownerId, QUIZ_TITLE, 'Quiz preparado para la demostración en clase'],
  );

  return created[0].id as string;
}

async function ensureQuestions(dataSource: DataSource, quizId: string): Promise<void> {
  const existing = await dataSource.query(
    'SELECT count(*)::int AS total FROM questions WHERE "quizId" = $1',
    [quizId],
  );

  if (existing[0].total > 0) {
    return;
  }

  for (const [index, question] of DEMO_QUESTIONS.entries()) {
    await dataSource.query(
      `INSERT INTO questions("quizId", statement, "correctBoolean", position)
       VALUES ($1, $2, $3, $4)`,
      [quizId, question.statement, question.correctBoolean, index],
    );
  }
}

async function ensureImage(
  dataSource: DataSource,
  supabaseUrl: string,
  serviceKey: string,
  bucket: string,
  quizId: string,
): Promise<void> {
  const withImage = await dataSource.query(
    'SELECT count(*)::int AS total FROM questions WHERE "quizId" = $1 AND "imageKey" IS NOT NULL',
    [quizId],
  );

  if (withImage[0].total > 0) {
    return;
  }

  const pending = await dataSource.query(
    'SELECT id FROM questions WHERE "quizId" = $1 ORDER BY position LIMIT 1',
    [quizId],
  );

  if (pending.length === 0) {
    return;
  }

  const questionId = pending[0].id as string;
  const key = `quizzes/${quizId}/questions/${questionId}.png`;
  const png = createGradientPng(640, 360);

  if (await ensureBucket(supabaseUrl, serviceKey, bucket)) {
    console.log(`Bucket ${bucket} creado`);
  }

  const uploaded = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${key}`, {
    method: 'POST',
    headers: {
      ...serviceHeaders(serviceKey),
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: new Uint8Array(png),
  });

  if (!uploaded.ok) {
    const detail = await uploaded.text().catch(() => '');
    throw new Error(`No se pudo subir la imagen de demostración (${uploaded.status}): ${detail}`);
  }

  await dataSource.query('UPDATE questions SET "imageKey" = $1 WHERE id = $2', [key, questionId]);
  console.log('Imagen de demostración cargada en la primera pregunta');
}

const DEMO_PLAYERS = [
  { userId: 'a1e1b0c0-0001-4000-8000-000000000001', displayName: 'Valeria' },
  { userId: 'a1e1b0c0-0001-4000-8000-000000000002', displayName: 'Diego' },
  { userId: 'a1e1b0c0-0001-4000-8000-000000000003', displayName: 'Camila' },
  { userId: 'a1e1b0c0-0001-4000-8000-000000000004', displayName: 'Andrés' },
] as const;

type DemoQuestion = {
  id: string;
  statement: string;
  correctBoolean: boolean;
  position: number;
  imageKey: string | null;
};

async function ensureDemoHistory(
  dataSource: DataSource,
  hostId: string,
  quizId: string,
): Promise<string[]> {
  for (const player of DEMO_PLAYERS) {
    await dataSource.query(
      `INSERT INTO profiles("userId", "displayName") VALUES ($1, $2)
       ON CONFLICT ("userId") DO UPDATE SET "displayName" = EXCLUDED."displayName"`,
      [player.userId, player.displayName],
    );
  }

  const questions = (await dataSource.query(
    `SELECT id, statement, "correctBoolean", position, "imageKey"
     FROM questions WHERE "quizId" = $1 ORDER BY position`,
    [quizId],
  )) as DemoQuestion[];

  const [valeria, diego, camila, andres] = DEMO_PLAYERS;
  await ensureFinishedSession(dataSource, {
    code: 'PAST23',
    hostId,
    quizId,
    quizTitle: QUIZ_TITLE,
    finishedAt: new Date(Date.now() - 86_400_000),
    questions,
    players: [
      { ...valeria, choices: questions.map((q) => q.correctBoolean) },
      {
        ...diego,
        choices: questions.map((q, i) => (i % 2 === 0 ? q.correctBoolean : !q.correctBoolean)),
      },
      { ...camila, choices: questions.map((q) => !q.correctBoolean) },
    ],
  });
  await ensureFinishedSession(dataSource, {
    code: 'BEST42',
    hostId,
    quizId,
    quizTitle: QUIZ_TITLE,
    finishedAt: new Date(Date.now() - 3_600_000),
    questions: questions.slice(0, 2),
    players: [
      { ...andres, choices: questions.slice(0, 2).map((q) => q.correctBoolean) },
      {
        ...valeria,
        choices: questions.slice(0, 2).map((q, i) =>
          i === 0 ? q.correctBoolean : !q.correctBoolean,
        ),
      },
    ],
  });
  const extras = [
    { code: 'GAME42', title: 'Repaso de funciones' },
    { code: 'CUPA23', title: 'Tipos y paradigmas' },
    { code: 'FAST23', title: 'Programación lógica' },
    { code: 'WEEK23', title: 'Evaluación semanal' },
  ] as const;
  const shortQuestions = questions.slice(0, 2);
  for (const [index, extra] of extras.entries()) {
    await ensureFinishedSession(dataSource, {
      code: extra.code,
      hostId,
      quizId,
      quizTitle: extra.title,
      finishedAt: new Date(Date.now() - (index + 2) * 3_600_000),
      questions: shortQuestions,
      players: [
        { ...valeria, choices: shortQuestions.map((q) => q.correctBoolean) },
        {
          ...diego,
          choices: shortQuestions.map((q, i) => (i === 0 ? q.correctBoolean : !q.correctBoolean)),
        },
      ],
    });
  }
  return ['PAST23', 'BEST42', ...extras.map((extra) => extra.code)];
}

async function ensureFinishedSession(
  dataSource: DataSource,
  input: {
    code: string;
    hostId: string;
    quizId: string;
    quizTitle: string;
    finishedAt: Date;
    questions: DemoQuestion[];
    players: Array<{
      userId: string;
      displayName: string;
      choices: boolean[];
    }>;
  },
): Promise<void> {
  const existing = await dataSource.query(
    'SELECT id FROM game_sessions WHERE code = $1 LIMIT 1',
    [input.code],
  );
  if (existing.length > 0 || input.questions.length === 0) return;

  const startedAt = new Date(input.finishedAt.getTime() - 12 * 60_000);
  const [session] = await dataSource.query(
    `INSERT INTO game_sessions(
       code, "quizId", "hostId", "quizTitle", status,
       "questionDurationSeconds", "reviewDurationSeconds", "currentIndex",
       "startedAt", "finishedAt"
     ) VALUES ($1, $2, $3, $4, 'FINISHED', 15, 5, $5, $6, $7)
     RETURNING id`,
    [
      input.code,
      input.quizId,
      input.hostId,
      input.quizTitle,
      input.questions.length - 1,
      startedAt,
      input.finishedAt,
    ],
  );
  const sessionId = session.id as string;

  const questionIds: string[] = [];
  for (const question of input.questions) {
    const openedAt = new Date(startedAt.getTime() + question.position * 20_000);
    const closedAt = new Date(openedAt.getTime() + 15_000);
    const [row] = await dataSource.query(
      `INSERT INTO session_questions(
         "sessionId", "originalQuestionId", position, statement, "correctBoolean",
         "imageKey", status, "openedAt", "closesAt", "closedAt", "reviewEndsAt", "scoredAt"
       ) VALUES ($1, $2, $3, $4, $5, $6, 'CLOSED', $7, $8, $8, $9, $8)
       RETURNING id`,
      [
        sessionId,
        question.id,
        question.position,
        question.statement,
        question.correctBoolean,
        question.imageKey,
        openedAt,
        closedAt,
        new Date(closedAt.getTime() + 5_000),
      ],
    );
    questionIds.push(row.id as string);
  }

  const totals = new Map<string, number>();
  for (const player of input.players) {
    const [participant] = await dataSource.query(
      `INSERT INTO session_participants("sessionId", "userId", "displayName", "joinedAt")
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [sessionId, player.userId, player.displayName, startedAt],
    );
    const participantId = participant.id as string;
    let total = 0;
    for (const [index, choice] of player.choices.entries()) {
      const question = input.questions[index];
      const questionId = questionIds[index];
      if (!question || !questionId) continue;
      const score = choice === question.correctBoolean ? 3 : 0;
      total += score;
      await dataSource.query(
        `INSERT INTO answers("sessionQuestionId", "participantId", choice, "answeredAt", score)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          questionId,
          participantId,
          choice,
          new Date(startedAt.getTime() + question.position * 20_000 + 800),
          score,
        ],
      );
    }
    totals.set(participantId, total);
  }

  const ranked = [...totals.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const scores = [...new Set(ranked.map(([, score]) => score))];
  for (const [participantId, totalScore] of ranked) {
    await dataSource.query(
      `INSERT INTO game_results("sessionId", "participantId", "totalScore", rank)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, participantId, totalScore, scores.indexOf(totalScore) + 1],
    );
  }
}

main().catch((error) => {
  console.error(`Error en el seed: ${(error as Error).message}`);
  process.exit(1);
});
