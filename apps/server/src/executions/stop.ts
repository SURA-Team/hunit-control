/**
 * A execução precisa parar: o servidor está desligando, ou ela foi encerrada por outro caminho
 * (ex.: cancelada) enquanto rodava.
 */
export class StopRequestedError extends Error {
  constructor() {
    super('A execução foi interrompida.');
    this.name = 'StopRequestedError';
  }
}
