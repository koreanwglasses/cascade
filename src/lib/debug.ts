import { Cascade } from "..";

export let isDebuggingEnabled = false;

/** @internal */
export const enableDebugging = () => {
  isDebuggingEnabled = true;
  console.log("Cascade debugging enabled");
};

/** @internal */
export class DebugInfo {
  constructor(private cascade: Cascade) {}

  readonly declaredAt = getUserStackFrame();

  private deps?: (DebugInfo | undefined)[];
  /** @internal */
  setDependencies(dependencies: Cascade[]) {
    this.deps = dependencies.map((dep) => dep.debugInfo);
  }

  private getKeyDeps(): DebugInfo[] {
    if (!this.deps) return [];

    const keyDeps = this.deps.map((dep) => dep?.getKeyDeps() ?? []).flat();

    if (this.deps.filter((dep) => dep?.cascade.isClosed).length === 0)
      keyDeps.push(this);

    return keyDeps;
  }

  get trace() {
    type Dep = { declaredAt: string[]; num: number; numOpen: number };
    const keyDeps = new Map<string, Dep>();
    this.getKeyDeps().forEach((info) => {
      const key = info.declaredAt?.join() ?? "UNKNOWN";

      if (keyDeps.has(key)) {
        const root = keyDeps.get(key)!;
        root.num++;
        if (!info.cascade.isClosed) root.numOpen++;
      } else {
        keyDeps.set(key, {
          declaredAt: info.declaredAt ?? ["at <unknown>"],
          num: 1,
          numOpen: info.cascade.isClosed ? 0 : 1,
        });
      }
    });

    const printInfo = (root: Dep) =>
      root.declaredAt
        .map(
          (line, i) =>
            `${
              i === 0
                ? `  - (${
                    root.num > 1 && root.numOpen > 0
                      ? `${root.numOpen}/${root.num} `
                      : ""
                  }${root.numOpen > 0 ? "open" : "closed"}) Cascade declared `
                : "    "
            }${line.trim()}\n`
        )
        .join("");

    return (
      (this.declaredAt ?? ["at <unknown>"])
        .map((line, i) => `${i === 0 ? `Cascade declared ` : "    "}${line}\n`)
        .join("") +
      `Key dependencies:\n` +
      [...keyDeps.values()]
        .sort((a, b) => b.num - a.num)
        .map(printInfo)
        .join("")
    );
  }
}

const getUserStackFrame = () => {
  Error.stackTraceLimit = 20;
  const lines = new Error().stack
    ?.split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(
      (line) =>
        !(
          line.includes("/cascade/dist/") ||
          line.includes("(<anonymous>)") ||
          line.includes("node:internal/")
        )
    );

  if (lines?.length) return lines;
};
