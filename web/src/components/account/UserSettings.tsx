"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";

import { AccountActivitySections } from "@/components/account/panes/AccountActivitySections";
import {
  AccountPane,
  type AccountPaneProps,
} from "@/components/account/panes/AccountPane";
import {
  KeybindsPane,
  type KeybindsPaneProps,
} from "@/components/account/panes/KeybindsPane";
import {
  LanguagePane,
  type LanguagePaneProps,
} from "@/components/account/panes/LanguagePane";
import {
  AdvancedPane,
  PrivacyPane,
  UserNotificationsPane,
  type BlockedPeopleProps,
  type PreferencePaneProps,
  type StartupPreferenceProps,
  type SystemNotificationPreferenceProps,
} from "@/components/account/panes/PreferencePanes";
import {
  SecurityPane,
  type SecurityPaneProps,
} from "@/components/account/panes/SecurityPane";
import { VoicePane, type VoicePaneProps } from "@/components/account/panes/VoicePane";
import { Icon } from "@stellarr/ui/icons";
import { Avatar } from "@/components/primitives/Avatar";
import { DialogClose } from "@/components/primitives/DialogClose";
import { Modal } from "@/components/primitives/Modal";
import {
  AppearancePane,
  type AppearancePaneProps,
} from "@/components/settings/panes/AppearancePane";
import { type Translator } from "@/i18n";
import { translateForDocument } from "@/i18n/defaultLocale";
import type { Account } from "@/ports";

import {
  USER_SETTINGS_GROUPS,
  USER_SETTINGS_PANES,
  revealSettingsNavItem,
  type UserSettingsPaneKey,
} from "./settingsNav";

export type { UserSettingsPaneKey } from "./settingsNav";

export interface UserSettingsProps {
  open: boolean;
  onClose: () => void;
  /**
   * The pane the dialog opens on. The voice bar's device pickers land on the
   * voice pane, not on the first item: a control that arrives one click short
   * of what it promised has lied.
   */
  initialPane?: UserSettingsPaneKey;
  account: Account;
  accountPane: Omit<AccountPaneProps, "account">;
  security: Omit<SecurityPaneProps, "account">;
  preferences: PreferencePaneProps;
  /** The people this account blocked, listed under privacy. */
  blocked?: BlockedPeopleProps;
  systemNotifications?: SystemNotificationPreferenceProps;
  keybinds: KeybindsPaneProps & { cancelRecording: () => void };
  startup?: StartupPreferenceProps;
  appearance: AppearancePaneProps;
  voice: VoicePaneProps;
  language?: LanguagePaneProps;
  /** Labels of the dialog's own chrome; the panes read the language themselves. */
  t?: Translator;
  onLogout: () => void;
}

/**
 * Everything that belongs to a person rather than to a server.
 *
 * It is the shell of the server settings (one nav, one scrolling pane column,
 * `Esc` in the corner) because it is the same kind of surface, and nobody
 * should have to relearn it from one dialog to the next.
 *
 * Log out sits alone below a rule at the bottom of the nav. It is the one item
 * that opens no pane, and inside a group it would look like one that does.
 */
