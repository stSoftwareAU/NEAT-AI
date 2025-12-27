import { assertEquals } from "@std/assert";
import {
  getMajorVersion,
  upgradeSemanticVersionIfForwardOnlyConfirmed,
} from "../../src/upgrade/Upgrade.ts";

Deno.test("getMajorVersion(): returns major version, or 0 for invalid/undefined", () => {
  assertEquals(getMajorVersion(undefined), 0);
  assertEquals(getMajorVersion(""), 0);
  assertEquals(getMajorVersion("0.0.1"), 0);
  assertEquals(getMajorVersion("2.0.0"), 2);
  assertEquals(getMajorVersion("4.123.9"), 4);
  assertEquals(getMajorVersion("not-a-version"), 0);
});

Deno.test(
  "upgradeSemanticVersionIfForwardOnlyConfirmed(): bumps 2.x.x/3.x.x to 4.0.0 without downgrading 4.x",
  () => {
    const v2 = { semanticVersion: "2.1.9" };
    upgradeSemanticVersionIfForwardOnlyConfirmed(v2);
    assertEquals(v2.semanticVersion, "4.0.0");

    const v3 = { semanticVersion: "3.0.0" };
    upgradeSemanticVersionIfForwardOnlyConfirmed(v3);
    assertEquals(v3.semanticVersion, "4.0.0");

    const v4 = { semanticVersion: "4.1.2" };
    upgradeSemanticVersionIfForwardOnlyConfirmed(v4);
    assertEquals(v4.semanticVersion, "4.1.2");

    const invalid = { semanticVersion: "2" };
    upgradeSemanticVersionIfForwardOnlyConfirmed(invalid);
    assertEquals(
      invalid.semanticVersion,
      "2",
      "Non-semver inputs should be ignored to avoid accidental upgrades",
    );
  },
);
