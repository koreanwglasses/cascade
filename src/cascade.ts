import { Compute, CloseOpts, CascadeOpts, Unwrapped, AllUnwrapped } from ".";
import {
  Listener,
  ListenerHandle,
  ListenerManager,
} from "./lib/listener-manager";
import { hash } from "./lib/hash";
import { DEFER_RESULT } from "./lib/consts";

/**
 * TODO
 */
export class Cascade<T = any> {
  ///////////////
  // LISTENERS //
  ///////////////

  // Manage listeners from Cascades that depend on `this`

  private listenerManager = new ListenerManager<[opts?: CloseOpts]>();
  private attachedListenerCount = 0;

  private listen(
    listener: Listener,
    { detached = false }: { detached?: boolean } = {}
  ) {
    if (!detached) this.attachedListenerCount++;

    return this.listenerManager.addListener(
      listener,
      ({ keepAlive = false } = {}) => {
        if (detached) return;

        this.attachedListenerCount--;
        if (!keepAlive && this.attachedListenerCount <= 0) this.close();
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
    const errorHash = hash(error);
    const valueHash = hash(value);

    const shouldNotify =
      !this.prevHash ||
      (error
        ? this.prevHash.error !== errorHash
        : this.prevHash.value !== valueHash);

    this.prevHash = { value: valueHash, error: errorHash };

    if (shouldNotify) this.listenerManager.notify();
  }

  /////////////
  // HANDLES //
  /////////////

  // Keep track of handles from Cascades `this` is listening to

  private handles: ListenerHandle<[opts?: CloseOpts]>[] = [];

  private updateDependencies(dependencies: Set<Cascade>) {
    const handles = [...dependencies].map((dep) =>
      dep.listen(() => this.invalidate())
    );

    this.handles.forEach((handle) => handle.close());
    this.handles = handles;
  }

  //////////////////
  // CONSTRUCTION //
  //////////////////

  /**
   * TODO
   * @param compute
   * @param opts
   */
  constructor(
    private compute: (
      addDependency: (...dependencies: Cascade[]) => void
    ) => T | Promise<T>,
    private opts: CascadeOpts = {}
  ) {
    this.invalidate();
  }

  /////////////
  // CLOSING //
  /////////////

  // Handle closing `this`, unlinking all handles and 
  // notifying any onClose listeners

  /**
   * TODO
   * @param opts
   */
  close(opts?: CloseOpts) {
    this.handles.forEach((handle) => handle.close(opts));
    this._isClosed = true;
    this.closeListenerManager.notify();
  }

  /**
   * TODO
   * @param listener
   * @returns
   */
  onClose(listener: () => void) {
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
  get(): Promise<T> {
    if (this.isValid) {
      const result = this.curError
        ? Promise.reject(this.curError)
        : Promise.resolve(this.curValue!);

      return result;
    }

    return this.next();
  }

  /**
   * TODO
   * @returns
   */
  next(): Promise<T> {
    return new Promise((res, rej) => {
      const handle = this.listen(
        () => {
          if (this.curError) rej(this.curError);
          else res(this.curValue!);

          handle.close();
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
    return new Cascade((deps) => Cascade.unwrap(awaited, deps));
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
