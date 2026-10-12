import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type * as Contract from "@couryo/contract";
import { describe, expect, expectTypeOf, it } from "vitest";
import type * as Gen from "../src/types.gen.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("published types (src/types.gen.ts)", () => {
  it("are up to date with the API contract", () => {
    const before = readFileSync(join(root, "src", "types.gen.ts"), "utf8");
    execFileSync(process.execPath, [join(root, "scripts", "gen-types.mjs")], { cwd: root });
    expect(readFileSync(join(root, "src", "types.gen.ts"), "utf8")).toBe(before);
    // The generator loads the whole API (about 10 s on a slow machine): more than the 5 s default.
  }, 60_000);

  it("match the contract types exactly", () => {
    expectTypeOf<Gen.SendEmailRequest>().toEqualTypeOf<Contract.SendEmailRequest>();
    expectTypeOf<Gen.SendEmailResponse>().toEqualTypeOf<Contract.SendEmailResponse>();
    expectTypeOf<Gen.Email>().toEqualTypeOf<Contract.Email>();
    expectTypeOf<Gen.Domain>().toEqualTypeOf<Contract.Domain>();
    expectTypeOf<Gen.Campaign>().toEqualTypeOf<Contract.Campaign>();
    expectTypeOf<Gen.Contact>().toEqualTypeOf<Contract.Contact>();
    expectTypeOf<Gen.WebhookPayload>().toEqualTypeOf<Contract.WebhookPayload>();
    expectTypeOf<Gen.List<Gen.Email>>().toEqualTypeOf<Contract.List<Contract.Email>>();
  });

  it("never import the internal contract from the published code", () => {
    for (const f of ["index.ts", "client.ts", "webhooks.ts", "types.gen.ts"]) {
      expect(readFileSync(join(root, "src", f), "utf8")).not.toContain("@couryo/contract");
    }
  });
});
