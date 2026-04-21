import { EventEmitter } from "node:events";
import type { AppEvents } from "./types.js";

type Handler<K extends keyof AppEvents> = (event: AppEvents[K]) => void;

export class EventBus {
  private inner = new EventEmitter();

  on<K extends keyof AppEvents>(event: K, handler: Handler<K>): this {
    this.inner.on(event, handler);
    return this;
  }

  off<K extends keyof AppEvents>(event: K, handler: Handler<K>): this {
    this.inner.off(event, handler);
    return this;
  }

  emit<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): boolean {
    return this.inner.emit(event, payload);
  }
}
