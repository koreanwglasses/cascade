export type Listener = () => void;

export type ListenerHandle<CloseArgs extends unknown[] = []> = {
  close(...args: CloseArgs): void;
};

export class ListenerManager<CloseArgs extends unknown[] = []> {
  private listeners = new Set<Listener>();

  addListener(
    listener: Listener,
    onClose?: (...args: CloseArgs) => void
  ): ListenerHandle<CloseArgs> {
    this.listeners.add(listener);
    return {
      close: (...args: CloseArgs) => {
        this.listeners.delete(listener);
        onClose?.(...args);
      },
    };
  }

  notify() {
    [...this.listeners].forEach((listener) => listener());
  }
}
