export const SESSION_ERRORS = {
  UNAUTHORIZED: { statusCode: 401, message: 'Falta un token de acceso válido' },
  VALIDATION_ERROR: {
    statusCode: 400,
    message: 'Los datos de la solicitud no son válidos',
  },
  QUIZ_NOT_FOUND: { statusCode: 404, message: 'Cuestionario no encontrado' },
  SESSION_NOT_FOUND: { statusCode: 404, message: 'Sala no encontrada' },
  HOST_REQUIRED: {
    statusCode: 403,
    message: 'Solo el host puede realizar esta acción',
  },
  HOST_CANNOT_PARTICIPATE: {
    statusCode: 403,
    message: 'El host dirige la sala y no juega en ella',
  },
  SESSION_ALREADY_STARTED: {
    statusCode: 409,
    message: 'La partida ya fue iniciada',
  },
  SESSION_FINISHED: { statusCode: 409, message: 'La partida ya finalizó' },
  INVALID_SESSION_STATE: {
    statusCode: 409,
    message: 'La acción no está permitida en el estado actual',
  },
  SESSION_HAS_NO_QUESTIONS: {
    statusCode: 409,
    message: 'Se necesita al menos una pregunta para iniciar',
  },
  SESSION_HAS_NO_PARTICIPANTS: {
    statusCode: 409,
    message: 'Se necesita al menos un participante para iniciar',
  },
  SESSION_NOT_JOINABLE: {
    statusCode: 409,
    message: 'La sala ya no acepta nuevos participantes',
  },
  SESSION_NOT_LEAVABLE: {
    statusCode: 409,
    message: 'Solo puedes abandonar una sala en espera',
  },
  ALREADY_IN_ACTIVE_SESSION: {
    statusCode: 409,
    message: 'Ya participas en otra sala activa',
  },
  QUESTION_NOT_CLOSED: {
    statusCode: 409,
    message: 'La pregunta aún está abierta',
  },
  QUESTION_NOT_OPEN: {
    statusCode: 409,
    message: 'La pregunta no está abierta para responder',
  },
  ANSWER_TOO_LATE: {
    statusCode: 409,
    message: 'El plazo para responder ya terminó',
  },
  ANSWER_ALREADY_SUBMITTED: {
    statusCode: 409,
    message: 'Ya enviaste una elección distinta para esta pregunta',
  },
  REVIEW_IN_PROGRESS: {
    statusCode: 409,
    message: 'Debes esperar a que termine la revisión',
  },
  STALE_QUESTION: { statusCode: 409, message: 'La pregunta actual ya cambió' },
  ROOM_CODE_UNAVAILABLE: {
    statusCode: 503,
    message: 'No se pudo generar un código de sala único',
  },
  INTERNAL_ERROR: { statusCode: 500, message: 'Ocurrió un error interno' },
} as const;

export type SessionErrorCode = keyof typeof SESSION_ERRORS;

/** Error de dominio: los adaptadores deciden cómo transportarlo. */
export class SessionError extends Error {
  constructor(readonly code: SessionErrorCode) {
    super(SESSION_ERRORS[code].message);
    this.name = 'SessionError';
  }
}
