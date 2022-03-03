export type Listener<ListenerArgs extends unknown[] = []> = (
  ...args: ListenerArgs
) => void;

export type ListenerControls = {
  detach(): void;
  pause(): void;
};

export class ListenerManager<ListenerArgs extends unknown[] = []> {
  private listeners = new Set<{
    cb: Listener<ListenerArgs>;
    isPaused: boolean;
  }>();

  addListener(
    cb: Listener<ListenerArgs>,
    onRemoveListener?: () => void
  ): ListenerControls {
    const l = { cb, isPaused: false };
    this.listeners.add(l);
    return {
      detach: () => {
        this.listeners.delete(l);
        onRemoveListener?.();
      },
      pause: () => {
        l.isPaused = true;
      },
    };
  }

  notify(...args: ListenerArgs) {
    [...this.listeners].forEach((listener) => {
      if (!listener.isPaused) listener.cb(...args);
    });
  }

  get size() {
    return this.listeners.size;
  }
}
