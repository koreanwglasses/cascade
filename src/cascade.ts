import deepIs from "deep-is";

/**
 * throw this to abort computation without
 * passing a value or error to listeners and
 * wait until the next update from a dependency
 */
export const DEFER_RESULT = "CASCADE_DEFER_RESULT";

type Whenever<T> = T | Promise<T>;

type Listener = () => void;
type ListenerHandle = { close(): void };

export abstract class Volatile<T = any> {
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

  private isValid = false;
  private curValue?: T;
  private curError?: any;

  private prevValue?: T;
  private prevError?: any;

  protected report(error: any, value?: T, forceNotify = false) {
    this.curError = error;
    this.curValue = value;
    this.isValid = true;

    // Notify dependents of changes
    if (
      forceNotify ||
      (!("prevError" in this) && !("prevValue" in this)) ||
      (this.curError
        ? !deepIs(this.curError, this.prevError)
        : !deepIs(this.curValue, this.prevValue))
    ) {
      [...this.listeners].forEach((listener) => listener());
    }

    this.prevValue = this.curValue;
    this.prevError = this.curError;
  }

  private closeCbs: (() => void)[]= []
  onClose(cb: () => void) {
    this.closeCbs.push(cb);
  }

  close() {
    this.closeCbs.forEach(cb => cb())
  }

  /**
   * @param forceNotify Set this to true to notify listeners even if the
   * resulting value hasn't changed
   */
  invalidate(forceNotify?: boolean) {
    this.isValid = false;
  }

  /**
   * Chain the output of this Cascade into another computation
   */
  pipe<S>(compute: Compute<S, T>, alwaysNotify?: boolean) {
    const provider = this;
    return new Cascade((_, deps) => {
      deps(provider);

      if (!provider.isValid) throw DEFER_RESULT;
      if (provider.curError) throw provider.curError;
      return compute(provider.curValue!, deps);
    }, alwaysNotify);
  }

  p<S>(compute: Compute<S, T>, alwaysNotify?: boolean) {
    return this.pipe(compute, alwaysNotify);
  }

  /**
   * Catch any errors thrown by an upstream Cascade
   */
  catch<S>(handler: (error: any) => Whenever<S>) {
    const provider = this;
    return new Cascade((_, deps) => {
      deps(provider);

      if (!provider.isValid) throw DEFER_RESULT;
      if (provider.curError) return handler(provider.curError);
      return provider.curValue as T;
    });
  }

  /**
   * Chains a computation that returns a Cascade that outputs the nested type
   * 
   * Calling invalidate will re-run the given compute function
   */
  join<S>(compute: Compute<Volatile<S>, T>): Cascade<S> {
    const a = this.pipe(compute);
    const b = a.pipe((vol, deps) => {
      deps(vol);

      if (!vol.isValid) throw DEFER_RESULT;
      if (vol.curError) throw vol.curError;
      return vol.curValue as S;
    });

    return new Proxy(b, {
      get(target, p, receiver) {
        if (p === "invalidate")
          return (forceNotify?: boolean) => a.invalidate(forceNotify);
        else return Reflect.get(target, p, receiver);
      },
    });
  }

  j<S>(compute: Compute<Volatile<S>, T>): Cascade<S> {
    return this.join(compute);
  }

  flat<T>(): Cascade<T> {
    return Cascade.flatten<any>(this);
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
  value(value: T, forceNotify = false) {
    this.report(null, value, forceNotify);
  }

  error(error: any, forceNotify = false) {
    this.report(error, undefined, forceNotify);
  }
}

export type Compute<S, T = undefined> = (
  value: T,
  /**
   * Add a dependency on external state
   */
  addDependency: (...dependencies: Volatile[]) => void
) => Whenever<S>;

export class Cascade<T = any> extends Volatile<T> {
  /**
   * Handles for listening to Cascades this is dependent on
   */
  private handles: ListenerHandle[] = [];

  private setDeps(deps: Volatile[]) {
    const handles = [...new Set(deps)].map((dep) =>
      (dep as Cascade).listen(() => this.invalidate())
    );

    this.handles.forEach((handle) => handle.close());
    this.handles = handles;
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
   * @param alwaysNotify Set this to true to notify listeners on every
   * invalidate even if the compute value doesn't change
   */
  constructor(private compute: Compute<T>, private alwaysNotify = false) {
    super();
    this.invalidate();
  }

  async invalidate(forceNotify = false) {
    super.invalidate();

    let deps: Volatile[] = [];
    const addDeps = (...deps_: Volatile[]) => deps.push(...deps_);

    try {
      this.report(
        null,
        await this.compute(undefined, addDeps),
        forceNotify || this.alwaysNotify
      );
    } catch (e) {
      if (e !== DEFER_RESULT)
        this.report(e, undefined, forceNotify || this.alwaysNotify);
    }

    this.setDeps(deps);
  }

  close() {
    this.handles.forEach((handle) => handle.close());
    super.close()
  }

  /**
   * Works similarly to Promise.all
   */
  static all<T extends unknown[]>(providers: {
    [K in keyof T]: Volatile<T[K]>;
  }) {
    return providers.reduce<Cascade<any[]>>(
      (a, b) => a.join((arr) => b.pipe((val) => [...arr, val])),
      Cascade.const([])
    ) as Cascade<T>;
  }

  /**
   * Creates a Cascade that outputs a constant value
   */
  static const<T>(value: T) {
    return new Cascade(() => value);
  }

  static trigger() {
    return new Cascade(() => {}, true);
  }

  /**
   * Creates a Cascade that throws an error
   */
  static error(error: any) {
    return new Cascade(() => {
      throw error;
    });
  }

  static flatten<T>(nestedCascade: Nested<T>): Cascade<T> {
    if (nestedCascade instanceof Volatile) {
      return nestedCascade.join((result) => Cascade.flatten(result));
    }
    return new Cascade(() => nestedCascade);
  }
}

type Nested<T> = T | Volatile<Nested<T>>;
