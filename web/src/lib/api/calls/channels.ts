import type { AdminApiClient } from "../client";
import { parseChannel, parsePermissionOverride, parseSection } from "../parsers";
import {
  deleteResource,
  getJson,
  parseList,
  route,
  sendJson,
  sendVoid,
} from "./http";

type ChannelCalls = Pick<
  AdminApiClient,
  | "createChannel"
  | "updateChannel"
  | "deleteChannel"
  | "reorderChannels"
  | "assignChannelSection"
  | "kickVoiceMember"
  | "moveVoiceMember"
  | "createSection"
  | "updateSection"
  | "deleteSection"
  | "reorderSections"
  | "listPermissionOverrides"
  | "setPermissionOverride"
  | "deletePermissionOverride"
>;

const parseOverrides = parseList(parsePermissionOverride);

/** Channels, the sections that group them, and who may do what in each. */
export function channelCalls(): ChannelCalls {
  return {
    createChannel: (input, signal) =>
      sendJson("POST", "/api/admin/channels", input, parseChannel, signal),

    updateChannel: (channelId, patch, signal) =>
      sendJson("PATCH", route`/api/admin/channels/${channelId}`, patch, parseChannel, signal),

    deleteChannel: (channelId, signal) =>
      deleteResource(route`/api/admin/channels/${channelId}`, signal),

    reorderChannels: (channelIds, signal) =>
      sendVoid("PUT", "/api/admin/channels/order", { channelIds }, signal),

    assignChannelSection: (channelId, sectionId, signal) =>
      sendVoid("PATCH", route`/api/admin/channels/${channelId}/section`, { sectionId }, signal),

    kickVoiceMember: (channelId, userId, signal) =>
      sendVoid(
        "DELETE",
        route`/api/admin/channels/${channelId}/members/${userId}`,
        undefined,
        signal,
      ),

    moveVoiceMember: (sourceChannelId, targetChannelId, userId, signal) =>
      sendVoid(
        "PATCH",
        route`/api/admin/channels/${sourceChannelId}/members/${userId}`,
        { targetChannelId },
        signal,
      ),

    createSection: (input, signal) =>
      sendJson("POST", "/api/admin/sections", input, parseSection, signal),

    updateSection: (sectionId, patch, signal) =>
      sendJson("PATCH", route`/api/admin/sections/${sectionId}`, patch, parseSection, signal),

    deleteSection: (sectionId, signal) =>
      deleteResource(route`/api/admin/sections/${sectionId}`, signal),

    reorderSections: (sectionIds, signal) =>
      sendVoid("PUT", "/api/admin/sections/order", { sectionIds }, signal),

    listPermissionOverrides: (targetType, targetId, signal) =>
      getJson(route`/api/admin/${targetType}s/${targetId}/permissions`, parseOverrides, signal),

    setPermissionOverride: (targetType, targetId, roleId, patch, signal) =>
      sendJson(
        "PUT",
        route`/api/admin/${targetType}s/${targetId}/permissions/${roleId}`,
        patch,
        parsePermissionOverride,
        signal,
      ),

    deletePermissionOverride: (targetType, targetId, roleId, signal) =>
      deleteResource(
        route`/api/admin/${targetType}s/${targetId}/permissions/${roleId}`,
        signal,
      ),
  };
}
