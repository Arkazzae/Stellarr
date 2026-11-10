import { describe } from "vitest";

import {
  itAnswersMissingDeletes,
  itForwardsTheSignal,
  itSendsCalls,
  mockFetch,
} from "@/test/http";

import { channelCalls } from "./channels";

const fetchMock = mockFetch();
const calls = channelCalls();

const CHANNEL = { id: "c-1", name: "general", kind: "text" };
const SECTION = { id: "sec-1", name: "Ogłoszenia", position: 1 };
const OVERRIDE = { roleId: "r-1", allow: ["manageMessages"], deny: [] };

describe("channel calls", () => {
  itSendsCalls(fetchMock, [
    {
      name: "createChannel",
      run: () => calls.createChannel({ name: "general", kind: "text", sectionId: "sec-1" }),
      method: "POST",
      url: "/api/admin/channels",
      body: { name: "general", kind: "text", sectionId: "sec-1" },
      answer: CHANNEL,
    },
    {
      name: "updateChannel",
      run: () => calls.updateChannel("a/b", { audioProfile: "studio" }),
      method: "PATCH",
      url: "/api/admin/channels/a%2Fb",
      body: { audioProfile: "studio" },
      answer: CHANNEL,
    },
    { name: "deleteChannel", run: () => calls.deleteChannel("c-1"), method: "DELETE", url: "/api/admin/channels/c-1" },
    {
      name: "reorderChannels",
      run: () => calls.reorderChannels(["c-2", "c-1"]),
      method: "PUT",
      url: "/api/admin/channels/order",
      body: { channelIds: ["c-2", "c-1"] },
    },
    {
      name: "assignChannelSection to a section",
      run: () => calls.assignChannelSection("c-1", "sec-1"),
      method: "PATCH",
      url: "/api/admin/channels/c-1/section",
      body: { sectionId: "sec-1" },
    },
    {
      name: "assignChannelSection to no section",
      run: () => calls.assignChannelSection("c-1", null),
      method: "PATCH",
      url: "/api/admin/channels/c-1/section",
      body: { sectionId: null },
    },
    {
      name: "kickVoiceMember",
      run: () => calls.kickVoiceMember("voice-1", "u-2"),
      method: "DELETE",
      url: "/api/admin/channels/voice-1/members/u-2",
    },
    {
      name: "moveVoiceMember",
      run: () => calls.moveVoiceMember("voice-1", "voice-2", "u-2"),
      method: "PATCH",
      url: "/api/admin/channels/voice-1/members/u-2",
      body: { targetChannelId: "voice-2" },
    },
    {
      name: "createSection",
      run: () => calls.createSection({ name: "Ogłoszenia" }),
      method: "POST",
      url: "/api/admin/sections",
      body: { name: "Ogłoszenia" },
      answer: SECTION,
    },
    {
      name: "updateSection",
      run: () => calls.updateSection("sec-1", { name: "Nowe" }),
      method: "PATCH",
      url: "/api/admin/sections/sec-1",
      body: { name: "Nowe" },
      answer: SECTION,
    },
    { name: "deleteSection", run: () => calls.deleteSection("sec-1"), method: "DELETE", url: "/api/admin/sections/sec-1" },
    {
      name: "reorderSections",
      run: () => calls.reorderSections(["sec-2", "sec-1"]),
      method: "PUT",
      url: "/api/admin/sections/order",
      body: { sectionIds: ["sec-2", "sec-1"] },
    },
    {
      name: "listPermissionOverrides of a channel",
      run: () => calls.listPermissionOverrides("channel", "c-1"),
      method: "GET",
      url: "/api/admin/channels/c-1/permissions",
      answer: [OVERRIDE],
    },
    {
      name: "listPermissionOverrides of a section",
      run: () => calls.listPermissionOverrides("section", "sec-1"),
      method: "GET",
      url: "/api/admin/sections/sec-1/permissions",
      answer: [OVERRIDE],
    },
    {
      name: "setPermissionOverride",
      run: () =>
        calls.setPermissionOverride("channel", "c-1", "r/1", {
          allow: ["manageMessages"],
          deny: [],
        }),
      method: "PUT",
      url: "/api/admin/channels/c-1/permissions/r%2F1",
      body: { allow: ["manageMessages"], deny: [] },
      answer: OVERRIDE,
    },
    {
      name: "deletePermissionOverride",
      run: () => calls.deletePermissionOverride("section", "sec-1", "r-1"),
      method: "DELETE",
      url: "/api/admin/sections/sec-1/permissions/r-1",
    },
  ]);

  describe("a target that is already gone", () => {
    itAnswersMissingDeletes(
      fetchMock,
      {
        deleteChannel: () => calls.deleteChannel("c-1"),
        deleteSection: () => calls.deleteSection("sec-1"),
        deletePermissionOverride: () => calls.deletePermissionOverride("channel", "c-1", "r-1"),
      },
      true,
    );
    itAnswersMissingDeletes(
      fetchMock,
      { kickVoiceMember: () => calls.kickVoiceMember("voice-1", "u-2") },
      false,
    );
  });

  itForwardsTheSignal(fetchMock, {
    deleteChannel: (signal) => calls.deleteChannel("c-1", signal),
    kickVoiceMember: (signal) => calls.kickVoiceMember("voice-1", "u-2", signal),
    deleteSection: (signal) => calls.deleteSection("sec-1", signal),
    deletePermissionOverride: (signal) =>
      calls.deletePermissionOverride("channel", "c-1", "r-1", signal),
  });
});
