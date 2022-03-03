export * from "./lib/consts";
export * from "./lib/errors";
export * from "./cascade";

import { Cascade } from "./cascade";
import { Adapter } from "./adapter";
Cascade.Adapter = Adapter;
