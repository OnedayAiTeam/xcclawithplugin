/** In-process routing state (lost on gateway restart). */

export class ClawithMemoryState {
  /** Clawith user id -> web DM conversation_id */
  readonly userConversationIds = new Map<string, string>();
  /** OpenClaw agent id (peer) -> peer conversation_id */
  readonly peerConversationIds = new Map<string, string>();
  /** OpenClaw agent id -> last new_session_id used for peer thread */
  readonly peerNewSessionIds = new Map<string, string>();

  setUserConversation(userId: string, conversationId: string): void {
    this.userConversationIds.set(userId, conversationId);
  }

  getUserConversation(userId: string): string | undefined {
    return this.userConversationIds.get(userId);
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
