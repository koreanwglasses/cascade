import objectHash from "object-hash";
import { CascadeError } from "./errors";

/**
 * Use hashes to track changes. This is helpful for checking
 * if the contents of an object have changed, even if its
 * the same object reference.
 *
 * TODO: Hashes have a small chance of collision, i.e. a small
 * chance that a change to an object will go undetected.
 * Address this?
 */

export function hash(value: any) {
  if (value && (typeof value === "function" || typeof value === "object")) {
    try {
      return objectHash(value);
    } catch (e) {
      throw new CascadeError(
        "Error encountered while hashing incoming value",
        e as Error
      );
    }
  } else {
    return value;
  }
}
