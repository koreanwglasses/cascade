import { DEFER_RESULT } from ".";
import { Adapter } from "./adapter";
import { hash } from "./lib/hash";
import { ListenerControls, ListenerManager } from "./lib/listener-manager";

export type Resolvable<T> = Promise<Cascade<T>> | Promise<T> | Cascade<T> | T;

export type Options = {
  onDetach?(): void;
  _debug_logListenerCount?: boolean | string;
  _debug_logChange?: boolean | string;
};

export type State<T> = { value: T } | { error: any };

export class Cascade<T = any> {
  private state: ((State<T> & { isValid: true }) | { isValid: false }) & {
    hash?: string;
  } = { isValid: false };

  constructor(
    private func: () => Resolvable<T>,
    private deps: Cascade[] = [],
    readonly options: Options = {}
  ) {
    this.attach();
  }

  private dependencyHandles?: ListenerControls[];
  private isAttached = false;
  // Hook listeners and do an initial refresh
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

  private mirrorSourceHandle?: ListenerControls;
  async refresh() {
    if (this.isClosed) throw new Error("Cannot refresh closed Cascade");

    // Mark state as invalid
    this.state.isValid = false;

    // Pause listening for changes on a mirror source Cascade, if exists
    this.mirrorSourceHandle?.pause();

    // Recompute state
    let res: Resolvable<T>;
    try {
      res = await this.func();
    } catch (error) {
      // Throw DEFER_RESULT to ignore a refresh
      if (error !== DEFER_RESULT) this.setState({ error });
      return;
    }

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
  }

  private listeners = new ListenerManager<[State<T>, string?]>();
  private listenerRemovedHandle?: ListenerControls;
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

  catch<S>(
    func: (error: any) => Resolvable<S | undefined>,
    opts?: Options
  ): Cascade<S | undefined> {
    if (this.isClosed) throw new Error("Cannot catch from closed Cascade");

    return new Cascade(
      () => {
        if (!this.state.isValid) throw DEFER_RESULT;
        if ("error" in this.state) return func(this.state.error);
      },
      [this],
      opts
    );
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
      if (value instanceof Promise) {
        return flatten(new Cascade(() => value));
      } else if (value instanceof Cascade) {
        return value.chain(flatten);
      } else if (
        value &&
        (typeof value === "object" || typeof value === "function")
      ) {
        return Cascade.all(Object.values(value).map(flatten)).chain((values) =>
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

  static all<T extends readonly [...unknown[]]>(cascades: {
    [K in keyof T]: Cascade<T[K]>;
  }) {
    return new Cascade(() => {
      // Defer if any are not yet valid
      const invalid = cascades.find((cascade) => !cascade.state.isValid);
      if (invalid) throw DEFER_RESULT;

      // Throw an error if any of them have errored
      const rejected = cascades.find((cascade) => "error" in cascade.state);
      if (rejected) {
        if (!("error" in rejected.state))
          throw new Error("Unexpected condition");
        throw rejected.state.error;
      }

      // Return list of all computed values
      return cascades.map((cascade) => {
        if (!("value" in cascade.state))
          throw new Error("Unexpected condition");
        return cascade.state.value;
      }) as unknown as readonly [...T];
    }, [...cascades]);
  }

  toJSON() {
    return { ...this.state, hash: undefined };
  }

  declare static Adapter: typeof Adapter;
}
