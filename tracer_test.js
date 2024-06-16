import { suite, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import { Tracing, Span } from "./tracer.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

suite("Span", () => {
  test("new span", () => {
    let span = new Span("test");
    span.setAttributes({
      foo: "bar",
      baz: "potato",
    });
    assert.ok(span.startTime);

    span.end();

    assert(span.name == "test");
    assert(span.attributes.get("foo") == "bar");
    assert(span.attributes.get("baz") == "potato");
    assert.ok(span.stopTime);
  });

  test("inherit span context", () => {
    let ctx = {
      traceID: "12345",
      spanID: "45678",
    };
    let span = new Span("test", ctx);

    assert.equal(span.traceID, "12345");
    assert.equal(span.parentSpanID, "45678");
  });
});

suite("Tracing", async () => {
  let prevExporter;
  let spans = [];

  before(() => {
    prevExporter = Tracing.exporter;
  });

  after(() => {
    Tracing.exporter = prevExporter;
  });

  beforeEach(() => {
    Tracing.exporter = (span) => {
      spans.push(span);
    };
  });

  afterEach(() => {
    // clear the array, but keep the reference
    spans.splice(0, spans.length);
  });

  test("start span", () => {
    Tracing.startSpan("parent", (span) => {
      assert.equal(span, Tracing.getCurrentSpan());
      assert.equal("parent", Tracing.getCurrentSpan().name);
    });

    assert.equal(undefined, Tracing.getCurrentSpan());
  });

  test("start span nested", () => {
    Tracing.startSpan("parent", (span) => {
      assert.equal(span, Tracing.getCurrentSpan());

      Tracing.startSpan("child", (span2) => {
        assert.equal(span2, Tracing.getCurrentSpan());
        assert.equal(span2.parentSpanID, span.spanID);
      });

      assert.equal(span, Tracing.getCurrentSpan());
    });

    assert.equal(undefined, Tracing.getCurrentSpan());
  });

  test("spans captured", () => {
    // Because we must also support async use cases, this triggers an
    // await internal to startSpan, which yields to the event loop.
    // Exporting spans then becomes async even in the synchronous use-case,
    // so we must also yield to the event loop before we can make this
    // assertion.
    //
    // In practice, this difference can be ignored since we only care
    // that spans are emitted soon after execution
    let promise = Tracing.startSpan("parent", (span) => {
      Tracing.startSpan("child", (span2) => {});
    });

    Promise.resolve(promise).then(() => {
      assert.equal(2, spans.length);
      // the child is the first span to close, so it should be first
      assert.equal("child", spans[0].name);
      assert.equal("parent", spans[1].name);
    });
  });
});

suite("async tracing", () => {
  let prevExporter;
  let spans = [];

  before(() => {
    prevExporter = Tracing.exporter;
  });

  after(() => {
    Tracing.exporter = prevExporter;
  });

  beforeEach(() => {
    Tracing.exporter = (span) => {
      spans.push(span);
    };
  });

  afterEach(() => {
    // clear the array, but keep the reference
    spans.splice(0, spans.length);
  });

  test("async spans captured", async () => {
    await Tracing.startSpan("parent", async (span) => {
      await sleep(10);
      await Tracing.startSpan("child", async (span2) => {
        await sleep(10);
      });
      await sleep(10);
    });

    assert.equal(2, spans.length);
    // the child is the first span to close, so it should be first
    assert.equal("child", spans[0].name);
    assert.equal("parent", spans[1].name);
  });
});
