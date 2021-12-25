import { Compute, CloseOpts, CascadeOpts, Unwrapped, AllUnwrapped } from ".";
import {
  Listener,
  ListenerHandle,
  ListenerManager,
} from "./lib/listener-manager";
import { hash } from "./lib/hash";
import { DEFER_RESULT } from "./lib/consts";

export class Cascade<T = any> {
  //////////

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
        if (!detached) this.attachedListenerCount--;

        if (!keepAlive && this.attachedListenerCount <= 0) this.close();
      }
    );
  }

  //////////

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

  //////////

  private handles: ListenerHandle<[opts?: CloseOpts]>[] = [];

  private updateDependencies(dependencies: Set<Cascade>) {
    const handles = [...dependencies].map((dep) =>
      dep.listen(() => this.invalidate())
    );

    this.handles.forEach((handle) => handle.close());
    this.handles = handles;
  }

  /////////////////
  // CONSTRUCTOR //
  /////////////////

  /**
   * The compute expression is evaluated when:
   * 1) `this.invalidate()` is called, or
   * 2) `invalidate()` is called on one of its dependencies.
   *
   * If the result of the computation has changed (tested
   * using deepEqual), then dependent `Cascade`s are invalidated
   *
   * @param compute The expression to be evaluated
   */
  constructor(
    private compute: (
      addDependency: (...dependencies: Cascade[]) => void
    ) => T | Promise<T>,
    private opts: CascadeOpts = {}
  ) {
    this.invalidate();
  }

  ////////////

  close(opts?: CloseOpts) {
    this.handles.forEach((handle) => handle.close(opts));
    this._isClosed = true;
    this.closeListenerManager.notify();
  }

  private closeListenerManager = new ListenerManager();
  onClose(listener: () => void) {
    return this.closeListenerManager.addListener(listener);
  }

  private _isClosed = false;
  get isClosed() {
    return this._isClosed;
  }

  ////////////

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

  ////////////

  /**
   * Chain the output of this Cascade into another computation
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
   * Catch any errors thrown by an upstream Cascade
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
   * Gets the current value or next valid value if invalid
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
   * Waits for the the next reported value, whether or not the current value is
   * valid
   */
  next(): Promise<T> {
    return new Promise((res, rej) => {
      const handle = this.listen(() => {
        if (this.curError) rej(this.curError);
        else res(this.curValue!);

        handle.close({ keepAlive: true });
      });
    });
  }

  ////////////////////
  // STATIC METHODS //
  ////////////////////

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
   * Creates a Cascade that throws an error
   */
  static reject(error: any) {
    return new Cascade(() => {
      throw error;
    });
  }

  static resolve<T>(value: T) {
    const awaited = new Cascade(() => value);
    return new Cascade((deps) => Cascade.unwrap(awaited, deps));
  }

  static all<T extends Cascade[] | readonly Cascade[]>(array: T) {
    return array.reduce(
      (result, item) =>
        result.pipe((array) => item.pipe((value) => [...array, value])),
      new Cascade(() => [])
    ) as Cascade<AllUnwrapped<T>>;
  }
}
