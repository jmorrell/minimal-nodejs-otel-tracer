import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

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
    this.durationMs = performance.now() - this.startTimestampMs;
  }
}

let asyncLocalStorage = new AsyncLocalStorage();
let exporter = (span) => console.log(span);
asyncLocalStorage.enterWith({ traceID: undefined, spanID: undefined });

async function startSpan(name, lambda) {
  let ctx = asyncLocalStorage.getStore();
  let span = new Span(name, ctx, new Map());
  await asyncLocalStorage.run(span.getContext(), lambda, span);
  span.end();
  exporter(span);
}

startSpan("parent", async (span) => {
  span.setAttributes({ outerSpan: true });
  startSpan("child", async (span2) => {
    span2.setAttributes({ outerSpan: false });
  });
});
