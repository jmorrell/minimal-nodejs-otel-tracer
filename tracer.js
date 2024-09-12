import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

class Tracing {
  static asyncLocalStorage = new AsyncLocalStorage();

  static globalAttributes = new Map();

  static name = "";

  static exporter = (span) => {};

  static getCurrentSpan = () => Tracing.asyncLocalStorage.getStore().span;

  static getContext = () => Tracing.asyncLocalStorage.getStore();

  static async setContext(ctx, cb, ...args) {
    await Tracing.asyncLocalStorage.run(ctx, cb, ...args);
  }

  static async startSpan(name, lambda) {
    let ctx = Tracing.asyncLocalStorage.getStore();
    let span = new Span(name, ctx, new Map([["service.name", Tracing.name]]));
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
    this.durationMs = performance.now() - this.startTimestampMs;
  }
}

let getTraceParent = (ctx) => `00-${ctx.traceID}-${ctx.spanID}-01`;

let parseTraceParent = (header) => ({
  traceID: header.split("-")[1],
  spanID: header.split("-")[2],
});

async function honoMiddleware(c, next) {
  let context = EMPTY_CONTEXT;
  if (c.req.header("traceparent")) {
    context = parseTraceParent(c.req.header("traceparent"));
  }

  await Tracing.setContext(context, async () => {
    await Tracing.startSpan(`${c.req.method} ${c.req.path}`, async (span) => {
      span.setAttributes({
        "http.request.method": c.req.method,
        "http.request.path": c.req.path,
      });

      await next();

      span.setAttributes({
        "http.response.status_code": c.res.status,
      });
    });
  });
}

function patchFetch(originalFetch) {
  return async function patchedFetch(resource, options = {}) {
    let ctx = Tracing.getContext();

    if (!options.headers) {
      options.headers = {};
    }
    options.headers["traceparent"] = getTraceParent(ctx);

    let resp;
    await Tracing.startSpan("fetch", async (span) => {
      span.setAttributes({ "http.url": resource });
      resp = await originalFetch(resource, options);
      span.setAttributes({ "http.response.status_code": resp.status });
    });
    return resp;
  };
}

function toAnyValue(val) {
  if (val instanceof Uint8Array) return { bytesValue: value };
  if (Array.isArray(val))
    return { arrayValue: { values: val.map(toAnyValue) } };
  let t = typeof val;
  if (t === "string") return { stringValue: val };
  if (t === "number") return { doubleValue: val };
  if (t === "boolean") return { boolValue: val };
  if (t === "object" && val != null)
    return {
      kvlistValue: {
        values: Object.entries(val).map(([k, v]) => toKeyValue(k, v)),
      },
    };
  return {};
}

function toKeyValue(key, val) {
  return { key, value: toAnyValue(val) };
}

function toAttributes(attributes) {
  return Object.keys(attributes).map((key) => toKeyValue(key, attributes[key]));
}

function spanToOTLP(span) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: toAttributes(
            Object.fromEntries(Tracing.globalAttributes)
          ),
        },
        scopeSpans: [
          {
            scope: {
              name: "minimal-tracer",
              version: "0.0.1",
              attributes: [],
            },
            spans: [
              {
                traceId: span.traceID,
                spanId: span.spanID,
                parentSpanId: span.parentSpanID,
                name: span.name,
                startTimeUnixNano: span.startTime * Math.pow(10, 6),
                endTimeUnixNano:
                  (span.startTime + span.durationMs) * Math.pow(10, 6),
                kind: 2,
                attributes: toAttributes(Object.fromEntries(span.attributes)),
              },
            ],
          },
        ],
      },
    ],
  };
}

function otlpExporter(url, headers) {
  return function (span) {
    fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(spanToOTLP(span)),
    });
  };
}

export { Tracing, Span, honoMiddleware, patchFetch, otlpExporter };
