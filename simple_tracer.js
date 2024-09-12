import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

class Tracing {
  static asyncLocalStorage = new AsyncLocalStorage();

  static exporter = (span) => console.log(span);

  static getCurrentSpan = () => Tracing.asyncLocalStorage.getStore().span;

  static getContext = () => Tracing.asyncLocalStorage.getStore();

  static async setContext(ctx, cb, ...args) {
    await Tracing.asyncLocalStorage.run(ctx, cb, ...args);
  }

  static async startSpan(name, lambda) {
    let ctx = Tracing.asyncLocalStorage.getStore();
    let span = new Span(name, ctx, new Map());
    await Tracing.setContext(span.getContext(), lambda, span);
    span.end();
    Tracing.exporter(span);
  }
}

const EMPTY_CONTEXT = {};
Tracing.asyncLocalStorage.enterWith(EMPTY_CONTEXT);

class Span {
  constructor(name, context = {}, attributes = new Map()) {
    this.startTime = new Date().getTime();
    this.startTimestampMs = performance.now();
    this.traceID = context.traceID ?? crypto.randomBytes(16).toString("hex");
    this.parentSpanID = context.spanID ?? undefined;
    this.name = name;
    this.attributes = attributes;
    this.spanID = crypto.randomBytes(8).toString("hex");
  }

  getContext() {
    return { traceID: this.traceID, spanID: this.spanID, span: this };
  }

  setAttributes(keyValues) {
    for (let [key, value] of Object.entries(keyValues)) {
      this.attributes.set(key, value);
    }
  }

  end() {
    this.elapsedMs = performance.now() - this.startTimestampMs;
  }
}

export { Tracing };
