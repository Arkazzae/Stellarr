type Handler<Events extends object> = (payload: Events[keyof Events]) => void;

/** A small typed event emitter shared by the realtime clients and their test doubles. */
export class Emitter<Events extends object> {
  private readonly handlers = new Map<keyof Events, Set<Handler<Events>>>();

  /** Subscribes to one event and returns the function that unsubscribes. */
  on<E extends keyof Events>(
    event: E,
    handler: (payload: Events[E]) => void,
  ): () => void {
    const subscribed = this.handlers.get(event) ?? new Set<Handler<Events>>();
    this.handlers.set(event, subscribed);
    // The map is keyed by event, so a handler only ever receives the payload
    // of the event it was registered for.
    const entry = handler as Handler<Events>;
    subscribed.add(entry);
    return () => {
      subscribed.delete(entry);
    };
  }

  emit<E extends keyof Events>(event: E, payload: Events[E]): void {
    // Iterate a copy so a handler may unsubscribe itself or others mid-emit.
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      handler(payload);
    }
  }
}

/** The listener set behind "something changed" stores read through useSyncExternalStore. */
export class ChangeNotifier {
  private readonly listeners = new Set<() => void>();

  /** Bound, so it can be handed to useSyncExternalStore as it is. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
