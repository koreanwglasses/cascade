import { Cascade } from "..";

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
  constructor(
    readonly cascade: Cascade | null,
    message: string,
    readonly originalError?: Error
  ) {
    super(`${message}\n${cascade?.debugInfo?.trace ?? ""}`.trim());
  }
}
