export type Listener<ListenerArgs extends unknown[] = []> = (
  ...args: ListenerArgs
) => void;

export type ListenerHandle<CloseArgs extends unknown[] = []> = {
  off(...args: CloseArgs): void;
};

export class ListenerManager<
  ListenerArgs extends unknown[] = [],
  CloseArgs extends unknown[] = []
> {
  private listeners = new Set<Listener<ListenerArgs>>();

  addListener(
    listener: Listener<ListenerArgs>,
    onRemoveListener?: (...args: CloseArgs) => void
  ): ListenerHandle<CloseArgs> {
    this.listeners.add(listener);
    return {
      off: (...args: CloseArgs) => {
        this.listeners.delete(listener);
        onRemoveListener?.(...args);
      },
    };
  }

  notify(...args: ListenerArgs) {
    [...this.listeners].forEach((listener) => listener(...args));
  }
}
