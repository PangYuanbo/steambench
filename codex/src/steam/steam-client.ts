import { z } from "zod";
import type { SteamAchievement, SteamLeaderboardDefinition, SteamStatDefinition } from "../benchmark/types";

const appListSchema = z.object({
  applist: z.object({
    apps: z.array(
      z.object({
        appid: z.number(),
        name: z.string()
      })
    )
  })
});

const globalAchievementSchema = z.object({
  achievementpercentages: z.object({
    achievements: z.array(
      z.object({
        name: z.string(),
        percent: z.number()
      })
    )
  })
});

const playerAchievementsSchema = z.object({
  playerstats: z.object({
    achievements: z
      .array(
        z.object({
          apiname: z.string(),
          achieved: z.number(),
          unlocktime: z.number().optional(),
          name: z.string().optional(),
          description: z.string().optional()
        })
      )
      .optional()
  })
});

const gameSchemaResponseSchema = z.object({
  game: z.object({
    gameName: z.string().optional(),
    gameVersion: z.string().optional(),
    availableGameStats: z
      .object({
        achievements: z.array(z.unknown()).optional(),
        stats: z
          .array(
            z.object({
              name: z.string(),
              displayName: z.string().optional(),
              defaultvalue: z.union([z.number(), z.string()]).optional()
            })
          )
          .optional()
      })
      .optional()
  })
});

const leaderboardsForGameSchema = z.object({
  response: z.object({
    leaderboards: z
      .array(
        z.object({
          id: z.union([z.number(), z.string()]),
          name: z.string(),
          entries: z.union([z.number(), z.string()]).optional(),
          sortmethod: z.string().optional(),
          displaytype: z.string().optional(),
          onlytrustedwrites: z.union([z.boolean(), z.number(), z.string()]).optional(),
          onlyfriendsreads: z.union([z.boolean(), z.number(), z.string()]).optional()
        })
      )
      .optional()
  })
});

export type SteamAppSummary = {
  appid: number;
  name: string;
};

export type SteamCacheEntrySummary = {
  key: string;
  source: SteamMetadataSource;
  fetchedAt: string;
  expiresAt: string;
  ttlSeconds: number;
  expired: boolean;
};

export type SteamMetadataSource = "steam-live" | "steam-cache";

export type SteamFetchMeta = {
  source: SteamMetadataSource;
  endpoint: string;
  fetchedAt: string;
  expiresAt: string;
  ttlSeconds: number;
};

export type SteamFetchResult<T> = {
  data: T;
  meta: SteamFetchMeta;
};

export type SteamGameSchema = {
  gameName?: string;
  gameVersion?: string;
  stats: SteamStatDefinition[];
};

export type SteamLeaderboardCatalog = {
  leaderboards: SteamLeaderboardDefinition[];
};

export type SteamFetchOptions = {
  forceRefresh?: boolean;
  ttlMs?: number;
};

type SteamCacheEntry<T> = {
  value: T;
  fetchedAtMs: number;
  expiresAtMs: number;
  endpoint: string;
  ttlSeconds: number;
};

const defaultTtlMs = 6 * 60 * 60 * 1000;
const appListCacheKey = "steam-app-list";
const steamMetadataCache = new Map<string, SteamCacheEntry<unknown>>();

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function ttlMsFor(options?: SteamFetchOptions): number {
  return options?.ttlMs && Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : defaultTtlMs;
}

async function readJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Steambench/0.1 (+local prototype)"
    }
  });

  if (!response.ok) {
    throw new Error(`Steam API request failed ${response.status}: ${url}`);
  }

  return schema.parse(await response.json());
}

async function readCachedJson<T>(
  cacheKey: string,
  endpoint: string,
  schema: z.ZodType<T>,
  options?: SteamFetchOptions,
  metaEndpoint = endpoint
): Promise<SteamFetchResult<T>> {
  const ttlMs = ttlMsFor(options);
  const now = Date.now();
  const cached = steamMetadataCache.get(cacheKey) as SteamCacheEntry<T> | undefined;
  if (cached && !options?.forceRefresh && cached.expiresAtMs > now) {
    return {
      data: cached.value,
      meta: {
        source: "steam-cache",
        endpoint: cached.endpoint,
        fetchedAt: iso(cached.fetchedAtMs),
        expiresAt: iso(cached.expiresAtMs),
        ttlSeconds: cached.ttlSeconds
      }
    };
  }

  const value = await readJson(endpoint, schema);
  const fetchedAtMs = Date.now();
  const expiresAtMs = fetchedAtMs + ttlMs;
  const entry: SteamCacheEntry<T> = {
    value,
    fetchedAtMs,
    expiresAtMs,
    endpoint: metaEndpoint,
    ttlSeconds: Math.round(ttlMs / 1000)
  };
  steamMetadataCache.set(cacheKey, entry);
  return {
      data: value,
      meta: {
        source: "steam-live",
        endpoint: metaEndpoint,
        fetchedAt: iso(fetchedAtMs),
        expiresAt: iso(expiresAtMs),
        ttlSeconds: entry.ttlSeconds
    }
  };
}

