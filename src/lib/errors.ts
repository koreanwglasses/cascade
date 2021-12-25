export class CascadeError extends Error {
  name = "CascadeError";
  constructor(message: string, readonly originalError?: Error) {
    super(message);
  }
}
