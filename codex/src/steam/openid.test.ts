import { describe, expect, it } from "vitest";
import { extractSteamIdFromClaimedId } from "./openid";

describe("Steam OpenID helpers", () => {
  it("extracts a 17-digit SteamID from the claimed_id URL", () => {
    expect(extractSteamIdFromClaimedId("https://steamcommunity.com/openid/id/76561198000000000")).toEqual({
      steamid: "76561198000000000",
      claimedId: "https://steamcommunity.com/openid/id/76561198000000000"
    });
  });

  it("rejects malformed claimed_id values", () => {
    expect(() => extractSteamIdFromClaimedId("https://example.com/openid/id/76561198000000000")).toThrow(/valid/);
    expect(() => extractSteamIdFromClaimedId("https://steamcommunity.com/openid/id/not-a-steamid")).toThrow(/valid/);
  });
});
