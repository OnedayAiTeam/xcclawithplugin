export const CHANNEL_ID = "xcclawith" as const;

export const LONGLINK_WS_PATH = "/ws";
export const DIRECTORY_HTTP_PATH = "/api/gateway/directory";
export const CONVERTER_HTTP_PATH = "/api/gateway/converter";

export const DEFAULT_DIRECTORY_PORT = 3008;
export const DEFAULT_LONGLINK_PORT = 38438;
export const DEFAULT_LONGLINK_USER_ID = "agent0323";

/** Max wait for `clawith.user_dm_ok` before rejecting outbound sends. */
export const DEFAULT_LONGLINK_ACK_TIMEOUT_MS = 60_000;
