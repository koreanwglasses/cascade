import deepEqual from "deep-equal";

const ABORT = "ABORT_WITHIN_CASCADE_CALLBACK";

type Whenever<T> = T | Promise<T>;

type Listener = () => void;
type ListenerHandle = { close(): void };

export class Volatile<T = any> {
  /**
   * Listeners from Cascade that are dependent on this
   */
  private listeners: Listener[] = [];

  protected listen(listener: Listener): ListenerHandle {
    this.listeners.push(listener);
    return {
      close: () => {
        const i = this.listeners.indexOf(listener);
        if (i !== -1) this.listeners.splice(i, 1);

        if (this.listeners.length === 0) this.close();
      },
    };
  }

  protected notify() {
    this.listeners.forEach((listener) => listener());
  }

  protected close() {}

  protected isValid = false;
  protected curValue?: T;
  protected curError?: any;

  constructor() {
    this.invalidate();
  }

  invalidate() {
    this.isValid = false;
  }

  /**
   * Chain the output of this Cascade into another computation
   */
  pipe<S>(compute: Compute<S, T>) {
    const provider = this;
    return new Cascade((_, deps, defer) => {
      deps(provider);

      if (!provider.isValid) throw defer();
      if (provider.curError) throw provider.curError;
      return compute(provider.curValue!, deps, defer);
    });
  }

  p<S>(compute: Compute<S, T>) {
    return this.pipe(compute);
  }

  /**
   * Catch any errors thrown by an upstream Cascade
   */
  catch<S>(handler: (error: any) => Whenever<S>) {
    const provider = this;
    return new Cascade((_, deps, abort) => {
      deps(provider);

      if (!provider.isValid) throw abort();
      if (provider.curError) return handler(provider.curError);
      return provider.curValue!;
    });
  }

  /**
   * Chains a computation that returns a Cascade and outputs the nested type
   */
  join<S>(compute: Compute<Cascade<S>, T>) {
    return this.pipe(
      async (value, deps, abort) =>
        await ((await compute(value, deps, abort)) as any).compute(
          undefined,
          deps,
          abort
        )
    );
  }

  j<S>(compute: Compute<Cascade<S>, T>): Cascade<S> {
    return this.join(compute);
  }

  next(): Promise<T> {
    if (this.isValid) {
      if (this.curError) return Promise.reject(this.curError);
      return Promise.resolve(this.curValue!);
    }

    return new Promise((res, rej) => {
      const handle = this.listen(() => {
        if (this.curError) rej(this.curError);
        else res(this.curValue!);

        handle.close();
      });
    });
  }
}

export class Managed<T = any> extends Volatile<T> {
  value(value: T) {
    this.curValue = value;
    this.curError = null;
    this.isValid = true;
    this.notify();
  }

  error(error: any) {
    this.curValue = undefined;
    this.curError = error;
    this.isValid = true;
    this.notify();
  }
}

export type Compute<S, T = undefined> = (
  value: T,
  /**
   * Add a dependency on external state
   */
  addDependency: (...dependencies: Volatile[]) => void,
  /**
   * Wait until the next invalidate to re-compute
   */
  defer: () => void
) => Whenever<S>;

export class Cascade<T = any> extends Volatile<T> {
  /**
   * Handles for listening to Cascades this is dependent on
   */
  private handles: ListenerHandle[] = [];

  private prevValue?: T;
  private prevError?: any;
  async invalidate() {
    this.isValid = false;

    let deps: Volatile[] = [];
    const addDeps = (...deps_: Volatile[]) => deps.push(...deps_);

    const abort = () => {
      throw ABORT;
    };

    try {
      this.curValue = await this.compute(undefined, addDeps, abort);
      this.curError = null;
    } catch (e) {
      if (e === ABORT) return this.setDeps(deps);
      this.curValue = undefined;
      this.curError = e;
    }

    this.isValid = true;

    // Notify dependents of changes
    if (this.curError && !deepEqual(this.curError, this.prevError)) {
      this.notify();
    } else if (!deepEqual(this.curValue, this.prevValue)) {
      this.notify();
    }

    this.prevValue = this.curValue;
    this.prevError = this.curError;

    this.setDeps(deps);
  }

  private setDeps(deps: Volatile[]) {
    const handles = [...new Set(deps)].map((dep) =>
      (dep as Cascade).listen(() => this.invalidate())
    );

    this.handles.forEach((handle) => handle.close());
    this.handles = handles;
  }

  protected close() {
    this.handles.forEach((sub) => sub.close());
  }

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
  constructor(private compute: Compute<T>) {
    super();
  }

  /**
   * Works similarly to Promise.all
   */
  static all<T extends unknown[]>(providers: {
    [K in keyof T]: Cascade<T[K]>;
  }) {
    return providers.reduce<Cascade<unknown[]>>(
      (a, b) => a.join((arr) => b.pipe((val) => [...arr, val])),
      Cascade.const([])
    ) as unknown as Cascade<T>;
  }

  /**
   * Creates a Cascade that outputs a constant value
   */
  static const<T>(value: T) {
    return new Cascade(() => value);
  }

  /**
   * Creates a Cascade that throws an error
   */
  static error(error: any) {
    return new Cascade(() => {
      throw error;
    });
  }
}