export function UserSettings({
  open,
  onClose,
  initialPane = "konto",
  account,
  accountPane,
  security,
  preferences,
  blocked,
  systemNotifications,
  keybinds,
  startup,
  appearance,
  voice,
  language,
  t = translateForDocument,
  onLogout,
}: UserSettingsProps) {
  const titleId = useId();
  const navRef = useRef<HTMLElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(initialPane);
  const { cancelRecording, ...recorder } = keybinds;

  // Opening goes to the pane that was asked for. Derived from `open` during
  // render, so the first paint is already on it, and on the way in rather than
  // out, so a closing dialog does not change pane while it fades.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setActive(initialPane);
  }

  // Recording is owned above the dialog so a shortcut keeps working after it
  // closes, but leaving its pane must not leave a keyboard capture behind.
  useEffect(() => {
    if (!open || active !== "skroty") cancelRecording();
  }, [active, open, cancelRecording]);

  // A new pane starts at the top instead of wherever the last one was scrolled.
  useEffect(() => {
    if (panesRef.current) panesRef.current.scrollTop = 0;
  }, [active, open]);

  // The mobile nav is a horizontal strip. Modal becomes visible a frame after
  // it mounts, and the strip has no geometry to measure until then, so the
  // selected tab is brought into view one frame later still.
  useEffect(() => {
    if (!open) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const strip = navRef.current;
        const selected = strip?.querySelector<HTMLElement>('[aria-current="page"]');
        if (strip && selected) revealSettingsNavItem(strip, selected);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [active, open]);

  const renderPane = () => {
    switch (active) {
      case "konto":
        return <AccountPane account={account} {...accountPane} />;
      case "bezpieczenstwo":
        return <SecurityPane account={account} {...security} />;
      case "sesje":
        return security.twoStep ? <AccountActivitySections {...security.twoStep} /> : null;
      case "prywatnosc":
        return <PrivacyPane {...preferences} blocked={blocked} />;
      case "wyglad":
        return <AppearancePane {...appearance} />;
      case "jezyk":
        return language === undefined ? null : <LanguagePane {...language} />;
      case "powiadomienia":
        return (
          <UserNotificationsPane
            {...preferences}
            systemNotifications={systemNotifications}
          />
        );
      case "glos":
        return <VoicePane {...voice} />;
      case "skroty":
        return <KeybindsPane {...recorder} />;
      case "zaawansowane":
        return <AdvancedPane {...preferences} startup={startup} />;
    }
  };

  // The bar reads from the table the nav is built from, so the two cannot
  // disagree about what a pane is called.
  const current = USER_SETTINGS_PANES[active];

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} className="sv-wrap">
      <div className="sv">
        {/* First in both visual and keyboard order. One real button also
            avoids a mobile-only duplicate that could drift from the desktop
            one. */}
        <div className="sv-bar">
          <div className="sv-bar-txt">
            <h2>{t(current.title)}</h2>
            <p>{t(current.detail)}</p>
          </div>
          <DialogClose label={t("settings.close")} onClose={onClose} />
        </div>

        <aside className="sv-nav">
          {/* Whose settings these are, the way a server's settings open with
              the server's name. */}
          <div className="sv-brand us-brand">
            <Avatar
              id={account.id}
              displayName={account.displayName || "?"}
              avatarUrl={account.avatarUrl}
              presence="online"
            />
            <span className="sv-brand-txt">
              <b id={titleId}>{account.displayName}</b>
              <span>{t("settings.userSettings")}</span>
            </span>
          </div>

          <nav className="sv-nav-scroll" aria-label={t("settings.sections")} ref={navRef}>
            {USER_SETTINGS_GROUPS.map((group) => (
              <Fragment key={group.caption}>
                <div className="sv-cap">{t(group.caption)}</div>
                {group.panes.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={key === active ? "sv-item on" : "sv-item"}
                    data-pane={key}
                    aria-current={key === active ? "page" : undefined}
                    onClick={() => setActive(key)}
                  >
                    <span className="sv-ico" aria-hidden="true">
                      <Icon name={USER_SETTINGS_PANES[key].icon} size={18} />
                    </span>
                    {t(USER_SETTINGS_PANES[key].title)}
                  </button>
                ))}
              </Fragment>
            ))}
          </nav>

          <div className="us-out">
            {/* The title is for the phone layout, where the label is hidden. */}
            <button
              type="button"
              className="sv-item danger"
              title={t("settings.logout")}
              onClick={onLogout}
            >
              <span className="sv-ico" aria-hidden="true">
                <Icon name="signout" size={18} />
              </span>
              {t("settings.logout")}
            </button>
          </div>
        </aside>

        <div className="sv-main">
          <div className="sv-panes" ref={panesRef}>
            <section className="sv-pane on" data-pane={active} key={active}>
              {renderPane()}
            </section>
          </div>
        </div>
      </div>
    </Modal>
  );
}
