/**
 * TODO
 */
export class CascadeError extends Error {
  name = "CascadeError";

  /**
   * TODO
   * @param message 
   * @param originalError 
   */
  constructor(message: string, readonly originalError?: Error) {
    super(message);
  }
}
