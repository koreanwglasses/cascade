import { Volatile } from ".";

export type Whenever<T> = T | Promise<T>;

export type Listener = () => void;
export type ListenerHandle = { close(): void };

export type Nested<T = unknown> = T | Volatile<Nested<T>>;

export type BaseType<T> = T extends Volatile<infer S> ? BaseType<S> : T;

export type Compute<S, T = undefined> = (
  value: T,
  /**
   * Add a dependency on external state
   */
  addDependency: (...dependencies: Volatile[]) => void
) => Whenever<S>;

export type $Compute<S, T = {}> = (
  $: $Flat<T> & (<S>($: S) => $<S>),
  /**
   * Add a dependency on external state
   */
  addDependency: (...dependencies: Volatile[]) => void
) => Whenever<S>;

export type $Flat<T> = T extends $<infer S>
  ? { [K in keyof S]: BaseType<Awaited<S[K]>> }
  : { [K in keyof T]: BaseType<Awaited<T[K]>> };

export type $Unpacked<S> = S extends $<infer T> ? T : never;

export class $<T = unknown> {
  constructor(readonly $: T) {}
}
