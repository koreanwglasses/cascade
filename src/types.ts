import { Volatile } from ".";

export type Whenever<T> = T | Promise<T>;

export type Listener = () => void;
export type ListenerHandle = { close(keepAlive?: boolean): void };

export type NestedCascade<T = unknown> = T | Volatile<NestedCascade<T>>;
export type FlatValueType<T> = Awaited<T> extends Volatile<infer S>
  ? FlatValueType<S>
  : Awaited<T>;

export type AllFlatValueType<T> = T extends any[]
  ? _AllFlatTupleValueType<T>
  : {
      [K in keyof T]: FlatValueType<T[K]>;
    };
type _AllFlatTupleValueType<T> = T extends []
  ? []
  : T extends [infer H, ...infer T]
  ? [FlatValueType<H>, ..._AllFlatTupleValueType<T>]
  : T extends (infer S)[]
  ? FlatValueType<S>[]
  : never;

export type SplatValueType<T extends any[]> = T extends []
  ? {}
  : T extends [...infer H, infer S]
  ? Omit<SplatValueType<H>, keyof AllFlatValueType<S>> & AllFlatValueType<S>
  : unknown;

export type Compute<S, T = undefined> = (
  value: T,
  /**
   * Add a dependency on external state
   */
  addDependency: (...dependencies: Volatile[]) => void
) => Whenever<S>;

export type $Compute<S, T = undefined> = (
  $: T & (<R>($: R) => Volatile<SplatValueType<[T, R]>>),
  /**
   * Add a dependency on external state
   */
  addDependency: (...dependencies: Volatile[]) => void
) => Whenever<S>;
