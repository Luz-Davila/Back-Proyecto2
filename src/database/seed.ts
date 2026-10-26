import 'dotenv/config';
import { DataSource } from 'typeorm';
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
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'question-images';

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
      `INSERT INTO profiles("userId", "displayName") VALUES ($1, $2)
       ON CONFLICT ("userId") DO UPDATE SET "displayName" = EXCLUDED."displayName"`,
      [user.id, 'Profe de prueba'],
    );

    const quizId = await ensureQuiz(dataSource, user.id);
    await ensureQuestions(dataSource, quizId);
    await ensureImage(dataSource, supabaseUrl, serviceKey, bucket, quizId);

    const summary = await dataSource.query(
      `SELECT count(*)::int AS preguntas FROM questions WHERE "quizId" = $1`,
      [quizId],
    );
    console.log(`Quiz "${QUIZ_TITLE}" listo con ${summary[0].preguntas} preguntas`);
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
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
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
  const pending = await dataSource.query(
    `SELECT id FROM questions WHERE "quizId" = $1 AND "imageKey" IS NULL ORDER BY position LIMIT 1`,
    [quizId],
  );

  if (pending.length === 0) {
    return;
  }

  const questionId = pending[0].id as string;
  const key = `quizzes/${quizId}/questions/${questionId}.png`;
  const png = createGradientPng(640, 360);

  const uploaded = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${key}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: new Uint8Array(png),
  });

  if (!uploaded.ok) {
    throw new Error(`No se pudo subir la imagen de demostración (${uploaded.status})`);
  }

  await dataSource.query('UPDATE questions SET "imageKey" = $1 WHERE id = $2', [key, questionId]);
  console.log('Imagen de demostración cargada en la primera pregunta');
}

main().catch((error) => {
  console.error(`Error en el seed: ${(error as Error).message}`);
  process.exit(1);
});
