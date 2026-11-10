import type { AdminApiClient, ApiClient } from "../client";
import { expectRecord, expectString } from "../expect";
import {
  parseAuditEntry,
  parseNotificationSettings,
  parseServer,
} from "../parsers";
import type { Parse } from "./http";
import {
  deleteResource,
  fileForm,
  getJson,
  parseList,
  postForm,
  route,
  sendJson,
  sendVoid,
} from "./http";

type ServerCalls = Pick<
  ApiClient,
  "listServers" | "discoverServers" | "createServer" | "joinServer" | "joinServerInvite"
> &
  Pick<
    AdminApiClient,
    | "updateServer"
    | "uploadServerIcon"
    | "removeServerIcon"
    | "transferServer"
    | "deleteServer"
    | "listAuditEntries"
    | "getNotificationSettings"
    | "setNotificationSettings"
  >;

const parseServers = parseList(parseServer);
const parseAuditEntries = parseList(parseAuditEntry);

const parseIconUrl: Parse<string> = (value, path) =>
  expectString(expectRecord(value, path), "iconUrl", path);

export function serverCalls(): ServerCalls {
  return {
    listServers: (signal) => getJson("/api/servers", parseServers, signal),

    discoverServers: (signal) => getJson("/api/servers/discover", parseServers, signal),

    createServer: (input, signal) =>
      sendJson("POST", "/api/servers", input, parseServer, signal),

    joinServer: (serverId, signal) =>
      sendJson("POST", route`/api/servers/${serverId}/join`, undefined, parseServer, signal),

    joinServerInvite: (code, signal) =>
      sendJson("POST", route`/api/invites/${code}/join`, undefined, parseServer, signal),

    updateServer: (patch, signal) =>
      sendJson("PATCH", "/api/admin/server", patch, parseServer, signal),

    uploadServerIcon: (file, signal) =>
      postForm("/api/admin/server/icon", fileForm(file), parseIconUrl, signal),

    removeServerIcon: (signal) => sendVoid("DELETE", "/api/admin/server/icon", undefined, signal),

    transferServer: (userId, signal) =>
      sendVoid("POST", "/api/admin/server/transfer", { userId }, signal),

    deleteServer: (signal) => deleteResource("/api/admin/server", signal),

    listAuditEntries: (signal) => getJson("/api/admin/audit", parseAuditEntries, signal),

    getNotificationSettings: (signal) =>
      getJson("/api/admin/notifications", parseNotificationSettings, signal),

    setNotificationSettings: (patch, signal) =>
      sendJson("PATCH", "/api/admin/notifications", patch, parseNotificationSettings, signal),
  };
}