export function clearSteamMetadataCache(): void {
  steamMetadataCache.clear();
}

export function getSteamMetadataCacheSnapshot(now = Date.now()): SteamCacheEntrySummary[] {
  return [...steamMetadataCache.entries()]
    .map(([key, entry]) => ({
      key,
      source: "steam-cache" as const,
      fetchedAt: iso(entry.fetchedAtMs),
      expiresAt: iso(entry.expiresAtMs),
      ttlSeconds: entry.ttlSeconds,
      expired: entry.expiresAtMs <= now
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function buildSteamDataPolicyReport() {
  return {
    allowedSources: [
      "ISteamApps/GetAppList/v2",
      "ISteamUserStats/GetGlobalAchievementPercentagesForApp",
      "ISteamUserStats/GetSchemaForGame/v2",
      "ISteamLeaderboards/GetLeaderboardsForGame/v2",
      "ISteamUserStats/GetPlayerAchievements"
    ],
    scoringTruth: "Steam achievement proof and reviewed run evidence remain authoritative; CDN media and search results are enrichment only.",
    cache: {
      defaultTtlSeconds: Math.round(defaultTtlMs / 1000),
      entries: getSteamMetadataCacheSnapshot()
    },
    userData: {
      steamWebApiKeyServerSideOnly: true,
      linkedPlayerAchievementsRequireSteamId: true,
      proofConsentRequiredBeforePublicRanking: true
    },
    rateLimitPosture: "Prototype in-memory TTL cache avoids repeated broad Steam catalog and achievement metadata calls during local review."
  };
}

export async function fetchSteamAppListWithMeta(options?: SteamFetchOptions): Promise<SteamFetchResult<SteamAppSummary[]>> {
  const endpoint = "https://api.steampowered.com/ISteamApps/GetAppList/v2/";
  const payload = await readCachedJson(appListCacheKey, endpoint, appListSchema, options);
  return {
    data: payload.data.applist.apps.filter((app) => app.name.trim().length > 0),
    meta: payload.meta
  };
}

export async function fetchSteamAppList(options?: SteamFetchOptions): Promise<SteamAppSummary[]> {
  return (await fetchSteamAppListWithMeta(options)).data;
}

export async function searchSteamAppsWithMeta(query: string, limit = 20, options?: SteamFetchOptions): Promise<SteamFetchResult<SteamAppSummary[]>> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return {
      data: [],
      meta: {
        source: "steam-cache",
        endpoint: "ISteamApps/GetAppList/v2",
        fetchedAt: iso(Date.now()),
        expiresAt: iso(Date.now()),
        ttlSeconds: 0
      }
    };
  }

  const apps = await fetchSteamAppListWithMeta(options);
  return {
    data: apps.data.filter((app) => app.name.toLowerCase().includes(normalized)).slice(0, limit),
    meta: apps.meta
  };
}

export async function searchSteamApps(query: string, limit = 20, options?: SteamFetchOptions): Promise<SteamAppSummary[]> {
  return (await searchSteamAppsWithMeta(query, limit, options)).data;
}

export async function fetchGlobalAchievementPercentagesWithMeta(appid: number, options?: SteamFetchOptions): Promise<SteamFetchResult<SteamAchievement[]>> {
  const endpoint =
    `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/` +
    `?gameid=${encodeURIComponent(String(appid))}`;
  const payload = await readCachedJson(`global-achievements:${appid}`, endpoint, globalAchievementSchema, options);
  return {
    data: payload.data.achievementpercentages.achievements.map((achievement) => ({
      apiName: achievement.name,
      displayName: achievement.name,
      percent: achievement.percent
    })),
    meta: payload.meta
  };
}

export async function fetchGlobalAchievementPercentages(appid: number, options?: SteamFetchOptions): Promise<SteamAchievement[]> {
  return (await fetchGlobalAchievementPercentagesWithMeta(appid, options)).data;
}

export async function fetchSteamGameSchemaWithMeta(params: {
  appid: number;
  apiKey?: string;
}, options?: SteamFetchOptions): Promise<SteamFetchResult<SteamGameSchema>> {
  if (!params.apiKey) {
    throw new Error("STEAM_WEB_API_KEY is required to fetch Steam game schema metadata.");
  }

  const url =
    `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/` +
    `?key=${encodeURIComponent(params.apiKey)}` +
    `&appid=${encodeURIComponent(String(params.appid))}` +
    `&l=en`;
  const metaEndpoint =
    `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/` +
    `?key=<server-side>` +
    `&appid=${encodeURIComponent(String(params.appid))}` +
    `&l=en`;

  const payload = await readCachedJson(
    `game-schema:${params.appid}`,
    url,
    gameSchemaResponseSchema,
    options,
    metaEndpoint
  );
  return {
    data: {
      gameName: payload.data.game.gameName,
      gameVersion: payload.data.game.gameVersion,
      stats: (payload.data.game.availableGameStats?.stats ?? []).map((stat) => {
        const defaultValue = stat.defaultvalue === undefined ? undefined : Number(stat.defaultvalue);
        return {
          apiName: stat.name,
          displayName: stat.displayName,
          defaultValue: Number.isFinite(defaultValue) ? defaultValue : undefined
        };
      })
    },
    meta: payload.meta
  };
}

function boolValue(value: boolean | number | string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return undefined;
}

export async function fetchSteamLeaderboardsForGameWithMeta(params: {
  appid: number;
  apiKey?: string;
}, options?: SteamFetchOptions): Promise<SteamFetchResult<SteamLeaderboardCatalog>> {
  if (!params.apiKey) {
    throw new Error("STEAM_WEB_API_KEY is required to fetch Steam leaderboard metadata.");
  }

  const url =
    `https://partner.steam-api.com/ISteamLeaderboards/GetLeaderboardsForGame/v2/` +
    `?key=${encodeURIComponent(params.apiKey)}` +
    `&appid=${encodeURIComponent(String(params.appid))}`;
  const metaEndpoint =
    `https://partner.steam-api.com/ISteamLeaderboards/GetLeaderboardsForGame/v2/` +
    `?key=<server-side>` +
    `&appid=${encodeURIComponent(String(params.appid))}`;

  const payload = await readCachedJson(
    `leaderboards:${params.appid}`,
    url,
    leaderboardsForGameSchema,
    options,
    metaEndpoint
  );
  return {
    data: {
      leaderboards: (payload.data.response.leaderboards ?? []).map((leaderboard) => {
        const entryCount = leaderboard.entries === undefined ? undefined : Number(leaderboard.entries);
        return {
          id: String(leaderboard.id),
          name: leaderboard.name,
          displayName: leaderboard.name,
          sortMethod: leaderboard.sortmethod,
          displayType: leaderboard.displaytype,
          entryCount: Number.isFinite(entryCount) ? entryCount : undefined,
          onlyTrustedWrites: boolValue(leaderboard.onlytrustedwrites),
          onlyFriendsReads: boolValue(leaderboard.onlyfriendsreads)
        };
      })
    },
    meta: payload.meta
  };
}

export type SteamPlayerAchievement = {
  apiName: string;
  achieved: boolean;
  unlockTime?: number;
  displayName?: string;
  description?: string;
};

export async function fetchPlayerAchievementsWithMeta(params: {
  appid: number;
  steamid: string;
  apiKey?: string;
}, options?: SteamFetchOptions): Promise<SteamFetchResult<SteamPlayerAchievement[]>> {
  if (!params.apiKey) {
    throw new Error("STEAM_WEB_API_KEY is required to fetch player achievement proof.");
  }

  const url =
    `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/` +
    `?key=${encodeURIComponent(params.apiKey)}` +
    `&steamid=${encodeURIComponent(params.steamid)}` +
    `&appid=${encodeURIComponent(String(params.appid))}` +
    `&l=en`;
  const metaEndpoint =
    `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/` +
    `?key=<server-side>` +
    `&steamid=${encodeURIComponent(params.steamid)}` +
    `&appid=${encodeURIComponent(String(params.appid))}` +
    `&l=en`;

  const payload = await readCachedJson(
    `player-achievements:${params.appid}:${params.steamid}`,
    url,
    playerAchievementsSchema,
    options,
    metaEndpoint
  );
  return {
    data: (payload.data.playerstats.achievements ?? []).map((achievement) => ({
      apiName: achievement.apiname,
      achieved: achievement.achieved === 1,
      unlockTime: achievement.unlocktime,
      displayName: achievement.name,
      description: achievement.description
    })),
    meta: payload.meta
  };
}

export async function fetchPlayerAchievements(params: {
  appid: number;
  steamid: string;
  apiKey?: string;
}): Promise<SteamPlayerAchievement[]> {
  return (await fetchPlayerAchievementsWithMeta(params)).data;
}
