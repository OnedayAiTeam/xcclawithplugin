import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { xcclawithChannelPlugin } from "./src/channel.js";
import { registerXcclawithTools } from "./src/tools.js";
import { CHANNEL_ID } from "./src/constants.js";
export default defineChannelPluginEntry({
  id: CHANNEL_ID,
  name: "Clawith Longlink",
  description: "Clawith Longlink channel: web DMs and peer OpenClaw over WebSocket.",
  plugin: xcclawithChannelPlugin,
  registerFull(api) {
    registerXcclawithTools(api);
  },
});
