import type { AdminApiClient } from "../client";
import { parseInvite, parseRole, parseServerBan, parseServerMember } from "../parsers";
import {
  deleteResource,
  getJson,
  parseList,
  route,
  sendJson,
  sendVoid,
} from "./http";

type MemberCalls = Pick<
  AdminApiClient,
  | "listRoles"
  | "createRole"
  | "updateRole"
  | "deleteRole"
  | "listServerMembers"
  | "assignRole"
  | "kickMember"
  | "listBans"
  | "banMember"
  | "unbanMember"
  | "listInvites"
  | "createInvite"
  | "revokeInvite"
  | "sendInvite"
>;

const parseRoles = parseList(parseRole);
const parseMembers = parseList(parseServerMember);
const parseBans = parseList(parseServerBan);
const parseInvites = parseList(parseInvite);

/** Roles, members, bans and invites: who belongs to the server and how. */
export function memberCalls(): MemberCalls {
  return {
    listRoles: (signal) => getJson("/api/admin/roles", parseRoles, signal),

    createRole: (input, signal) =>
      sendJson("POST", "/api/admin/roles", input, parseRole, signal),

    updateRole: (roleId, patch, signal) =>
      sendJson("PATCH", route`/api/admin/roles/${roleId}`, patch, parseRole, signal),

    deleteRole: (roleId, signal) => deleteResource(route`/api/admin/roles/${roleId}`, signal),

    listServerMembers: (signal) => getJson("/api/admin/members", parseMembers, signal),

    assignRole: (userId, roleId, signal) =>
      sendVoid("PATCH", route`/api/admin/members/${userId}/role`, { roleId }, signal),

    kickMember: (userId, signal) =>
      sendVoid("DELETE", route`/api/admin/members/${userId}`, undefined, signal),

    listBans: (signal) => getJson("/api/admin/bans", parseBans, signal),

    banMember: (userId, reason, signal) =>
      sendVoid(
        "POST",
        route`/api/admin/members/${userId}/ban`,
        { reason: reason ?? null },
        signal,
      ),

    unbanMember: (userId, signal) => deleteResource(route`/api/admin/bans/${userId}`, signal),

    listInvites: (signal) => getJson("/api/admin/invites", parseInvites, signal),

    createInvite: (signal) =>
      sendJson("POST", "/api/admin/invites", undefined, parseInvite, signal),

    revokeInvite: (inviteId, signal) =>
      deleteResource(route`/api/admin/invites/${inviteId}`, signal),

    sendInvite: (inviteId, userId, signal) =>
      sendVoid("POST", route`/api/admin/invites/${inviteId}/members/${userId}`, undefined, signal),
  };
}
