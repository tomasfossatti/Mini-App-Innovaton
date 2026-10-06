/**
 * Error de negocio con mensaje apto para mostrar a la persona usuaria (español).
 * Las Server Actions lo convierten en `{ ok: false, error }`.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
