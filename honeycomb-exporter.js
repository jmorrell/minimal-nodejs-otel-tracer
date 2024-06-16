import { Tracing } from "./tracer.js";

function spanToHoneycombJSON(span) {
  return {
    ...Object.fromEntries(Tracing.globalAttributes),
    ...Object.fromEntries(span.attributes),
    name: span.name,
    trace_id: span.traceID,
    span_id: span.spanID,
    parent_span_id: span.parentSpanID,
    start_time: span.startTime,
    elapsed_ms: span.elapsedMs,
  };
}

function honeycombExporter(apiKey) {
  return function (span) {
    fetch(`https://api.honeycomb.io/1/events/${Tracing.name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Honeycomb-Team": apiKey,
        "X-Honeycomb-Event-Time": span.startTime,
      },
      body: JSON.stringify(spanToHoneycombJSON(span)),
    });
  };
}

export default honeycombExporter;
