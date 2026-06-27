import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSteamMetadataCache,
  fetchGlobalAchievementPercentagesWithMeta,
  fetchSteamGameSchemaWithMeta,
  fetchSteamLeaderboardsForGameWithMeta,
  getSteamMetadataCacheSnapshot,
  searchSteamAppsWithMeta
} from "./steam-client";

function stubSteamJson(payload: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => payload
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  clearSteamMetadataCache();
  vi.unstubAllGlobals();
});

describe("Steam metadata cache", () => {
  it("caches the broad Steam app list behind search results", async () => {
    const fetchMock = stubSteamJson({
      applist: {
        apps: [
          { appid: 620, name: "Portal 2" },
          { appid: 400, name: "Portal" },
          { appid: 10, name: "" }
        ]
      }
    });

    const first = await searchSteamAppsWithMeta("portal");
    const second = await searchSteamAppsWithMeta("portal");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.meta.source).toBe("steam-live");
    expect(second.meta.source).toBe("steam-cache");
    expect(second.data.map((app) => app.appid)).toEqual([620, 400]);
    expect(getSteamMetadataCacheSnapshot()).toMatchObject([
      {
        key: "steam-app-list",
        expired: false
      }
    ]);
  });

  it("refreshes global achievement metadata on demand", async () => {
    const fetchMock = stubSteamJson({
      achievementpercentages: {
        achievements: [
          { name: "ACH.PORTAL_CONSERVATION", percent: 12.5 }
        ]
      }
    });

    const first = await fetchGlobalAchievementPercentagesWithMeta(620);
    const second = await fetchGlobalAchievementPercentagesWithMeta(620);
    const refreshed = await fetchGlobalAchievementPercentagesWithMeta(620, { forceRefresh: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.meta.source).toBe("steam-live");
    expect(second.meta.source).toBe("steam-cache");
    expect(refreshed.meta.source).toBe("steam-live");
    expect(refreshed.data[0]).toMatchObject({
      apiName: "ACH.PORTAL_CONSERVATION",
      percent: 12.5
    });
  });

  it("fetches and caches Steam game stat schema with server-side key redaction", async () => {
    const fetchMock = stubSteamJson({
      game: {
        gameName: "Portal 2",
        gameVersion: "42",
        availableGameStats: {
          stats: [
            { name: "PORTALS_PLACED", displayName: "Portals Placed", defaultvalue: "0" }
          ]
        }
      }
    });

    const first = await fetchSteamGameSchemaWithMeta({ appid: 620, apiKey: "secret-key" });
    const second = await fetchSteamGameSchemaWithMeta({ appid: 620, apiKey: "secret-key" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("key=secret-key");
    expect(first.meta.source).toBe("steam-live");
    expect(first.meta.endpoint).toContain("key=<server-side>");
    expect(first.meta.endpoint).not.toContain("secret-key");
    expect(second.meta.source).toBe("steam-cache");
    expect(second.data).toMatchObject({
      gameName: "Portal 2",
      gameVersion: "42",
      stats: [
        {
          apiName: "PORTALS_PLACED",
          displayName: "Portals Placed",
          defaultValue: 0
        }
      ]
    });
    expect(getSteamMetadataCacheSnapshot()).toMatchObject([
      {
        key: "game-schema:620",
        expired: false
      }
    ]);
  });

  it("fetches Steam leaderboard metadata from the partner API with key redaction", async () => {
    const fetchMock = stubSteamJson({
      response: {
        leaderboards: [
          {
            id: "12345",
            name: "challenge_mode_time",
            entries: "5000",
            sortmethod: "Ascending",
            displaytype: "TimeMilliSeconds",
            onlytrustedwrites: 0,
            onlyfriendsreads: "false"
          }
        ]
      }
    });

    const first = await fetchSteamLeaderboardsForGameWithMeta({ appid: 620, apiKey: "publisher-secret" });
    const second = await fetchSteamLeaderboardsForGameWithMeta({ appid: 620, apiKey: "publisher-secret" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("partner.steam-api.com");
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("key=publisher-secret");
    expect(first.meta.endpoint).toContain("key=<server-side>");
    expect(first.meta.endpoint).not.toContain("publisher-secret");
    expect(second.meta.source).toBe("steam-cache");
    expect(first.data.leaderboards[0]).toMatchObject({
      id: "12345",
      name: "challenge_mode_time",
      displayName: "challenge_mode_time",
      sortMethod: "Ascending",
      displayType: "TimeMilliSeconds",
      entryCount: 5000,
      onlyTrustedWrites: false,
      onlyFriendsReads: false
    });
    expect(getSteamMetadataCacheSnapshot()).toMatchObject([
      {
        key: "leaderboards:620",
        expired: false
      }
    ]);
  });
});
