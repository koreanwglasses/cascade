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

  private dependencies?: (DebugInfo | undefined)[];
  /** @internal */
  setDependencies(dependencies: Cascade[]) {
    this.dependencies = dependencies.map((dep) => dep.debugInfo);
  }

  private getRootsInfo(): DebugInfo[] {
    if (!this.dependencies) return [];

    const rootsInfo = this.dependencies
      .map((dep) => dep?.getRootsInfo() ?? [])
      .flat();

    if (this.dependencies.length === 0) rootsInfo.push(this);

    return rootsInfo;
  }

  get trace() {
    type Root = { declaredAt: string[]; num: number; numClosed: number };
    const roots = new Map<string, Root>();
    this.getRootsInfo().forEach((info) => {
      const key = info.declaredAt?.join() ?? "UNKNOWN";

      if (roots.has(key)) {
        const root = roots.get(key)!;
        root.num++;
        if (info.cascade.isClosed) root.numClosed++;
      } else {
        roots.set(key, {
          declaredAt: info.declaredAt ?? ["<unknown>"],
          num: 1,
          numClosed: info.cascade.isClosed ? 1 : 0,
        });
      }
    });

    const printInfo = (root: Root) =>
      root.declaredAt
        .map(
          (line, i) =>
            `${
              i === 0
                ? `  - (${
                    root.num > 1 ? `${root.numClosed}/${root.num} ` : ""
                  }${
                    root.numClosed || root.num > 1 ? "closed" : "open"
                  }) Cascade declared `
                : "    "
            }${line.trim()}\n`
        )
        .join("");

    return (
      (this.declaredAt ?? ["<unknown>"])
        .map((line, i) => `${i === 0 ? `Cascade declared ` : "    "}${line}\n`)
        .join("") +
      `Root dependencies:\n` +
      [...roots.values()]
        .sort((a, b) => b.num - a.num)
        .map(printInfo)
        .join("")
    );
  }
}

const getUserStackFrame = () => {
  Error.stackTraceLimit = 100;
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
  return lines;
};
