export class CascadeError extends Error {
  name = "CascadeError";
  constructor(message: string, readonly error?: Error) {
    super(message);
  }
}
