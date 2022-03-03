export type Listener<ListenerArgs extends unknown[] = []> = (
  ...args: ListenerArgs
) => void;

export type ListenerControls = {
  detach(): void;
  pause(): void;
};

class PrimitiveListenerManager<ListenerArgs extends unknown[] = []> {
  private listeners = new Set<{
    cb: Listener<ListenerArgs>;
    isPaused: boolean;
  }>();

  protected removeListener(l: {
    cb: Listener<ListenerArgs>;
    isPaused: boolean;
  }) {
    return this.listeners.delete(l);
  }

  addListener(cb: Listener<ListenerArgs>): ListenerControls {
    const l = { cb, isPaused: false };
    this.listeners.add(l);
    return {
      detach: () => {
        this.removeListener(l);
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

export class ListenerManager<
  ListenerArgs extends unknown[] = []
> extends PrimitiveListenerManager<ListenerArgs> {
  private removeListenerManager = new PrimitiveListenerManager();
  onListenerRemove(cb: Listener) {
    return this.removeListenerManager.addListener(cb);
  }

  protected removeListener(l: {
    cb: Listener<ListenerArgs>;
    isPaused: boolean;
  }): boolean {
    const retval = super.removeListener(l);
    if (retval) this.removeListenerManager.notify();
    return retval;
  }
}
