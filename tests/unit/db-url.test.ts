import { describe, expect, it } from "vitest";
import { connectionUrl } from "@/lib/db/url";

const BASE = "postgresql://user:p%40ss@ep-x-pooler.sa-east-1.aws.neon.tech/neondb";

describe("connectionUrl", () => {
  it("quita channel_binding de las URLs de Neon y conserva sslmode", () => {
    expect(connectionUrl(`${BASE}?sslmode=require&channel_binding=require`)).toBe(`${BASE}?sslmode=require`);
    expect(connectionUrl(`${BASE}?channel_binding=require&sslmode=require`)).toBe(`${BASE}?sslmode=require`);
    expect(connectionUrl(`${BASE}?a=1&channel_binding=prefer&b=2`)).toBe(`${BASE}?a=1&b=2`);
    expect(connectionUrl(`${BASE}?channel_binding=require`)).toBe(BASE);
  });

  it("deja igual las URLs sin channel_binding", () => {
    expect(connectionUrl(BASE)).toBe(BASE);
    expect(connectionUrl(`${BASE}?sslmode=require`)).toBe(`${BASE}?sslmode=require`);
    expect(connectionUrl("postgres://innovaton:innovaton@localhost:5432/innovaton")).toBe(
      "postgres://innovaton:innovaton@localhost:5432/innovaton",
    );
  });
});
