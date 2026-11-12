# Account security

Stellarr can ask for a second step after the password: a code from an
authenticator app, a code sent by email, or a passkey. This page covers what
people see, the policy an operator sets, and how to get someone back in when
they lose their second step.

## What people set up

Each person manages their own second step in the web client, under
**Settings → Login and security**:

- **Authenticator app.** A time-based code (TOTP, 6 digits, 30 seconds). The
  client shows a QR code drawn in the browser and the same key as text; the key
  is shown only during setup. An account can have several apps, each with its
  own name.
- **Email code.** A 6-digit code sent to the account's email address. It needs
  mail delivery to be configured (see [Configuration](configuration.md)).
- **Passkey or security key.** Kept on the device, in a phone or password
  manager, or on a USB or NFC security key, and confirmed with a fingerprint,
  face, PIN or a touch of the key. The browser asks where to keep it. A passkey
  also signs in on its own, without the password (see below).
- **Recovery codes.** Ten one-time codes, issued with the first method and
  shown once. Each lets the person in once when their second step is not at
  hand. They can be replaced from the same pane, which ends the old ones.

The pane also lists the devices trusted to skip the second step, the active
sessions, and the account's security history. A person can stop trusting a
device, sign out one of their other sessions, or sign out every session but
the current one. A signed-out session's live connections close at once and
its browser returns to the sign-in page.

Adding or removing a method and replacing the recovery codes need proof: a
second step completed in the last five minutes, or the password when the
account has no method yet. The pane asks for it when needed. One address can
make 30 of these requests, the steps of a setup included, in 15 minutes.
Sending an email code falls under the stricter limit shared with registration
and password reset: five requests per 15 minutes.

Signing in through an identity provider (OIDC) is followed by the same second
step, unless the operator trusts that provider's own second step (see
[Single sign-on](configuration.md#single-sign-on-oidc)).

## Passkeys

Passkeys work only when the instance has a public address with a host name
over HTTPS: `STELLARR_PUBLIC_URL`, or `STELLARR_DOMAIN` set to a name rather
than an IP address (see [Configuration](configuration.md)). Browsers refuse
passkeys on an IP address or over plain HTTP, except `http://localhost` during
development. Without such an address the web client does not offer them.

A passkey belongs to the host name it was created on. **Changing the domain
makes every passkey stop working**; people then sign in with the password and
another method, or a recovery code, and add a new passkey.

With a passkey the sign-in page offers **Continue with a passkey**: the browser
asks which passkey to use and for the fingerprint, face or PIN that unlocks it.
That one step counts as the password and the second step together, so under any
policy the session is treated as having passed a second step, Cockpit
included. A security key that does not keep the account on the key works as a
second step after the password, but not on its own.

## Trusted devices

At the second step a person can tick "Don't ask for a code on this device for
N days". The number comes from `mfa.trusted-device-days` (14 by default). A
trusted device skips the second step at sign-in only: it never counts as proof
for a security change or for Cockpit.

## The instance policy

The owner chooses who must use a second step, in Cockpit under **Settings →
Account security**, or with the CLI:

```sh
docker compose exec stellarr stellarr config set mfa.requirement everyone --yes
```

| Value | Effect |
| --- | --- |
| `optional` | The default. Each person decides; an account that added a method confirms sign-in with it. |
| `admins` | Required from the instance owner and roles with the Manage server permission. |
| `everyone` | Required from every account. |
| `cockpit` | Ordinary sign-in is unchanged; only Cockpit requires a second step. |

With `admins` or `everyone`, an affected account without a method sets one up
at its next sign-in, before it can use the app.

With any value other than `optional`, Cockpit accepts only a session that
completed a real second step; a trusted device is not enough. An owner whose
session does not qualify is sent to confirm it in the web client and then
returned to Cockpit. **Set up a method on the owner's account before changing
the policy**, so the confirmation has something to ask for.

The other limits (challenge lifetime, email code lifetime, resend wait,
attempts and hourly sends, CLI recovery lifetime) are listed with their ranges
under [Configuration in the CLI guide](cli.md#configuration).

## When someone loses their second step

A person who still has a recovery code uses it at the second step ("Use a
recovery code").

A person who has none needs the operator:

```sh
docker compose exec stellarr stellarr security show maja
docker compose exec stellarr stellarr security recover maja --reason "lost phone"
```

`security recover` asks for confirmation, then ends every method, trusted
device and session of the account and prints a one-time recovery code. Pass it
to the person by a channel you trust. It expires after `mfa.cli-recovery-minutes`
(10 by default). Until it is used, the password and the identity provider no
longer let the account in.

The person signs in with their password, enters the recovery code when asked,
sets up a new method, and receives new recovery codes. See
[Account security and MFA recovery](cli.md#account-security-and-mfa-recovery)
for the command's options and output.

## Backups

Authenticator app keys are stored encrypted with the instance's
data-protection keys (`<data-root>/keys`). A full backup from Cockpit, or the
volume archive described in [Upgrading](upgrading.md), includes those keys.
A database restored without the keys it was written with cannot read any
authenticator app key: every such method stops working, and people need a
recovery code or the operator's recovery to get back in.

## Sessions

A session lasts 30 days from sign-in. The sign-in forms of the web client and
Cockpit have **Keep me signed in** ticked. Clearing it gives a session that
ends when the browser closes, and 12 hours after sign-in in any case, also in
a browser that restores its tabs and cookies. The choice also applies when the
sign-in goes through the identity provider or continues with a second step or
an operator's recovery. A session approved for the desktop app is always kept.

Signing out, a sign-out from another
device and an operator's recovery end sessions, and a change to the account's
methods ends its other sessions. The server closes their live connections, and
each client returns to the sign-in page with a message that the session ended.
