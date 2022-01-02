import {
  Compute,
  CloseOpts,
  CascadeOpts,
  Unwrapped,
  AllUnwrapped,
  CascadeError,
} from ".";
import {
  Listener,
  ListenerHandle,
  ListenerManager,
} from "./lib/listener-manager";
import { DEFER_RESULT } from "./lib/consts";
import { DebugInfo, isDebuggingEnabled } from "./lib/debug";
import objectHash from "object-hash";

/**
 * TODO
 */
export class Cascade<T = any> {
  /** @internal */
  debugInfo = isDebuggingEnabled ? new DebugInfo() : undefined;

  ///////////////
  // LISTENERS //
  ///////////////

  // Manage listeners from Cascades that depend on `this`

  private listenerManager = new ListenerManager<[], [opts?: CloseOpts]>();
  private attachedListenerCount = 0;

  private listen(
    listener: Listener,
    { detached = false }: { detached?: boolean } = {}
  ) {
    if (this.isClosed)
      throw new CascadeError(
        this,
        "Attempted to add listener to closed cascade"
      );

    if (!detached) this.attachedListenerCount++;

    return this.listenerManager.addListener(
      listener,
      ({ keepAlive = false } = {}) => {
        if (!detached) this.attachedListenerCount--;
        if (
          this.opts.autoclose &&
          !keepAlive &&
          this.attachedListenerCount <= 0
        )
          this.close();
      }
    );
  }

  ///////////////
  // REPORTING //
  ///////////////

  // Handle reporting new values/errors and notifying listeners

  protected isValid = false;
  private curValue?: T;
  private curError?: any;

  private prevHash?: { value: any; error: any };

  protected report(error: any, value?: T) {
    this.curError = error;
    this.curValue = value;
    this.isValid = true;

    if (this.opts.notify === "never") return;
    if (this.opts.notify === "always") return this.listenerManager.notify();
    // this.opts.notify === "auto"

    // Notify dependents on change
    let errorHash: any;
    let valueHash: any;
    try {
      errorHash = this.hash(error);
      valueHash = this.hash(value);
    } catch (e) {
      // If value could not be hashed, we'll just forward
      // any updates allowing downstream cascades to
      // check for changes
      return this.listenerManager.notify();
    }

    const shouldNotify =
      !this.prevHash ||
      (error
        ? this.prevHash.error !== errorHash
        : this.prevHash.value !== valueHash);

    this.prevHash = { value: valueHash, error: errorHash };

    if (shouldNotify) this.listenerManager.notify();
  }

  /**
   * Use hashes to track changes. This is helpful for checking
   * if the contents of an object have changed, even if its
   * the same object reference.
   *
   * TODO: Hashes have a small chance of collision, i.e. a small
   * chance that a change to an object will go undetected.
   * Address this?
   */
  private hash(value: any) {
    if (value && (typeof value === "function" || typeof value === "object")) {
      try {
        return objectHash(value);
      } catch (e) {
        throw new CascadeError(
          this,
          "Error encountered while hashing incoming value",
          e as Error
        );
      }
    } else {
      return value;
    }
  }

  /////////////
  // HANDLES //
  /////////////

  // Keep track of handles from Cascades `this` is listening to

  private invHandles: ListenerHandle<[opts?: CloseOpts]>[] = [];
  private closeHandles: ListenerHandle[] = [];

  private updateDependencies(dependencies: Set<Cascade>) {
    this.debugInfo?.setDependencies([...dependencies]);

    // Remove listeners to onClose first, so when we
    // remove the regular listeners, this cascade doesn't close
    this.closeHandles.forEach((handle) => handle.off());

    // Close if any dependency closes
    this.closeHandles = [...dependencies].map((dep) =>
      dep.onClose(() => this.close())
    );

    // Invalidate if any dependencies update
    const invHandles = [...dependencies].map((dep) =>
      dep.listen(() => this.invalidate())
    );

    // Remove existing listeners after setting new ones
    // to ensure no dependency prematurely closes
    this.invHandles.forEach((handle) => handle.off());
    this.invHandles = invHandles;
  }

  //////////////////
  // CONSTRUCTION //
  //////////////////

  private opts: CascadeOpts;

  /**
   * TODO
   * @param compute
   * @param opts
   */
  constructor(
    private compute: (
      addDependency: (...dependencies: Cascade[]) => void
    ) => T | Promise<T>,
    { notify = "auto", autoclose = true, onClose }: CascadeOpts = {}
  ) {
    this.opts = { notify, autoclose };
    if (onClose) this.onClose(onClose);

    this.invalidate();
  }

  /////////////
  // CLOSING //
  /////////////

  // Handle closing `this`, unlinking all handles and
  // notifying any onClose listeners

