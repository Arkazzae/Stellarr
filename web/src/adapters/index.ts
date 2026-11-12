/**
 * The composition root: the one place that knows which implementation backs
 * which port. Components, containers and tests above it see only `Ports`.
 *
 * Every port is backed by the real HTTP, SignalR or WebRTC implementation. A
 * platform that brings its own transport (the desktop client) passes it in
 * `RuntimeOptions`; nothing above this file changes.
 */

import {
  createHttpApiClient,
  type AdminApiClient,
  type ApiClient,
  type SocialApiClient,
} from "@/lib/api/client";
import { isUnauthorized } from "@/lib/api/errors";
import type { Bootstrap, RtcConfig } from "@/lib/api/types";
import { iceServers } from "@/lib/env";
import { createPasskey, getPasskey, passkeysSupported } from "@/lib/webauthn";
import { SignalRRealtimeClient } from "@/lib/realtime/signalr";
import type { RealtimeClient } from "@/lib/realtime/types";
import { RuntimeIceProvider } from "@/lib/voice/iceSession";
import { ParticipantPreferencesStore } from "@/lib/voice/participantPreferences";
import { VoiceSettingsStore } from "@/lib/voice/settings";
import { WebRtcVoiceClient } from "@/lib/voice/webrtc";
import type { Account, Ports, User } from "@/ports";
import type { DesktopPort } from "@/ports/desktop";

import { createAccountAdapter } from "./account";
import { createServerAdminAdapter } from "./admin";
import { createChatAdapter, createTypingAdapter } from "./chat";
import { createDirectoryAdapter } from "./directory";
import { createFriendsAdapter } from "./friends";
import { createMessageActionsAdapter, ReactionStore } from "./messageActions";
import { createNotificationAdapter } from "./notifications";
import { createConnectionAdapter, createPresenceAdapter } from "./presence";
import { ChannelReadStore } from "./readState";
import { createSoundboardAdapter } from "./soundboard";
import { DirectoryStore } from "./store";
import { createVoiceSettingsAdapter } from "./voiceSettings";

export interface Runtime {
  ports: Ports;
  /** Seeds every shared store from the boot payload. */
  hydrate(bootstrap: Bootstrap): Promise<void>;
  /** The raw realtime client, so the session can start and stop it. */
  realtime: RealtimeClient;
  dispose(): void;
}

export interface RuntimeOptions {
  /**
   * A platform transport. The browser uses same-origin HTTP, while the desktop
   * client supplies its native broker without changing any UI-facing port.
   */
  api?: ApiClient & SocialApiClient & AdminApiClient;
  /** Browser SignalR by default; the desktop client keeps its socket in Rust. */
  realtime?: RealtimeClient;
  /** Operating-system preferences, supplied by the desktop shell only. */
  desktop?: DesktopPort;
}

/** Copies the profile fields of the signed-in account onto their directory row. */
function withProfileOf(member: User, account: Account): User {
  const { avatarUrl: _avatar, bannerUrl: _banner, ...rest } = member;
  return {
    ...rest,
    displayName: account.displayName,
    customStatus: account.customStatus,
    bio: account.bio,
    pronouns: account.pronouns,
    ...(account.avatarUrl === undefined ? {} : { avatarUrl: account.avatarUrl }),
    ...(account.bannerUrl === undefined ? {} : { bannerUrl: account.bannerUrl }),
  };
}

/**
 * Keeps the directory in step with what the hub announces about the server and
 * the people on it. Returns one function that cancels all four subscriptions.
 */
function followHub(realtime: RealtimeClient, store: DirectoryStore): () => void {
  const isCurrent = (serverId: string): boolean =>
    store.getSnapshot().server?.id === serverId;
  const subscriptions = [
    realtime.on("UserUpdated", (user) => store.setUser(user)),
    realtime.on("ServerUpdated", (server) => store.setServer(server)),
    realtime.on("PermissionsChanged", ({ serverId, permissions }) => {
      if (isCurrent(serverId)) store.setPermissions(permissions);
    }),
    realtime.on("ServerMemberRemoved", ({ serverId, userId }) => {
      if (isCurrent(serverId)) store.removeMember(userId);
    }),
  ];
  return () => {
    for (const unsubscribe of subscriptions) unsubscribe();
  };
}

