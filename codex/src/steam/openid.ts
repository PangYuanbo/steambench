export type SteamOpenIdClaim = {
  steamid: string;
  claimedId: string;
};

export type SteamOpenIdVerifier = (params: URLSearchParams) => Promise<SteamOpenIdClaim>;

const steamIdPattern = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

export function extractSteamIdFromClaimedId(claimedId: string): SteamOpenIdClaim {
  const match = steamIdPattern.exec(claimedId);
  if (!match) {
    throw new Error("Steam OpenID claimed_id did not contain a valid 17-digit SteamID.");
  }

  return {
    steamid: match[1],
    claimedId
  };
}

export const verifySteamOpenId: SteamOpenIdVerifier = async (params) => {
  if (params.get("openid.mode") !== "id_res") {
    throw new Error("Steam OpenID callback did not include a positive id_res response.");
  }

  const claimedId = params.get("openid.claimed_id");
  if (!claimedId) {
    throw new Error("Steam OpenID callback is missing openid.claimed_id.");
  }

  const verifyParams = new URLSearchParams(params);
  verifyParams.set("openid.mode", "check_authentication");

  const response = await fetch("https://steamcommunity.com/openid/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Steambench/0.1 (+local prototype)"
    },
    body: verifyParams
  });

  if (!response.ok) {
    throw new Error(`Steam OpenID verification failed with HTTP ${response.status}.`);
  }

  const body = await response.text();
  if (!body.includes("is_valid:true")) {
    throw new Error("Steam OpenID verification was rejected by Steam.");
  }

  return extractSteamIdFromClaimedId(claimedId);
};
