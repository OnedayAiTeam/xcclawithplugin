import * as openclaw_plugin_sdk_core from 'openclaw/plugin-sdk/core';

declare const _default: {
    id: string;
    name: string;
    description: string;
    configSchema: openclaw_plugin_sdk_core.OpenClawPluginConfigSchema;
    register: NonNullable<openclaw_plugin_sdk_core.OpenClawPluginDefinition["register"]>;
} & Pick<openclaw_plugin_sdk_core.OpenClawPluginDefinition, "kind">;

export { _default as default };
