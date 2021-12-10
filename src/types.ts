import { Volatile } from ".";

export type Whenever<T> = T | Promise<T>;

export type Listener = () => void;
export type ListenerHandle = { close(): void };

export type Nested<T = unknown> = T | Volatile<Nested<T>>;

export type BaseType<T> = T extends Volatile<infer S> ? BaseType<S> : T;
export type ArrayBaseType<T> = T extends readonly []
  ? readonly []
  : T extends readonly [infer U, ...infer V]
  ? readonly [BaseType<U>, ...ArrayBaseType<V>]
  : T extends readonly (infer U)[]
  ? readonly BaseType<U>[]
  : never;
