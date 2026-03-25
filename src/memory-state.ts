/** In-process routing state (lost on gateway restart). */

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
    if (prev && prev !== cid) this.conversationUserIds.delete(prev);
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
    this.peerConversationIds.set(agentId, conversationId);
  }

  getPeerConversation(agentId: string): string | undefined {
    return this.peerConversationIds.get(agentId);
  }

  setPeerNewSession(agentId: string, sessionId: string): void {
    this.peerNewSessionIds.set(agentId, sessionId);
  }

  getPeerNewSession(agentId: string): string | undefined {
    return this.peerNewSessionIds.get(agentId);
  }
}
