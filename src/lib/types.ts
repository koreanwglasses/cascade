import { Cascade } from "..";

/**
 * TODO
 */
export type CascadeOpts = {
  notify?: "auto" | "never" | "always";
  autoclose?: boolean;
  onClose?: () => void;
};

/**
 * TODO
 */
export type CloseOpts = {
  keepAlive?: boolean;
};

/**
 * TODO
 */
export type Resolvable<T> = T | Promise<T> | Cascade<T> | Promise<Cascade<T>>;

/**
 * TODO
 */
export type Unwrapped<T> = T extends Promise<infer S> | Cascade<infer S>
  ? Unwrapped<S>
  : T;

/**
 * TODO
 */
export type AllResolvable<T extends readonly [...any[]]> = {
  [K in keyof T]: Resolvable<T[K]>;
};

/**
 * TODO
 */
export type AllUnwrapped<T extends readonly [...any[]]> = {
  [K in keyof T]: Unwrapped<T[K]>;
};

/**
 * TODO
 * @param value
 * @param addDependency
 * @returns
 */
export type Compute<S, T = undefined> = (
  value: T,
  addDependency: (...dependencies: Cascade[]) => void
) => S;
