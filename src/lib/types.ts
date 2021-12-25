import { Cascade } from "..";

export type CascadeOpts = {
  notify?: "auto" | "never" | "always";
};

export type CloseOpts = { keepAlive?: boolean };

export type Unwrapped<T> = T extends Cascade<infer S> ? Unwrapped<S> : T;

export type AllUnwrapped<T extends Cascade[] | readonly Cascade[]> = T extends []
  ? []
  : T extends readonly []
  ? readonly []
  : T extends [infer X, ...infer XS]
  ? XS extends Cascade[]
    ? [Unwrapped<X>, ...AllUnwrapped<XS>]
    : never
  : T extends readonly [infer X, ...infer XS]
  ? XS extends readonly Cascade[]
    ? readonly [Unwrapped<X>, ...AllUnwrapped<XS>]
    : never
  : T extends (infer S)[]
  ? Unwrapped<S>[]
  : T extends readonly (infer S)[]
  ? readonly Unwrapped<S>[]
  : never;

export type Compute<S, T = undefined> = (
  value: T,
  /**
   * Add a dependency on external state
   */
  addDependency: (...dependencies: Cascade[]) => void
) => S;
