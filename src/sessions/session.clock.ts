/** Token de inyección y contrato del reloj autoritativo del servidor. */
export abstract class SessionClock {
  abstract now(): Date;
}

export class SystemSessionClock extends SessionClock {
  now(): Date {
    return new Date();
  }
}
