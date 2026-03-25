/** In-process routing state (lost on gateway restart). */

import { xcConsole } from "./trace-log.js";

export class ClawithMemoryState {
  /** Clawith users.id -> web DM conversation_id (converter) */
  readonly userConversationIds = new Map<string, string>();
  /** conversation_id -> users.id (reverse lookup) */
  readonly conversationUserIds = new Map<string, string>();
  /** OpenClaw agent id (peer) -> peer conversation_id */
  readonly peerConversationIds = new Map<string, string>();
  /** OpenClaw agent id -> last new_session_id used for peer thread */
  readonly peerNewSessionIds = new Map<string, string>();

  setUserConversation(userId: string, conversationId: string): void {
    const cid = conversationId.trim().toLowerCase();
    const uid = userId.trim().toLowerCase();
    const prev = this.userConversationIds.get(uid);
    if (prev && prev !== cid) {
      xcConsole("info", "memory", "userConversation.remap", {
        userId: uid,
        previousConversationId: prev,
        newConversationId: cid,
        reason: "binding changed for same user",
      });
      this.conversationUserIds.delete(prev);
    } else {
      xcConsole("debug", "memory", "userConversation.set", { userId: uid, conversationId: cid });
    }
    this.userConversationIds.set(uid, cid);
    this.conversationUserIds.set(cid, uid);
  }

  getUserConversation(userId: string): string | undefined {
    return this.userConversationIds.get(userId.trim().toLowerCase());
  }

  getUserIdForConversation(conversationId: string): string | undefined {
    return this.conversationUserIds.get(conversationId.trim().toLowerCase());
  }

  setPeerConversation(agentId: string, conversationId: string): void {
    const aid = agentId.trim().toLowerCase();
    xcConsole("info", "memory", "peerConversation.set", { agentId: aid, conversationId });
    this.peerConversationIds.set(aid, conversationId.trim());
  }

  getPeerConversation(agentId: string): string | undefined {
    return this.peerConversationIds.get(agentId.trim().toLowerCase());
  }

  setPeerNewSession(agentId: string, sessionId: string): void {
    const aid = agentId.trim().toLowerCase();
    xcConsole("info", "memory", "peerNewSession.set", { agentId: aid, sessionId });
    this.peerNewSessionIds.set(aid, sessionId);
  }

  getPeerNewSession(agentId: string): string | undefined {
    return this.peerNewSessionIds.get(agentId.trim().toLowerCase());
  }

  clearAll(): void {
    this.userConversationIds.clear();
    this.conversationUserIds.clear();
    this.peerConversationIds.clear();
    this.peerNewSessionIds.clear();
    xcConsole("info", "memory", "clearAll", {});
  }
}
