/** In-process routing state (lost on gateway restart). */

import { xcConsole } from "./trace-log.js";

export class ClawithMemoryState {
  /** Clawith users.id -> web DM conversation_id (converter) */
  readonly userConversationIds = new Map<string, string>();
  /** conversation_id -> users.id (reverse lookup) */
  readonly conversationUserIds = new Map<string, string>();

  setUserConversation(userId: string, conversationId: string): void {
    void userId;
    void conversationId;
    // const cid = conversationId.trim().toLowerCase();
    // const uid = userId.trim().toLowerCase();
    // const prev = this.userConversationIds.get(uid);
    // if (prev && prev !== cid) {
    //   xcConsole("info", "memory", "userConversation.remap", {
    //     userId: uid,
    //     previousConversationId: prev,
    //     newConversationId: cid,
    //     reason: "binding changed for same user",
    //   });
    //   this.conversationUserIds.delete(prev);
    // } else {
    //   xcConsole("debug", "memory", "userConversation.set", { userId: uid, conversationId: cid });
    // }
    // this.userConversationIds.set(uid, cid);
    // this.conversationUserIds.set(cid, uid);
  }
  setUserConversation2(userId: string, conversationId: string): void {
    const cid = conversationId.trim().toLowerCase();
    const uid = userId.trim().toLowerCase();
    this.userConversationIds.set(uid, cid);
    this.conversationUserIds.set(cid, uid);
  }

  getUserConversation(userId: string): string | undefined {
    return this.userConversationIds.get(userId.trim().toLowerCase());
  }

  getUserIdForConversation(conversationId: string): string | undefined {
    return this.conversationUserIds.get(conversationId.trim().toLowerCase());
  }

  clearAll(): void {
    this.userConversationIds.clear();
    this.conversationUserIds.clear();
    xcConsole("info", "memory", "clearAll", {});
  }
}
