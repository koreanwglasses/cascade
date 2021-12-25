import { Cascade } from ".";

export class Managed<T = any> extends Cascade<T> {
  constructor(initialValue?: T) {
    super(() => {
      throw new Error(
        "This callback should never be called. Perhaps the managed class was incorrectly extended"
      );
    });

    if (typeof initialValue !== "undefined") this.value(initialValue);
  }

  value(value: T) {
    this.report(null, value);
  }

  error(error: any) {
    this.report(error, undefined);
  }

  async invalidate() {
    this.isValid = false;
    /* no-op */
  }
}
