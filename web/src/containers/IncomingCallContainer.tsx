"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { Avatar } from "@/components/primitives/Avatar";
import { playSystemFx, stopSystemFx } from "@/lib/audio/systemFx";
import { initials } from "@/lib/format";
import {
  androidNotificationPermission,
  androidNotificationsSupported,
  closeAndroidIncomingCall,
  requestAndroidNotificationPermission,
  showAndroidIncomingCall,
  subscribeAndroidCallActions,
  type AndroidCallAction,
} from "@/lib/notifications/android";
import {
  closeIncomingCallNotification,
  showIncomingCallNotification,
} from "@/lib/notifications/browser";
import type { DmConversation } from "@/ports";
import { useAccount, useFriends, useLanguage, useVoice } from "@/state/hooks";

type RingingConversation = DmConversation & { callId: string };

/**
 * A call somebody else has started in a conversation this client has not
 * joined. A call is the occupancy of a direct room, so it is incoming when the
 * other person is in it.
 */
function findIncoming(
  conversations: readonly DmConversation[],
  joinedChannelId: string | null,
): RingingConversation | undefined {
  return conversations.find(
    (conversation): conversation is RingingConversation =>
      conversation.callId !== undefined &&
      conversation.id !== joinedChannelId &&
      (conversation.callParticipants ?? []).some(
        (participant) => participant.userId === conversation.peer.id,
      ),
  );
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/**
 * The receiving half of a direct call: a banner that stays available whichever
 * channel or conversation is open, a ringtone, and a system notification where
 * the page cannot be seen.
 */
export function IncomingCallContainer() {
  const friends = useFriends();
  const { channelId: joinedChannelId } = useVoice();
  const { preferences } = useAccount();
  const { t } = useLanguage();
  const [declinedCallId, setDeclinedCallId] = useState<string | null>(null);
  const [androidAction, setAndroidAction] = useState<AndroidCallAction | null>(null);
  const handledAndroidAction = useRef<string | null>(null);
  const pageVisible = usePageVisible();
  const { desktopNotifications } = preferences;
  // Android has no Web Notification API inside its WebView, so it goes through
  // the native bridge instead of the browser.
  const native = androidNotificationsSupported();

  useEffect(() => {
    if (
      native &&
      pageVisible &&
      desktopNotifications &&
      androidNotificationPermission() === "default"
    ) {
      void requestAndroidNotificationPermission().catch(() => undefined);
    }
  }, [native, pageVisible, desktopNotifications]);

  useEffect(() => subscribeAndroidCallActions(setAndroidAction), []);

  // The answer and decline buttons of the native notification. On a cold launch
  // the tap can arrive before the social snapshot, so it stays pending until
  // the matching call appears rather than being lost.
  useEffect(() => {
    if (androidAction === null) return;
    const { action, conversationId, callId } = androidAction;
    const conversation = friends.conversations.find(
      (candidate) => candidate.id === conversationId && candidate.callId === callId,
    );
    if (conversation === undefined) return;
    const key = `${action}:${callId}`;
    if (handledAndroidAction.current === key) return;
    handledAndroidAction.current = key;
    if (action === "answer") friends.callConversation(conversation.id);
    else friends.declineCall(conversation.id);
    closeAndroidIncomingCall(callId);
  }, [androidAction, friends]);

  const incoming = findIncoming(friends.conversations, joinedChannelId);
  const callId = incoming?.callId ?? null;
  const conversationId = incoming?.id ?? null;
  const callerName = incoming?.peer.displayName ?? null;
  const declinedOnPhone = androidAction?.action === "decline" ? androidAction.callId : null;
  const visible = callId !== null && callId !== declinedCallId && callId !== declinedOnPhone;

  useEffect(() => {
    if (!visible || native) {
      stopSystemFx("calling");
      return;
    }
    playSystemFx("calling");
    return () => stopSystemFx("calling");
  }, [visible, callId, native]);

  const notify = visible && callerName !== null && desktopNotifications;

  useEffect(() => {
    if (!native || callId === null) return;
    if (!notify || conversationId === null || callerName === null) {
      closeAndroidIncomingCall(callId);
      return;
    }
    showAndroidIncomingCall(conversationId, callId, callerName, t("dm.systemIncomingCall"));
    return () => closeAndroidIncomingCall(callId);
  }, [native, notify, callId, conversationId, callerName, t]);

  // A visible page has the banner; the system notification is for a hidden one.
  useEffect(() => {
    if (native || callId === null) return;
    if (!notify || callerName === null || pageVisible) {
      void closeIncomingCallNotification(callId);
      return;
    }
    void showIncomingCallNotification({
      id: callId,
      caller: callerName,
      body: t("dm.systemIncomingCall"),
    }).catch(() => undefined);
    return () => void closeIncomingCallNotification(callId);
  }, [native, notify, pageVisible, callId, callerName, t]);

  if (!visible || incoming === undefined) return null;

  const { peer } = incoming;
  return (
    <aside
      className="dm-call-banner"
      role="dialog"
      aria-modal="false"
      aria-label={t("dm.incomingCall", { name: peer.displayName })}
    >
      <Avatar
        id={peer.id}
        displayName={peer.displayName}
        initials={initials(peer.displayName)}
        avatarUrl={peer.avatarUrl}
        size="md"
        presence={peer.presence}
      />
      <span className="dm-call-copy">
        <b>{peer.displayName}</b>
        <span>{t("dm.callingYou")}</span>
      </span>
      <button
        type="button"
        className="dm-call-answer"
        title={t("dm.answer")}
        aria-label={t("dm.answer")}
        onClick={() => friends.callConversation(incoming.id)}
      >
        <Icon name="phone" size={18} />
      </button>
      <button
        type="button"
        className="dm-call-decline"
        title={t("dm.decline")}
        aria-label={t("dm.decline")}
        onClick={() => {
          setDeclinedCallId(incoming.callId);
          friends.declineCall(incoming.id);
        }}
      >
        <Icon name="phoneX" size={18} />
      </button>
    </aside>
  );
}
