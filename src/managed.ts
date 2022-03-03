import { Cascade } from ".";

/**
 * TODO
 */
export class Managed<T = any> extends Cascade<T> {
  /**
   * TODO
   * @param initialValue 
   */
  constructor(initialValue?: T) {
    super(() => {
      throw new Error(
        "This callback should never be called. Perhaps the managed class was incorrectly extended"
      );
    });

    if (typeof initialValue !== "undefined") this.set(initialValue);
  }

  /**
   * TODO
   * @param value 
   */
  set(value: T) {
    this.report(null, value);
  }

  /**
   * TODO
   * @param error 
   */
  error(error: any) {
    this.report(error, undefined);
  }

  /**
   * TODO
   */
  async invalidate() {
    this.isValid = false;
    /* no-op */
  }
}
