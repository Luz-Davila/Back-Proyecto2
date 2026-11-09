import type { QuizChatDto } from '../dto/quiz-chat.dto';
import type { ChatResponse, QuizContext } from '../contracts/chat.contracts';

type BooleanItem = { statement: string; correctBoolean: boolean };
type MultipleItem = { statement: string; options: [string, string, string, string]; correctIndexes: number[] };
type DraftItem =
  | { statement: string; correctBoolean: boolean }
  | { statement: string; kind: 'multiple'; options: string[]; correctIndexes: number[] };

const FOTOSINTESIS: BooleanItem[] = [
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

const FOTOSINTESIS_MULTIPLE: MultipleItem[] = [
  {
    statement: '¿Dónde ocurre principalmente la fotosíntesis?',
    options: ['En las hojas', 'En las raíces', 'En el tronco', 'En las flores'],
    correctIndexes: [0],
  },
  {
    statement: '¿Qué pigmento captura la luz del Sol en las plantas?',
    options: ['Clorofila', 'Hemoglobina', 'Melanina', 'Queratina'],
    correctIndexes: [0],
  },
  {
    statement: '¿Qué gas absorben las plantas durante la fotosíntesis?',
    options: ['Dióxido de carbono', 'Nitrógeno', 'Helio', 'Ozono'],
    correctIndexes: [0],
  },
  {
    statement: '¿Qué gas liberan las plantas como producto de la fotosíntesis?',
    options: ['Oxígeno', 'Metano', 'Nitrógeno', 'Hidrógeno'],
    correctIndexes: [0],
  },
  {
    statement: '¿Qué necesitan las plantas para hacer fotosíntesis?',
    options: ['Luz, agua y dióxido de carbono', 'Solo oscuridad', 'Solo sales minerales', 'Solo viento'],
    correctIndexes: [0],
  },
  {
    statement: '¿Cuándo hacen más fotosíntesis las plantas?',
    options: ['De día, con luz', 'Solo de noche', 'Solo en invierno', 'Solo bajo tierra'],
    correctIndexes: [0],
  },
  {
    statement: '¿Quién realiza fotosíntesis?',
    options: ['Las plantas verdes', 'Los mamíferos', 'Los hongos', 'Los peces de mar profundo'],
    correctIndexes: [0],
  },
  {
    statement: '¿De qué color es la clorofila?',
    options: ['Verde', 'Rojo', 'Azul', 'Blanco'],
    correctIndexes: [0],
  },
];

const BANKS: { test: RegExp; label: string; booleanItems: BooleanItem[]; multipleItems: MultipleItem[] }[] = [
  {
    test: /fotos[ií]ntesis|clorofila|plantas verdes/i,
    label: 'fotosíntesis',
    booleanItems: FOTOSINTESIS,
    multipleItems: FOTOSINTESIS_MULTIPLE,
  },
];

function parseList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim())
    .filter((line) => line.length >= 8 && line.length <= 500);
}

function wantsMultiple(text: string) {
  return /4 opciones|cuatro opciones|opci[oó]n m[uú]ltiple|selecci[oó]n m[uú]ltiple|multiple choice|tipo test|preguntas de opciones/i.test(
    text,
  );
}

function rotateMultiple(item: MultipleItem, shift: number): MultipleItem {
  const n = item.options.length;
  const offset = ((shift % n) + n) % n;
  const options = item.options.map((_, index) => item.options[(index + offset) % n]) as MultipleItem['options'];
  const correctIndexes = item.correctIndexes
    .map((index) => (index - offset + n) % n)
    .sort((a, b) => a - b);
  return { statement: item.statement, options, correctIndexes };
}

function takeBoolean(items: BooleanItem[], count: number): DraftItem[] {
  return Array.from({ length: count }, (_, index) => {
    const item = items[index % items.length];
    if (index < items.length) return { ...item };
    return {
      statement: `${item.statement.replace(/\.$/, '')} (variante ${Math.floor(index / items.length) + 1}).`.slice(0, 500),
      correctBoolean: item.correctBoolean,
    };
  });
}

function takeMultiple(items: MultipleItem[], count: number): DraftItem[] {
  return Array.from({ length: count }, (_, index) => {
    const base = rotateMultiple(items[index % items.length], index);
    const statement =
      index < items.length
        ? base.statement
        : `${base.statement.replace(/\?$/, '')} (variante ${Math.floor(index / items.length) + 1})?`.slice(0, 500);
    return { statement, kind: 'multiple' as const, options: [...base.options], correctIndexes: base.correctIndexes };
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
  const multiple = wantsMultiple(text);

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
    const added = (multiple ? takeMultiple(bank.multipleItems, extra) : takeBoolean(bank.booleanItems, extra)).map(
      (item, index) => ({
        ...item,
        statement: `${item.statement.replace(/[.?]$/, '')} (${draft.length + index + 1})${item.statement.endsWith('?') ? '?' : '.'}`.slice(
          0,
          500,
        ),
      }),
    );
    return {
      reply: `Añadí ${extra} ${multiple ? 'preguntas de 4 opciones' : 'afirmaciones'} al borrador. Conservé tus correcciones anteriores; revísalas antes de agregarlas.`,
      draft: { questions: [...draft, ...added] },
    };
  }

  if (list.length >= 2 && !countFromText && requested === undefined) {
    return {
      reply:
        'Usé tu lista como propuesta de verdadero o falso. Marqué respuestas tentativas: confírmalas antes de agregarlas al cuestionario.',
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
        '¿Cuántas preguntas necesitas y sobre qué tema? Puedes pedir verdadero/falso o 4 opciones, o pegar una lista de afirmaciones.',
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
  const questions = multiple ? takeMultiple(bank.multipleItems, count) : takeBoolean(bank.booleanItems, count);
  return {
    reply: multiple
      ? `Preparé ${questions.length} preguntas de 4 opciones sobre ${bank.label}. Revísalas y marca las correctas antes de agregarlas al cuestionario.`
      : `Preparé ${questions.length} afirmaciones de verdadero o falso sobre ${bank.label}. Revísalas y corrige lo que haga falta antes de agregarlas al cuestionario.`,
    draft: { questions },
  };
}
