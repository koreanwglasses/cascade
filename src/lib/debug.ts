import { Cascade } from "..";

export let isDebuggingEnabled = false;

/** @internal */
export const enableDebugging = () => {
  isDebuggingEnabled = true;
  console.log("Cascade debugging enabled");
};

/** @internal */
export class DebugInfo {
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

  get roots() {
    const maxItems = 10;

    const rootsInfo = this.getRootsInfo().filter(
      (info) => info.declaredAt?.length
    );

    const printInfo = (info: DebugInfo) =>
      info.declaredAt
        ?.map(
          (line, i) =>
            `${i === 0 ? "  - Cascade declared " : "    "}${line.trim()}\n`
        )
        .join("");

    let result = `Trace roots: \n`;

    if (rootsInfo.length <= maxItems) {
      result += rootsInfo.slice(1).map(printInfo).join("");
    } else {
      result +=
        rootsInfo
          .slice(1, 1 + maxItems / 2)
          .map(printInfo)
          .join("") +
        `        ... omitting ${rootsInfo.length - maxItems} items ...\n` +
        rootsInfo
          .slice(-maxItems / 2)
          .map(printInfo)
          .join("");
    }
    return result;
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
