import { z } from "zod";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/core";
import {
  DEFAULT_DIRECTORY_PORT,
  DEFAULT_LONGLINK_PORT,
  DEFAULT_LONGLINK_USER_ID,
} from "./constants.js";

export const xcclawithSectionSchema = z.object({
  host: z.string().min(1),
  apiKey: z.string().min(1),
  directoryPort: z.number().int().positive().optional(),
  longlinkPort: z.number().int().positive().optional(),
  userId: z.string().min(1).optional(),
});

export type XcclawithSection = z.infer<typeof xcclawithSectionSchema>;

export const channelConfigSchema = buildChannelConfigSchema(xcclawithSectionSchema);

export function parseXcclawithSection(raw: unknown): XcclawithSection {
  return xcclawithSectionSchema.parse(raw);
}

export function resolveEffectiveSection(section: XcclawithSection): XcclawithSection & {
  directoryPort: number;
  longlinkPort: number;
  userId: string;
} {
  return {
    ...section,
    directoryPort: section.directoryPort ?? DEFAULT_DIRECTORY_PORT,
    longlinkPort: section.longlinkPort ?? DEFAULT_LONGLINK_PORT,
    userId: section.userId ?? DEFAULT_LONGLINK_USER_ID,
  };
}
