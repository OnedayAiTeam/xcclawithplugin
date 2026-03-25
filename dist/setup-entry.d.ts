import * as openclaw_plugin_sdk_channel_send_result from 'openclaw/plugin-sdk/channel-send-result';
import * as openclaw_plugin_sdk_channel_runtime from 'openclaw/plugin-sdk/channel-runtime';
import * as openclaw_plugin_sdk_core from 'openclaw/plugin-sdk/core';
import * as openclaw_plugin_sdk from 'openclaw/plugin-sdk';
import { z } from 'zod';

declare const xcclawithSectionSchema: z.ZodObject<{
    host: z.ZodString;
    apiKey: z.ZodString;
    directoryPort: z.ZodOptional<z.ZodNumber>;
    longlinkPort: z.ZodOptional<z.ZodNumber>;
    userId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type XcclawithSection = z.infer<typeof xcclawithSectionSchema>;

type DirectoryItem = {
    kind: "user" | "openclaw";
    id: string;
    display_name: string;
    username?: string | null;
    email?: string | null;
    creator_user_id?: string | null;
};

type ResolvedXcclawith = XcclawithSection & {
    accountId: string;
};

declare const _default: {
    plugin: {
        messaging: {
            targetResolver: {
                looksLikeId: (_raw: string, normalized?: string) => boolean;
                hint: string;
            };
        };
        agentPrompt: {
            messageToolHints: () => string[];
        };
        gateway: {
            startAccount: (ctx: openclaw_plugin_sdk.ChannelGatewayContext<ResolvedXcclawith>) => Promise<void>;
            stopAccount: (ctx: openclaw_plugin_sdk.ChannelGatewayContext<ResolvedXcclawith>) => Promise<void>;
        };
        directory: {
            listPeersLive: (params: {
                cfg: openclaw_plugin_sdk_core.OpenClawConfig;
                accountId?: string | null;
                query?: string | null;
                limit?: number | null;
                runtime: openclaw_plugin_sdk.RuntimeEnv;
            }) => Promise<{
                kind: "channel" | "user";
                id: string;
                name: string;
                handle: string | undefined;
                raw: DirectoryItem;
            }[]>;
        };
        id: openclaw_plugin_sdk.ChannelId;
        meta: openclaw_plugin_sdk_channel_runtime.ChannelMeta;
        capabilities: openclaw_plugin_sdk.ChannelCapabilities;
        defaults?: {
            queue?: {
                debounceMs?: number;
            };
        };
        reload?: {
            configPrefixes: string[];
            noopPrefixes?: string[];
        };
        setupWizard?: openclaw_plugin_sdk.ChannelSetupWizard;
        config: openclaw_plugin_sdk_channel_runtime.ChannelConfigAdapter<ResolvedXcclawith>;
        configSchema?: openclaw_plugin_sdk.ChannelConfigSchema;
        setup?: openclaw_plugin_sdk.ChannelSetupAdapter;
        pairing?: openclaw_plugin_sdk_channel_runtime.ChannelPairingAdapter;
        security?: openclaw_plugin_sdk_channel_runtime.ChannelSecurityAdapter<ResolvedXcclawith> | undefined;
        groups?: openclaw_plugin_sdk_channel_runtime.ChannelGroupAdapter;
        mentions?: openclaw_plugin_sdk_channel_runtime.ChannelMentionAdapter;
        outbound?: openclaw_plugin_sdk_channel_send_result.ChannelOutboundAdapter;
        status?: openclaw_plugin_sdk_channel_runtime.ChannelStatusAdapter<ResolvedXcclawith, unknown, unknown> | undefined;
        gatewayMethods?: string[];
        auth?: openclaw_plugin_sdk_channel_runtime.ChannelAuthAdapter;
        elevated?: openclaw_plugin_sdk_channel_runtime.ChannelElevatedAdapter;
        commands?: openclaw_plugin_sdk_channel_runtime.ChannelCommandAdapter;
        lifecycle?: openclaw_plugin_sdk_channel_runtime.ChannelLifecycleAdapter;
        execApprovals?: openclaw_plugin_sdk_channel_runtime.ChannelExecApprovalAdapter;
        allowlist?: openclaw_plugin_sdk_channel_runtime.ChannelAllowlistAdapter;
        bindings?: openclaw_plugin_sdk.ChannelConfiguredBindingProvider;
        streaming?: openclaw_plugin_sdk_channel_runtime.ChannelStreamingAdapter;
        threading?: openclaw_plugin_sdk_channel_runtime.ChannelThreadingAdapter;
        resolver?: openclaw_plugin_sdk_channel_runtime.ChannelResolverAdapter;
        actions?: openclaw_plugin_sdk.ChannelMessageActionAdapter;
        heartbeat?: openclaw_plugin_sdk_channel_runtime.ChannelHeartbeatAdapter;
        agentTools?: openclaw_plugin_sdk.ChannelAgentToolFactory | openclaw_plugin_sdk.ChannelAgentTool[];
    };
};

export { _default as default };
