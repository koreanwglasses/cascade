export * from "./lib/consts";
export * from "./cascade";

import { Cascade } from "./cascade";
import { Mutable } from "./mutable";
Cascade.Adapter = Mutable;
