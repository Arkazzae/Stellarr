import { parseMessage } from "./chatParsers";
import { ApiError } from "./errors";
import {
  definedField,
  expectArray,
  expectRecord,
  expectString,
  optionalNumber,
  optionalString,
  stringArray,
} from "./expect";
import { isPresence } from "./types";
import type {
  AccountDetails,
  AccountPreferences,
  FriendRequestAnswer,
  PasswordChangeAnswer,
  SocialConversation,
  SocialState,
  User,
} from "./types";

export function parseUser(value: unknown, path: string): User {
  const record = expectRecord(value, path);
  const presence = record["presence"];
  const username = expectString(record, "username", path);
  return {
    id: expectString(record, "id", path),
    username,
    displayName: optionalString(record, "displayName") ?? username,
    presence: isPresence(presence) ? presence : "offline",
    // Profile fields are spread in only when present: a server without
    // profiles must produce a user that lacks them, not one that holds
    // `undefined`.
    ...definedField("avatarUrl", optionalString(record, "avatarUrl")),
    ...definedField("bannerUrl", optionalString(record, "bannerUrl")),
    ...definedField("customStatus", optionalString(record, "customStatus")),
    ...definedField("bio", optionalString(record, "bio")),
    ...definedField("pronouns", optionalString(record, "pronouns")),
  };
}

type FlagPreference = {
  [K in keyof AccountPreferences]: AccountPreferences[K] extends boolean ? K : never;
}[keyof AccountPreferences];

/** What a switch reads as when an older server does not send it. */
const PREFERENCE_DEFAULTS: Readonly<Record<FlagPreference, boolean>> = {
  desktopNotifications: true,
  emailNotifications: false,
  pushNotifications: false,
  mentionsOnly: true,
  messageSound: true,
  joinLeaveSound: true,
  allowDirectMessages: true,
  allowFriendRequests: true,
  showPresence: true,
  developerMode: false,
  reducedMotion: false,
};

const DEFAULT_VAD_SENSITIVITY = 60;

export function parsePreferences(value: unknown, path: string): AccountPreferences {
  const record = expectRecord(value, path);
  const flag = (key: FlagPreference): boolean => {
    const stored = record[key];
    return typeof stored === "boolean" ? stored : PREFERENCE_DEFAULTS[key];
  };
  const vad = record["vadSensitivity"];
  return {
    desktopNotifications: flag("desktopNotifications"),
    emailNotifications: flag("emailNotifications"),
    pushNotifications: flag("pushNotifications"),
    mentionsOnly: flag("mentionsOnly"),
    messageSound: flag("messageSound"),
    joinLeaveSound: flag("joinLeaveSound"),
    allowDirectMessages: flag("allowDirectMessages"),
    allowFriendRequests: flag("allowFriendRequests"),
    showPresence: flag("showPresence"),
    developerMode: flag("developerMode"),
    reducedMotion: flag("reducedMotion"),
    mutedChannelIds: stringArray(record["mutedChannelIds"]),
    joinSoundId: optionalString(record, "joinSoundId") ?? null,
    vadSensitivity:
      typeof vad === "number" && Number.isInteger(vad) && vad >= 0 && vad <= 100
        ? vad
        : DEFAULT_VAD_SENSITIVITY,
  };
}

export function parseAccount(value: unknown, path = "/api/me"): AccountDetails {
  const record = expectRecord(value, path);
  return {
    id: expectString(record, "id", path),
    username: expectString(record, "username", path),
    displayName: expectString(record, "displayName", path),
    createdAt: expectString(record, "createdAt", path),
    customStatus: optionalString(record, "customStatus") ?? "",
    bio: optionalString(record, "bio") ?? "",
    pronouns: optionalString(record, "pronouns") ?? "",
    preferences: parsePreferences(record["preferences"], `${path}.preferences`),
    ...definedField("email", optionalString(record, "email")),
    ...definedField("avatarUrl", optionalString(record, "avatarUrl")),
    ...definedField("bannerUrl", optionalString(record, "bannerUrl")),
  };
}

export function parsePasswordAnswer(value: unknown, path: string): PasswordChangeAnswer {
  const result = expectRecord(value, path)["result"];
  if (
    result === "changed" ||
    result === "wrong-current" ||
    result === "too-short" ||
    result === "same-as-current" ||
    result === "second-step-required"
  ) {
    return result;
  }
  throw new ApiError("malformed", `${path} returned an unexpected result`);
}

function parseSocialConversation(value: unknown, path: string): SocialConversation {
  const record = expectRecord(value, path);
  const lastMessage = record["lastMessage"];
  return {
    id: expectString(record, "id", path),
    peer: parseUser(record["peer"], `${path}.peer`),
    ...(lastMessage === null || lastMessage === undefined
      ? {}
      : { lastMessage: parseMessage(lastMessage, `${path}.lastMessage`) }),
    unread: optionalNumber(record, "unread") ?? 0,
    updatedAt: expectString(record, "updatedAt", path),
  };
}

export function parseSocialState(value: unknown, path = "/api/social"): SocialState {
  const record = expectRecord(value, path);
  return {
    friends: expectArray(record["friends"], `${path}.friends`).map((item) => {
      const friend = expectRecord(item, `${path}.friends[]`);
      return {
        user: parseUser(friend["user"], `${path}.friends[].user`),
        since: expectString(friend, "since", `${path}.friends[]`),
      };
    }),
    requests: expectArray(record["requests"], `${path}.requests`).map((item) => {
      const request = expectRecord(item, `${path}.requests[]`);
      return {
        id: expectString(request, "id", `${path}.requests[]`),
        user: parseUser(request["user"], `${path}.requests[].user`),
        direction: request["direction"] === "incoming" ? "incoming" : "outgoing",
        sentAt: expectString(request, "sentAt", `${path}.requests[]`),
      };
    }),
    blocked: expectArray(record["blocked"], `${path}.blocked`).map((item) =>
      parseUser(item, `${path}.blocked[]`),
    ),
    conversations: expectArray(record["conversations"], `${path}.conversations`).map(
      (item) => parseSocialConversation(item, `${path}.conversations[]`),
    ),
  };
}

const FRIEND_REQUEST_ANSWERS: readonly FriendRequestAnswer[] = [
  "sent",
  "unknown-user",
  "already-friends",
  "already-sent",
  "self",
  "blocked",
];

export function parseFriendRequestAnswer(value: unknown, path: string): FriendRequestAnswer {
  const result = expectRecord(value, path)["result"];
  const answer = FRIEND_REQUEST_ANSWERS.find((candidate) => candidate === result);
  if (answer === undefined) {
    throw new ApiError("malformed", `${path} returned an unexpected result`);
  }
  return answer;
}
