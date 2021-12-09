import { Volatile } from ".";

export type Whenever<T> = T | Promise<T>;

export type Listener = () => void;
export type ListenerHandle = { close(): void };

export type Nested<T = unknown> = T | Volatile<Nested<T>>;
export type BaseType<T> = T extends Volatile<infer S> ? BaseType<S> : T;