  /**
   * TODO
   */
  close() {
    if (this._isClosed) return;

    this._isClosed = true;
    this.invHandles.forEach((handle) => handle.off());
    this.closeListenerManager.notify();
  }

  /**
   * TODO
   * @param listener
   * @returns
   */
  onClose(listener: Listener) {
    return this.closeListenerManager.addListener(listener);
  }
  private closeListenerManager = new ListenerManager();

  /**
   * TODO
   */
  get isClosed() {
    return this._isClosed;
  }
  private _isClosed = false;

  /////////////////
  // COMPUTATION //
  /////////////////

  // Handle re-computation, piping, etc.

  /**
   *
   */
  async invalidate() {
    this.isValid = false;

    const dependencies = new Set<Cascade>();
    const addDependencies = (...newDependencies: Cascade[]) =>
      newDependencies.forEach((dependency) => dependencies.add(dependency));

    try {
      this.report(null, await this.compute(addDependencies));
    } catch (e) {
      if (e !== DEFER_RESULT) this.report(e, undefined);
    } finally {
      this.updateDependencies(dependencies);
    }
  }

  /**
   * TODO
   * @param compute
   * @param opts
   * @returns
   */
  pipe<S>(compute: Compute<S, T>, opts?: CascadeOpts): Cascade<Unwrapped<S>> {
    const computed = new Cascade(
      (deps) => compute(Cascade.unwrap(this, deps) as T, deps),
      { notify: "always" }
    );

    const result = new Cascade((deps) => Cascade.unwrap(computed, deps), opts);

    return new Proxy(result, {
      get(target, p, receiver) {
        if (p === "invalidate") return () => computed.invalidate();
        return Reflect.get(target, p, receiver);
      },
    });
  }

  /**
   * TODO
   * @param compute
   * @param opts
   * @returns
   */
  pipeAll<S extends readonly [...any[]]>(
    compute: Compute<S, T>,
    opts?: CascadeOpts
  ) {
    return this.pipe(
      (value, deps) => Cascade.all(compute(value, deps)),
      opts
    ) as Cascade<AllUnwrapped<S>>;
  }

  /**
   * TODO
   * @param callback
   * @returns
   */
  tap(callback: (value: T) => void) {
    this.listen(
      () => {
        if (this.curError) return;
        else callback(this.curValue!);
      },
      { detached: true }
    );

    return this;
  }

  /**
   * TODO
   * @param handler
   * @returns
   */
  catch<S>(handler: (error: any) => S) {
    this.listen(
      () => {
        if (this.curError) handler(this.curError);
      },
      { detached: true }
    );

    return this;
  }

  /**
   * TODO
   * @returns
   */
  get({ keepAlive = true }: { keepAlive?: boolean } = {}): Promise<T> {
    if (this.isValid) {
      const result = this.curError
        ? Promise.reject(this.curError)
        : Promise.resolve(this.curValue!);

      if (!keepAlive && this.attachedListenerCount === 0) this.close();

      return result;
    }

    return this.next({ keepAlive });
  }

  /**
   * TODO
   * @returns
   */
  next({ keepAlive = true }: { keepAlive?: boolean } = {}): Promise<T> {
    return new Promise((res, rej) => {
      const handle = this.listen(
        () => {
          if (this.curError) rej(this.curError);
          else res(this.curValue!);

          handle.off({ keepAlive });
        },
        { detached: true }
      );
    });
  }

  ////////////////////
  // STATIC METHODS //
  ////////////////////

  // Utility functions for Cascades

  private static unwrap<T>(
    value: T,
    addDependency: (...dependencies: Cascade[]) => void
  ): Unwrapped<T> {
    if (value instanceof Cascade) {
      addDependency(value);

      if (!value.isValid) throw DEFER_RESULT;
      if (value.curError) throw value.curError;

      return Cascade.unwrap(value.curValue, addDependency);
    } else {
      return value as Unwrapped<T>;
    }
  }

  /**
   * TODO
   * @param error
   * @returns
   */
  static reject(error: any) {
    return new Cascade(() => {
      throw error;
    });
  }

  /**
   * TODO
   * @param value
   * @returns
   */
  static resolve<T>(value: T) {
    const awaited = new Cascade(() => value);
    const result = new Cascade((deps) => Cascade.unwrap(awaited, deps));

    return result;
  }

  /**
   * TODO
   * @param array
   * @returns
   */
  static all<T extends readonly [...any[]]>(array: T) {
    return array.reduce(
      (result, item) =>
        (result as Cascade<unknown[]>).pipe((array) =>
          Cascade.resolve(item).pipe((value) => [...array, value])
        ),
      new Cascade(() => [])
    ) as Cascade<AllUnwrapped<T>>;
  }
}
