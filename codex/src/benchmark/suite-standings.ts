export type SuiteRaceStandingInput = {
  id: string;
  suiteId: string;
  appid: number;
  title: string;
  taskIds: string[];
  matchIds: string[];
  humanUserId: string;
  agentId: string;
  status: "scheduled" | "running" | "scored" | "blocked";
  createdAt: string;
  updatedAt: string;
  winner?: "human" | "agent" | "tie";
  margin?: number;
  humanScore?: number;
  agentScore?: number;
};

export type SuiteRaceLeaderboardEntry = {
  rank: number;
  raceId: string;
  suiteId: string;
  appid: number;
  title: string;
  humanUserId: string;
  agentId: string;
  winner: "human" | "agent" | "tie";
  margin: number;
  humanScore: number;
  agentScore: number;
  taskCount: number;
  matchCount: number;
  completedAt: string;
};

export type SuiteRaceLeaderboard = {
  suiteId: string;
  appid: number;
  title: string;
  raceCount: number;
  humanWins: number;
  agentWins: number;
  ties: number;
  leader: SuiteRaceLeaderboardEntry;
  entries: SuiteRaceLeaderboardEntry[];
};

export type SuiteRaceStandings = {
  totals: {
    races: number;
    scoredRaces: number;
    humanWins: number;
    agentWins: number;
    ties: number;
    humanScore: number;
    agentScore: number;
  };
  leaderboards: SuiteRaceLeaderboard[];
};

function scoredEntry(race: SuiteRaceStandingInput): SuiteRaceLeaderboardEntry | null {
  if (race.status !== "scored" || race.winner === undefined || race.humanScore === undefined || race.agentScore === undefined) {
    return null;
  }
  return {
    rank: 0,
    raceId: race.id,
    suiteId: race.suiteId,
    appid: race.appid,
    title: race.title,
    humanUserId: race.humanUserId,
    agentId: race.agentId,
    winner: race.winner,
    margin: race.margin ?? Math.abs(race.humanScore - race.agentScore),
    humanScore: race.humanScore,
    agentScore: race.agentScore,
    taskCount: race.taskIds.length,
    matchCount: race.matchIds.length,
    completedAt: race.updatedAt
  };
}

function raceScore(entry: SuiteRaceLeaderboardEntry): number {
  return Math.max(entry.humanScore, entry.agentScore);
}

export function buildSuiteRaceStandings(races: SuiteRaceStandingInput[]): SuiteRaceStandings {
  const scoredEntries = races.flatMap((race) => {
    const entry = scoredEntry(race);
    return entry ? [entry] : [];
  });

  const totals = {
    races: races.length,
    scoredRaces: scoredEntries.length,
    humanWins: scoredEntries.filter((entry) => entry.winner === "human").length,
    agentWins: scoredEntries.filter((entry) => entry.winner === "agent").length,
    ties: scoredEntries.filter((entry) => entry.winner === "tie").length,
    humanScore: scoredEntries.reduce((total, entry) => total + entry.humanScore, 0),
    agentScore: scoredEntries.reduce((total, entry) => total + entry.agentScore, 0)
  };

  const bySuite = new Map<string, SuiteRaceLeaderboardEntry[]>();
  for (const entry of scoredEntries) {
    bySuite.set(entry.suiteId, [...(bySuite.get(entry.suiteId) ?? []), entry]);
  }

  const leaderboards = [...bySuite.entries()]
    .map(([suiteId, suiteEntries]) => {
      const entries = [...suiteEntries]
        .sort((a, b) => raceScore(b) - raceScore(a) || b.margin - a.margin || b.completedAt.localeCompare(a.completedAt))
        .map((entry, index) => ({ ...entry, rank: index + 1 }));
      const leader = entries[0];
      return {
        suiteId,
        appid: leader.appid,
        title: leader.title,
        raceCount: entries.length,
        humanWins: entries.filter((entry) => entry.winner === "human").length,
        agentWins: entries.filter((entry) => entry.winner === "agent").length,
        ties: entries.filter((entry) => entry.winner === "tie").length,
        leader,
        entries
      };
    })
    .sort((a, b) => raceScore(b.leader) - raceScore(a.leader) || a.title.localeCompare(b.title));

  return {
    totals,
    leaderboards
  };
}
