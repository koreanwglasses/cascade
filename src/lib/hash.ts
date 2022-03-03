import { sha1 } from "object-hash";
import { Cascade } from "..";

export const hash = (value: any) =>
  sha1(
    JSON.stringify(value, (key, value) =>
      // Omit undetermined values when hashing
      value instanceof Cascade || value instanceof Promise ? null : value
    )
  );
