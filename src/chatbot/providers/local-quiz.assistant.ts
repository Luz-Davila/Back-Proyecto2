import type { QuizChatDto } from '../dto/quiz-chat.dto';
import type { ChatResponse, QuizContext } from '../contracts/chat.contracts';

type Item = { statement: string; correctBoolean: boolean };

const FOTOSINTESIS: Item[] = [
  { statement: 'Las plantas fabrican su propio alimento mediante la fotosíntesis.', correctBoolean: true },
  { statement: 'La fotosíntesis ocurre principalmente en las hojas.', correctBoolean: true },
  { statement: 'Las plantas necesitan luz solar para realizar la fotosíntesis.', correctBoolean: true },
  { statement: 'Durante la fotosíntesis, las plantas absorben dióxido de carbono del aire.', correctBoolean: true },
  { statement: 'La clorofila es el pigmento verde que captura la luz del Sol.', correctBoolean: true },
  { statement: 'Un producto de la fotosíntesis es el oxígeno.', correctBoolean: true },
  { statement: 'Las plantas también necesitan agua para hacer fotosíntesis.', correctBoolean: true },
  { statement: 'La fotosíntesis convierte la energía de la luz en energía química.', correctBoolean: true },
  { statement: 'Las plantas hacen fotosíntesis sobre todo de noche.', correctBoolean: false },
  { statement: 'La fotosíntesis ocurre en las raíces, no en las hojas.', correctBoolean: false },
  { statement: 'Las plantas no necesitan luz para fabricar su alimento.', correctBoolean: false },
  { statement: 'Los animales realizan fotosíntesis igual que las plantas.', correctBoolean: false },
  { statement: 'La clorofila es de color rojo.', correctBoolean: false },
  { statement: 'El oxígeno que respiramos no tiene relación con las plantas.', correctBoolean: false },
  { statement: 'Las plantas solo toman oxígeno y nunca lo producen.', correctBoolean: false },
  { statement: 'La fotosíntesis ocurre únicamente en el tronco de los árboles.', correctBoolean: false },
];

const BANKS: { test: RegExp; label: string; items: Item[] }[] = [
  { test: /fotos[ií]ntesis|clorofila|plantas verdes/i, label: 'fotosíntesis', items: FOTOSINTESIS },
];

function parseList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim())
    .filter((line) => line.length >= 8 && line.length <= 500);
}

function take(items: Item[], count: number): Item[] {
  return Array.from({ length: count }, (_, index) => {
    const item = items[index % items.length];
    if (index < items.length) return { ...item };
    return {
      statement: `${item.statement.replace(/\.$/, '')} (variante ${Math.floor(index / items.length) + 1}).`.slice(0, 500),
      correctBoolean: item.correctBoolean,
    };
  });
}

export function localQuizRespond(
  request: QuizChatDto,
  _context: QuizContext,
): ChatResponse {
  const text = request.messages.at(-1)?.content.trim() ?? '';
  const list = parseList(text);
  const countFromText = Number(text.match(/\b(\d+)\s+preguntas?\b/i)?.[1] ?? 0);
  const extra = Number(
    text.match(
      /(?:agrega(?:r)?|añade|añadir|incluye|incluir|suma)\s+(\d+)/i,
    )?.[1] ?? 0,
  );
  const requested = request.requestedCount;
  const draft = request.currentDraft?.questions ?? [];

  if (draft.length && extra && requested === undefined) {
    if (draft.length + extra > 30) {
      return {
        reply:
          'La propuesta completa superaría 30 preguntas. Indica cuáles quieres conservar antes de ampliarla.',
        draft: null,
      };
    }
    const bank = BANKS.find((item) => item.test.test(text));
    if (!bank) {
      return {
        reply:
          'Para ampliar el borrador indica el tema (por ejemplo fotosíntesis) o pega las afirmaciones nuevas.',
        draft: null,
      };
    }
    const added = take(bank.items, extra).map((item, index) => ({
      statement: `${item.statement.replace(/\.$/, '')} (${draft.length + index + 1}).`.slice(0, 500),
      correctBoolean: item.correctBoolean,
    }));
    return {
      reply: `Añadí ${extra} afirmaciones al borrador. Conservé tus correcciones anteriores; revísalas antes de agregarlas.`,
      draft: { questions: [...draft, ...added] },
    };
  }

  if (list.length >= 2 && !countFromText && requested === undefined) {
    return {
      reply:
        'Usé tu lista como propuesta. Marqué respuestas tentativas: confírmalas antes de agregarlas al cuestionario.',
      draft: {
        questions: list.slice(0, 30).map((statement, index) => ({
          statement,
          correctBoolean: index % 2 === 0,
        })),
      },
    };
  }

  const count = requested ?? countFromText;
  if (count > 30) {
    return {
      reply: 'Puedes preparar hasta 30 preguntas por propuesta. ¿Cuántas necesitas?',
      draft: null,
    };
  }
  if (!count) {
    return {
      reply:
        '¿Cuántas preguntas necesitas y sobre qué tema? También puedes pegar una lista de afirmaciones.',
      draft: null,
    };
  }

  const bank = BANKS.find((item) => item.test.test(text));
  if (!bank) {
    return {
      reply:
        'Indica un tema que pueda preparar (por ejemplo fotosíntesis) o pega una lista de afirmaciones. Si configuras DeepSeek, el asistente cubre cualquier tema.',
      draft: null,
    };
  }
  const questions = take(bank.items, count);
  return {
    reply: `Preparé ${questions.length} afirmaciones de verdadero o falso sobre ${bank.label}. Revísalas y corrige lo que haga falta antes de agregarlas al cuestionario.`,
    draft: { questions },
  };
}
