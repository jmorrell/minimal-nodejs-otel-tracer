import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Tracing, honoMiddleware, patchFetch, otlpExporter } from "./tracer.js";
import honeycombExporter from "./honeycomb-exporter.js";

Tracing.name = "demo-app";
Tracing.globalAttributes = new Map([["service.name", "demo-app"]]);
Tracing.exporter = otlpExporter("https://api.honeycomb.io/v1/traces", {
  "X-Honeycomb-Team": process.env.HONEYCOMB_API_KEY,
});

let app = new Hono();

// add the auto-instrumentation, in a production library
// this would happen behind-the-scenes
let patchedFetch = patchFetch(fetch);
app.use(honoMiddleware);

app.get("/user/:id", async (c) => {
  // pretend to call another service
  let user_response = await patchedFetch(
    `${new URL(c.req.url).origin}/user_info/${c.req.param("id")}`
  );

  let user = await user_response.json();

  let span = Tracing.getCurrentSpan();
  span.setAttributes({
    "user.id": user.id,
    "user.name": user.name,
    "user.org": user.org,
    "user.team": user.team,
  });

  return c.text(`Hello ${user.name}!`);
});

app.get("/user_info/:id", async (c) => {
  // pretend to pull this from a db
  await Tracing.startSpan("db query", async (span) => {
    span.setAttributes({
      "db.query": "SELECT * FROM table LIMIT 1",
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  return c.json({
    id: c.req.param("id"),
    name: "username",
    org: "org name",
    team: "team name",
  });
});

serve({
  fetch: app.fetch,
  port: process.env.PORT || 3000,
});
