import deepEqual from "deep-equal";

const ABORT = "ABORT_WITHIN_CASCADE_CALLBACK";

type Whenever<T> = T | Promise<T>;

type Listener = () => void;
type ListenerHandle = { close(): void };

export type Compute<S, T = undefined> = (
  value: T,
  addDependency: (...dependencies: Cascade[]) => void,
  abort: () => void
) => Whenever<S>;

export class Cascade<T = any> {
  /**
   * Listeners from Cascade that are dependent on this
   */
  private listeners: Listener[] = [];

  /**
   * Handles for listening to Cascades this is dependent on
   */
  private handles: ListenerHandle[] = [];

  private isValid = false;
  private listen(listener: Listener): ListenerHandle {
    if (this.isValid) listener();
    this.listeners.push(listener);
    return {
      close: () => {
        const i = this.listeners.indexOf(listener);
        if (i !== -1) this.listeners.splice(i, 1);

        if (this.listeners.length === 0) this.close?.();
      },
    };
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  private close() {
    this.handles.forEach((sub) => sub.close());
  }

  private curValue?: T;
  private curError?: any;

  private prevValue?: T;
  private prevError?: any;
  async invalidate() {
    this.isValid = false;

    let dependencies: Cascade[] = [];
    const deps = (...deps: Cascade[]) => dependencies.push(...deps);

    const abort = () => {
      throw ABORT;
    };

    try {
      this.curValue = await this.compute(undefined, deps, abort);
      this.curError = null;
    } catch (e) {
      if (e === ABORT) return;

      this.curValue = undefined;
      this.curError = e;
    }

    // Subscribe to new dependencies before unsubscribing from old ones
    // to prevent dependencies from closing while waiting to re-subscribe
    const handles = [...new Set(dependencies)].map((dep) =>
      dep.listen(() => this.invalidate())
    );

    this.handles.forEach((handle) => handle.close());
    this.handles = handles;

    this.isValid = true;

    // Notify dependents of changes
    if (this.curError && !deepEqual(this.curError, this.prevError)) {
      this.notify();
    } else if (!deepEqual(this.curValue, this.prevValue)) {
      this.notify();
    }

    this.prevValue = this.curValue;
    this.prevError = this.curError;
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
    this.invalidate();
  }

  /**
   * Chain the output of this Cascade into another computation
   */
  pipe<S>(compute: Compute<S, T>) {
    const provider = this;
    return new Cascade((_, deps, abort) => {
      deps(provider);

      if (!provider.isValid) throw abort();
      if (provider.curError) throw provider.curError;
      return compute(provider.curValue!, deps, abort);
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
        await (
          await compute(value, deps, abort)
        ).compute(undefined, deps, abort)
    );
  }

  j<S>(compute: Compute<Cascade<S>, T>): Cascade<S> {
    return this.join(compute);
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
}
