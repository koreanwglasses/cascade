import deepIs from "deep-is";
import {
  Listener,
  ListenerHandle,
  Whenever,
  BaseType,
  Nested,
  $Flat,
  $Compute,
  Compute,
  $Unpacked,
  Override,
} from "./types";

/**
 * throw this to abort computation without
 * passing a value or error to listeners and
 * wait until the next update from a dependency
 */
export const DEFER_RESULT = "CASCADE_DEFER_RESULT";

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

  private closeCbs: (() => void)[] = [];
  onClose(cb: () => void) {
    this.closeCbs.push(cb);
  }

  close() {
    this.closeCbs.forEach((cb) => cb());
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

  flat(): Cascade<BaseType<T>>;
  flat<S>(compute: Compute<S, BaseType<T>>): Cascade<S>;
  /** @internal */
  flat<S>(compute?: Compute<S, BaseType<T>>): Cascade<BaseType<T>> | Cascade<S>;
  flat<S>(
    compute?: Compute<S, BaseType<T>>
  ): Cascade<BaseType<T>> | Cascade<S> {
    return compute
      ? Cascade.flatten<any>(this).pipe(compute)
      : Cascade.flatten<any>(this);
  }

  f(): Cascade<BaseType<T>>;
  f<S>(compute: Compute<S, BaseType<T>>): Cascade<S>;
  f<S>(compute?: Compute<S, BaseType<T>>) {
    return this.flat(compute);
  }

  $<S>(
    compute: $Compute<S, T>
  ): Cascade<
    void extends S
      ? T
      : S extends $
      ? Override<T, $Flat<BaseType<Awaited<S>>>>
      : BaseType<Awaited<S>>
  >;
  $<S>(value: S): Cascade<Override<T, $Flat<BaseType<Awaited<S>>>>>;
  $<S>(value_compute: S | $Compute<S, T>) {
    return this.join<any>((prev, deps) => {
      if (typeof value_compute === "function") {
        const compute = value_compute as $Compute<S, T>;

        const $in = Object.assign(function ($out: any) {
          return new $($out);
        }, prev);

        return Cascade.flatten(compute($in, deps))
          .pipe((retval) =>
            typeof retval === "undefined"
              ? { ...$in }
              : retval instanceof $
              ? (retval as $<S>).flatten<T>($in)
              : retval
          )
          .flat();
      } else {
        return new $(value_compute).flatten(prev);
      }
    });
  }

  next(): Promise<T> {
    if (this.isValid) {
      const result = this.curError
        ? Promise.reject(this.curError)
        : Promise.resolve(this.curValue!);

      if (this.listeners.length === 0) this.close();
      return result;
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

export class Cascade<T = any> extends Volatile<T> {
  /**
   * Handles for listening to Cascades this is dependent on
   */
  private handles: ListenerHandle[] = [];

  private setDeps(deps: Volatile[]) {
    let depsUnique = [...new Set(deps)];

    if (deps.length > 0 && depsUnique.length === 0) {
      /**
       * Handles a strange bug where new Set([...]) returns an empty
       * set even when initialized with a non-empty array
       */

      depsUnique = deps.reduce((a, b) => {
        if (!a.includes(b)) a.push(b);
        return a;
      }, [] as Volatile[]);
    }

    const handles = depsUnique.map((dep) =>
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
   * invalidate even if the computed value doesn't change
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
    } finally {
      this.setDeps(deps);
    }
  }

  close() {
    this.handles.forEach((handle) => handle.close());
    super.close();
  }

  /**
   * Works similarly to Promise.all
   */
  static all<T extends readonly unknown[]>(providers: {
    [K in keyof T]: Volatile<T[K]>;
  }) {
    return providers.reduce<Cascade<readonly any[]>>(
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

  static flatten<T extends Nested>(value: Whenever<T>): Cascade<BaseType<T>> {
    if (value instanceof Volatile) {
      return value.join((result) => Cascade.flatten(result));
    }
    if (
      value &&
      typeof value === "object" &&
      "then" in (value as object) &&
      typeof (value as { then: unknown }).then === "function"
    ) {
      // value is thenable
      return Cascade.flatten(new Cascade(() => value));
    }
    return new Cascade(() => value as BaseType<T>);
  }

  static $<T>(value: T): Cascade<$Flat<T>>;
  static $<T>(
    compute: $Compute<T>
  ): Cascade<
    void extends T
      ? {}
      : T extends $
      ? Override<T, $Flat<T>>
      : BaseType<Awaited<T>>
  >;
  static $<T>(value: T | $Compute<T>) {
    return Cascade.const({}).$(value);
  }
}

export class $<S = unknown> {
  constructor(readonly $: S) {}
  flatten<T>(prev: T): Cascade<Override<T, $Flat<S>>> {
    return Cascade.all(
      Object.entries(this.$).map(([key, value]) =>
        Cascade.all([Cascade.const(key), Cascade.flatten(value)])
      )
    ).p((entries) => ({ ...prev, ...Object.fromEntries(entries) }));
  }
}
