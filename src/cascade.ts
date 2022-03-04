import { DEFER_RESULT } from ".";
import { Adapter } from "./adapter";
import { hash } from "./lib/hash";
import { ListenerControls, ListenerManager } from "./lib/listener-manager";
import "setimmediate";

export type Resolvable<T> = Promise<Cascade<T>> | Promise<T> | Cascade<T> | T;

export type Options = {
  onDetach?(): void;
  _debug_logListenerCount?: boolean | string;
  _debug_logChange?: boolean | string;
};

export type State<T> = { value: T } | { error: any };

export class Cascade<T = any> {
  constructor(
    private func: () => Resolvable<T>,
    private deps: Cascade[] = [],
    readonly options: Options = {}
  ) {
    this.attach();
  }

  // Hook listeners and do an initial refresh
  private dependencyHandles?: ListenerControls[];
  private listenerRemovedHandle?: ListenerControls;
  private isAttached = false;
  private attach() {
    if (this.isClosed) throw new Error("Cannot attach closed Cascade");

    if (!this.dependencyHandles) {
      this.dependencyHandles = this.deps.map((dep) =>
        dep.onChange(() => this.refresh())
      );
    }
    if (!this.listenerRemovedHandle) {
      this.listenerRemovedHandle = this.listeners.onListenerRemove(() => {
        this._debug_logListenerCount();
        // Detach if nothing is listening to this Cascade
        if (this.listeners.size === 0) this.detach();
      });
    }
    if (!this.state.isValid) this.refresh();

    this.isAttached = true;
  }

  // Detach all listeners, allowing this Cascade to be GC'ed
  // if neccessary
  private detach() {
    if (!this.isAttached) return;

    this.state.isValid = false;

    this.dependencyHandles?.forEach((handle) => handle.detach());
    this.dependencyHandles = undefined;

    this.listenerRemovedHandle?.detach();
    this.listenerRemovedHandle = undefined;

    this.mirrorSourceHandle?.detach();
    this.mirrorSourceHandle = undefined;

    this.isAttached = false;

    this.options.onDetach?.();
  }

  // Close cascade and prevent any further use
  // Used to mark permanently invalid Cascades
  // e.g. after a cleanup routine in onDetach
  private isClosed = false;
  close() {
    if (this.isClosed) return;

    this.detach();

    this.setState({
      error: new Error("Cascade closed"),
    });

    this.isClosed = true;
  }


  private state: ((State<T> & { isValid: true }) | { isValid: false }) & {
    hash?: string;
  } = { isValid: false };
  /**
   * @param _hash Used when forwarding state from another Cascade and
   * the hash is already computed
   */
  private setState(_state: State<T>, _hash?: string) {
    if (this.isClosed) throw new Error("Cannot set state on closed Cascade");

    const state =
      "error" in _state ? { error: _state.error } : { value: _state.value };

    const prevHash = this.state.hash;
    const newHash = _hash ?? hash(state);

    this.state = {
      ...state,
      isValid: true,
      hash: newHash,
    };

    if (newHash !== prevHash) {
      this._debug_logChange();
      this.listeners.notify(state, newHash);
    }
  }

  // Ensure that multiple refreshes while the
  // function is pending a resolve or reject
  // dont cause multiple evaluations
  private isPending = false;
  private async eval() {
    if (this.isPending)
      throw new Error("Cannot eval while previous eval is pending");
    this.isPending = true;

    let result: { err: any } | { res: Awaited<T> | Cascade<T> };
    try {
      result = { res: await this.func() };
    } catch (err) {
      result = { err };
    }

    this.isPending = false;
    return result;
  }

  private mirrorSourceHandle?: ListenerControls;
  refresh() {
    if (this.isClosed) throw new Error("Cannot refresh closed Cascade");

    // Ignore any requests to refresh while a refresh is pending
    if (this.isPending) {
      console.warn(
        "Call to refresh() ignored while another refresh is pending"
      );

      // Return false to indicate that refresh request failed
      return false;
    }

    // Mark state as invalid
    this.state.isValid = false;

    // Pause listening for changes on a mirror source Cascade, if exists
    this.mirrorSourceHandle?.pause();

    // Recompute state on next event cycle
    // This ensures that everything is initialized before
    // doing the first eval
    setImmediate(async () => {
      const result = await this.eval();
      if ("err" in result) {
        // If DEFER_RESULT was thrown, ignore the response
        if (result.err !== DEFER_RESULT) this.setState({ error: result.err });
        return;
      }
      const res = result.res;

      // Detach listener after new listener is attached
      const oldHandle = this.mirrorSourceHandle;

      // Update state
      if (res instanceof Cascade) {
        // If res is a Cascade, mirror its state
        // (Note: the Cascade is mirrored rather than referenced so that
        // this Cascade can independently listen for changes to state)
        if (res.state.isValid) this.setState(res.state, res.state.hash);
        this.mirrorSourceHandle = res.onChange((state, hash) =>
          this.setState(state, hash)
        );
      } else {
        this.setState({ value: res });
      }

      oldHandle?.detach();
    });

    // Return true to indicate that refresh request succeeded
    return true;
  }

