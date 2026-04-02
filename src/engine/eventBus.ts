type Listener<T> = (payload: T) => void;

export class EventBus<TEvents extends object> {
  private readonly listeners = new Map<keyof TEvents, Set<Listener<any>>>();

  on<TKey extends keyof TEvents>(event: TKey, listener: Listener<TEvents[TKey]>): () => void {
    const bucket = this.listeners.get(event) ?? new Set<Listener<TEvents[TKey]>>();
    bucket.add(listener);
    this.listeners.set(event, bucket);

    return () => {
      bucket.delete(listener);
      if (bucket.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  emit<TKey extends keyof TEvents>(event: TKey, payload: TEvents[TKey]): void {
    const bucket = this.listeners.get(event);
    if (!bucket) {
      return;
    }

    for (const listener of bucket) {
      listener(payload);
    }
  }
}


