import { DEFER_RESULT } from ".";
import { Cascade, State, Options } from "./cascade";

export class Adapter<T = any> extends Cascade<T> {
  private managedState: (State<T> & { isValid: true; }) | { isValid: false; } = {
    isValid: false,
  };
  
  constructor(opts?: Options) {
    super(
      () => {
        if (!this.managedState.isValid)
          throw DEFER_RESULT;
        if ("error" in this.managedState)
          throw this.managedState.error;
        return this.managedState.value;
      },
      [],
      opts
    );
  }

  unset() {
    this.managedState.isValid = false;
  }

  setValue(value: T) {
    this.managedState = { value, isValid: true };
    this.refresh();
  }

  setError(error: any) {
    this.managedState = { error, isValid: true };
    this.refresh();
  }
}
