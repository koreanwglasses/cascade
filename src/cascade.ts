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
      // Ignore the error if DEFER_RESULT is thrown
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

  static all<T extends readonly [...unknown[]]>(cascades: {
    [K in keyof T]: Cascade<T[K]>;
  }) {
    return cascades.reduce<Cascade>(
      (a, b) => a.chain((ax) => b.chain((bx) => [...ax, bx])),
      new Cascade(() => [])
    ) as Cascade<T>;
  }

  declare static Adapter: typeof Adapter;
}
