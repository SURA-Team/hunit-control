/**
 * A execução precisa parar: um cliente a cancelou, o servidor está desligando, ou ela foi
 * encerrada fora do executor (ex.: cancelada direto no banco) enquanto rodava.
 */
export class StopRequestedError extends Error {
  constructor() {
    super('A execução foi interrompida.');
    this.name = 'StopRequestedError';
  }
}
