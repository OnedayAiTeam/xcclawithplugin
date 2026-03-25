import { fetchGatewayDirectory, type DirectoryItem } from "./directory-api.js";
import type { XcclawithSection } from "./schema.js";
import { xcConsole } from "./trace-log.js";

function findOpenclawRow(items: DirectoryItem[], agentId: string): DirectoryItem | undefined {
  const idl = agentId.trim().toLowerCase();
  return items.find((i) => i.kind === "openclaw" && i.id.trim().toLowerCase() === idl);
}

/**
 * Load directory rows and find `kind=openclaw` with matching `agents.id`.
 * Throws if the row exists and `online === false` (peer longlink not connected).
 * If row missing or `online` omitted/unknown, allow send (backward compatible).
 */
export async function assertPeerAgentOnlineOrThrow(params: {
  section: XcclawithSection;
  agentId: string;
}): Promise<void> {
  const aid = params.agentId.trim();
  let items = (
    await fetchGatewayDirectory({
      section: params.section,
      q: aid,
      limit: 50,
    })
  ).items;
  let row = findOpenclawRow(items, aid);
  if (!row) {
    items = (
      await fetchGatewayDirectory({
        section: params.section,
        limit: 50,
      })
    ).items;
    row = findOpenclawRow(items, aid);
  }
  if (!row) {
    xcConsole("warn", "directory.peer", "openclaw_row_not_found", {
      agentId: aid,
      meaning: "cannot verify online; proceeding with peer send",
    });
    return;
  }
  if (row.online === false) {
    xcConsole("warn", "directory.peer", "peer_offline_blocked", {
      agentId: aid,
      display_name: row.display_name,
    });
    throw new Error(
      `xcclawith_peer_offline: directory reports online=false for agents.id=${aid} (${row.display_name}). Wait until the peer OpenClaw is online before xcclawith_peer_message.`,
    );
  }
  xcConsole("info", "directory.peer", "peer_online_ok", {
    agentId: aid,
    online: row.online ?? null,
  });
}