export function createRuntime(options: RuntimeOptions = {}): Runtime {
  const api = options.api ?? createHttpApiClient();
  const realtime = options.realtime ?? new SignalRRealtimeClient();
  const store = new DirectoryStore();
  const voiceSettingsStore = new VoiceSettingsStore();
  const reactionStore = new ReactionStore();
  const readStore = new ChannelReadStore();
  let rtcConfig: RtcConfig | undefined;

  const createVoice: Ports["createVoice"] = ({ userId, displayName, translate }) => {
    const ice = new RuntimeIceProvider({
      // TURN credentials are per user and expire, so each join asks for fresh
      // ones: one request per join, however many peers the channel has.
      fetchRtc: async () => (await api.bootstrap()).rtc,
      envServers: iceServers,
      isProduction: process.env.NODE_ENV === "production",
    });
    // The contract fetched at sign-in is the fallback when that refresh fails.
    ice.seed(rtcConfig?.iceServers);
    return new WebRtcVoiceClient({
      realtime,
      selfUserId: userId,
      selfDisplayName: displayName,
      translate,
      ice,
      // How each other person sounds to this account outlives the call and the
      // tab, in this browser only.
      participantPreferences: new ParticipantPreferencesStore(undefined, userId),
      // An instance without RTC is incompatible too, so a missing contract
      // becomes an explicit sentinel instead of an assumed v1.
      rtc: rtcConfig ?? { protocolVersion: 0 },
      getSettings: voiceSettingsStore.getSnapshot,
      updateSettings: (patch) => voiceSettingsStore.update(patch),
    });
  };

  const account = createAccountAdapter(api);
  const friends = createFriendsAdapter(api, realtime);
  const soundboard = createSoundboardAdapter(api, realtime, voiceSettingsStore.getSnapshot);
  const messageActions = createMessageActionsAdapter(api, realtime, reactionStore);
  const typing = createTypingAdapter(realtime);
  const chat = createChatAdapter(api, realtime, reactionStore, readStore);
  const admin = createServerAdminAdapter(
    api,
    () => store.getSnapshot().permissions,
    (iconUrl) => store.setServerIcon(iconUrl),
    (channelId, patch) => store.setChannelSettings(channelId, patch),
    (server) => store.setServer(server),
    (channel) => store.addChannel(channel),
    (channelId) => store.removeChannel(channelId),
    (section) => store.addSection(section),
    (section) => store.setSection(section),
    (sectionId) => store.removeSection(sectionId),
  );

  const stopFollowingHub = followHub(realtime, store);
  // A profile edit reaches the directory at once, without waiting for the
  // hub's echo, so your own row never lags behind your account card.
  const stopMirroringAccount = account.onChanged(() => {
    const current = account.getAccount();
    const member = store.getSnapshot().members.find((item) => item.id === current.id);
    if (member !== undefined) store.setUser(withProfileOf(member, current));
  });

  const ports: Ports = {
    ...(options.desktop === undefined ? {} : { desktop: options.desktop }),
    session: {
      needsServerSetup: () => api.needsServerSetup(),
      bootstrap: () => api.bootstrap(),
      login: (input) => api.login(input),
      register: (input) => api.register(input),
      requestPasswordReset: (email) => api.requestPasswordReset(email),
      resetPassword: (token, newPassword) => api.resetPassword(token, newPassword),
      logout: () => api.logout(),
      check: async () => (await api.session()) !== null,
      passkeysSupported: () => passkeysSupported(),
      passkeySignInAvailable: () => api.passkeySignInAvailable(),
      signInWithPasskey: async ({ keepSignedIn }) => {
        const response = await getPasskey(await api.passkeySignInOptions());
        return api.signInWithPasskey({ response, ...(keepSignedIn === false ? { keepSignedIn } : {}) });
      },
      challenge: {
        async pending() {
          try {
            return await api.pendingChallenge();
          } catch (error) {
            // Nothing pending, or it expired: the visitor starts over.
            if (isUnauthorized(error)) return null;
            throw error;
          }
        },
        cancel: () => api.cancelChallenge(),
        verify: (input) => api.verifyChallenge(input),
        sendEmailCode: (challengeId, methodId) => api.sendChallengeEmailCode(challengeId, methodId),
        startTotp: (challengeId, name) => api.startTotpEnrollment(challengeId, name),
        confirmTotp: (input) => api.confirmTotpEnrollment(input),
        startEmail: (challengeId, name) => api.startEmailEnrollment(challengeId, name),
        confirmEmail: (input) => api.confirmEmailEnrollment(input),
        redeemRecovery: (credential, keepSignedIn) => api.redeemRecoveryCredential(credential, keepSignedIn),
        answerWithPasskey: async ({ challengeId, rememberDevice }) => {
          const response = await getPasskey(await api.passkeyChallengeOptions(challengeId));
          return api.verifyPasskey({ challengeId, response, ...(rememberDevice ? { rememberDevice } : {}) });
        },
        createPasskey: async ({ challengeId, name, rememberDevice }) => {
          const response = await createPasskey(await api.startPasskeyEnrollment(challengeId));
          return api.confirmPasskeyEnrollment({
            challengeId,
            name,
            response,
            ...(rememberDevice ? { rememberDevice } : {}),
          });
        },
      },
    },
    account,
    security: {
      get: () => api.getAccountSecurity(),
      startEnrollment: (password) => api.startMfaEnrollment(password),
      startReverification: () => api.startMfaReverification(),
      removeMethod: (methodId, password) => api.removeMfaMethod(methodId, password),
      regenerateRecoveryCodes: (password) => api.regenerateRecoveryCodes(password),
      revokeTrustedDevice: (deviceId) => api.revokeTrustedDevice(deviceId),
      listSessions: () => api.listOwnSessions(),
      revokeSession: (sessionId) => api.revokeOwnSession(sessionId),
      revokeOtherSessions: () => api.revokeOtherSessions(),
    },
    chat,
    messageActions,
    typing,
    presence: createPresenceAdapter(store, realtime),
    connection: createConnectionAdapter(realtime),
    directory: createDirectoryAdapter(
      store,
      (orderedIds) => api.reorderChannels(orderedIds),
      (orderedIds) => api.reorderSections(orderedIds),
      {
        create: (input) => api.createServer(input),
        discover: () => api.discoverServers(),
        join: (serverId) => api.joinServer(serverId),
        joinInvite: (code) => api.joinServerInvite(code),
      },
    ),
    admin,
    friends,
    notifications: createNotificationAdapter(api, realtime),
    soundboard,
    voiceSettings: createVoiceSettingsAdapter(voiceSettingsStore),
    createVoice,
  };

  return {
    ports,
    realtime,
    async hydrate(bootstrap) {
      rtcConfig = bootstrap.rtc;
      realtime.configureRtc?.(rtcConfig);
      // Device settings are local but not shared between accounts on one
      // browser profile; this also migrates the old unscoped entry once.
      voiceSettingsStore.setOwner(bootstrap.user.id);
      store.hydrate(bootstrap);
      reactionStore.setSelfUserId(bootstrap.user.id);
      reactionStore.ingest(bootstrap.messages);
      readStore.hydrate(bootstrap.channelReads);
      await account.hydrate(bootstrap.user);
      await Promise.all([friends.load(), soundboard.load()]);
    },
    dispose() {
      stopMirroringAccount();
      stopFollowingHub();
      friends.dispose?.();
      soundboard.dispose();
      messageActions.dispose?.();
      typing.dispose?.();
      chat.dispose?.();
      reactionStore.reset();
      readStore.reset();
      rtcConfig = undefined;
      store.reset();
      void realtime.stop();
    },
  };
}

let cached: Runtime | null = null;

/** One runtime per browser session. */
export function getRuntime(): Runtime {
  cached ??= createRuntime();
  return cached;
}

/** Tests build their own runtime; this clears the module-level cache. */
export function __resetRuntime(): void {
  cached = null;
}