  private listeners = new ListenerManager<[State<T>, string?]>();
  private onChange(cb: (state: State<T>, hash?: string) => void) {
    if (this.isClosed) throw new Error("Cannot add listener to closed Cascade");

    // Reopen automatically when a new listener is added
    if (!this.isAttached) this.attach();

    const retval = this.listeners.addListener(cb);
    this._debug_logListenerCount();
    return retval;
  }

  private _debug_logChange() {
    if (this.options._debug_logChange) {
      console.log(
        `${
          typeof this.options._debug_logChange === "string"
            ? this.options._debug_logChange
            : ""
        }${JSON.stringify(this.state)}`
      );
    }
  }

  private _debug_logListenerCount() {
    if (this.options._debug_logListenerCount) {
      console.log(
        `${
          typeof this.options._debug_logListenerCount === "string"
            ? this.options._debug_logListenerCount
            : ""
        }${this.listeners.size}`
      );
    }
  }

  chain<S>(func: (value: T) => Resolvable<S>, opts?: Options): Cascade<S> {
    if (this.isClosed) throw new Error("Cannot chain from closed Cascade");

    return new Cascade(
      () => {
        if (!this.state.isValid) throw DEFER_RESULT;
        if ("error" in this.state) throw this.state.error;
        return func(this.state.value);
      },
      [this],
      opts
    );
  }

  catch(handler: (error: any) => T): Cascade<T> {
    if (this.isClosed) throw new Error("Cannot catch from closed Cascade");

    return new Cascade(() => {
      if (!this.state.isValid) throw DEFER_RESULT;
      if ("error" in this.state) return handler(this.state.error);
      return this.state.value;
    }, [this]);
  }

  // Return a promise that returns the current value or
  // the next available value.
  toPromise(): Promise<T> {
    if (this.isClosed)
      throw new Error("Cannot convert closed Cascade to promise");

    return new Promise((res, rej) => {
      if (!this.state.isValid) {
        const handle = this.onChange((state) => {
          if ("error" in state) rej(state.error);
          else res(state.value);
          handle.detach();
        });
      } else if ("error" in this.state) rej(this.state.error);
      else res(this.state.value);
    });
  }

  // Skip refreshing on incremental changes in value
  // that are unlikely to affect later computations
  /** @experimental */
  _exp_filter(cb: (value: T, prevValue: T) => boolean) {
    let first = true;
    let prevValue: T;
    return this.chain((value) => {
      if (first || cb(value, prevValue)) {
        first = false;
        prevValue = value;
        return value;
      } else {
        throw DEFER_RESULT;
      }
    });
  }

  // Limit the rate at which changes in value are reported
  /** @experimental */
  _exp_throttle(delay: number) {
    let lastReport = 0;
    let timeout: any;
    const cascade = this._exp_filter(() => {
      clearTimeout(timeout);
      const t = +new Date();
      if (t - lastReport >= delay) {
        lastReport = t;
        return true;
      } else {
        timeout = setTimeout(() => cascade.refresh(), delay - (t - lastReport));
        return false;
      }
    });
    cascade.options.onDetach = () => clearTimeout(timeout);
    return cascade;
  }

  // Recursively make Cascade and its properties
  // into a single Cascade
  /** @experimental */
  _exp_deep() {
    const flatten = (value: unknown): Cascade<unknown> => {
      if (value instanceof Cascade) {
        return value.chain(flatten);
      } else if (
        value &&
        (typeof value === "object" || typeof value === "function")
      ) {
        return Cascade.all(Object.values(value))
          .chain((values) => Cascade.all(values.map(flatten)))
          .chain((values) =>
            Object.fromEntries(
              Object.keys(value).map((key, i) => [key, values[i]])
            )
          ) as Cascade<unknown>;
      } else {
        return new Cascade(() => value);
      }
    };

    type Deep<T> = T extends Promise<infer S>
      ? Deep<S>
      : T extends Cascade<infer S>
      ? Deep<S>
      : T extends null | undefined | number | string | Symbol | boolean
      ? T
      : { [K in keyof T]: Deep<T[K]> };

    return flatten(this) as Cascade<Deep<T>>;
  }

  static resolve<T>(value: Resolvable<T>) {
    return new Cascade(() => value);
  }

  static all<T extends readonly [...unknown[]]>(values: {
    [K in keyof T]: Resolvable<T[K]>;
  }) {
    const resolved = values.map(Cascade.resolve);
    return new Cascade(() => {
      // Defer if any are not yet valid
      const invalid = resolved.find((cascade) => !cascade.state.isValid);
      if (invalid) throw DEFER_RESULT;

      // Throw an error if any of them have errored
      const rejected = resolved.find((cascade) => "error" in cascade.state);
      if (rejected) {
        if (!("error" in rejected.state))
          throw new Error("Unexpected condition");
        throw rejected.state.error;
      }

      // Return list of all computed values
      return resolved.map((cascade) => {
        if (!("value" in cascade.state))
          throw new Error("Unexpected condition");
        return cascade.state.value;
      }) as unknown as readonly [...T];
    }, resolved);
  }

  protected toJSON() {
    return { ...this.state, hash: undefined };
  }

  declare static Adapter: typeof Adapter;
}
