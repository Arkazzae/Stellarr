import { describe, expect, it } from "vitest";

import { ApiError } from "./errors";
import {
  parseAccountSecurity,
  parseAuthResult,
  parseMfaChallenge,
  parseMfaCompletion,
  parseMfaEnrollment,
} from "./securityParsers";

// Answers recorded from a running API, so the shapes are the server's own.
// Only the TOTP secret and the recovery codes were swapped for stand-ins.
const SIGNED_IN = {
  "id": "6c1f1523-f1c3-44cd-ad2b-633f89e1826e",
  "username": "maja",
  "displayName": "Maja",
  "avatarColor": "oklch(0.58 0.14 84)",
  "presence": "online",
  "avatarUrl": null,
  "bannerUrl": null,
  "customStatus": null,
  "bio": null,
  "pronouns": null
};

const SIGN_IN_CHALLENGE = {
  "status": "mfa_required",
  "challengeId": "a3981b95-7db8-4588-83d8-02f7f8afc0cb",
  "purpose": "mfa",
  "expiresAt": "2026-11-12T17:12:30.502663Z",
  "methods": [
    {
      "id": "85b9be1b-9872-41ac-b87f-e6d16bf217c1",
      "type": "totp",
      "name": "Telefon",
      "createdAt": "2026-11-12T17:07:30.343156Z",
      "lastUsedAt": "2026-11-12T17:07:30.42212Z",
      "emailAddress": null,
      "pending": false
    }
  ],
  "trustedDeviceAvailable": false,
  "emailCodeAvailable": false,
  "trustedDeviceDays": 14
};

const ENROLLMENT = {
  "status": "mfa_enrollment_required",
  "challengeId": "39c7054e-0efc-425c-ba38-16b6039c1045",
  "purpose": "enrollment",
  "expiresAt": "2026-11-12T17:12:30.281622Z",
  "methods": [],
  "trustedDeviceAvailable": false,
  "emailCodeAvailable": false,
  "trustedDeviceDays": 14
};

const TOTP_STARTED = {
  "methodId": "85b9be1b-9872-41ac-b87f-e6d16bf217c1",
  "type": "totp",
  "secret": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  "otpAuthUri": "otpauth://totp/Stellarr%3Amaja?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Stellarr&algorithm=SHA1&digits=6&period=30"
};

const SECURITY = {
  "requirement": "optional",
  "mfaRequired": true,
  "freshMfa": true,
  "mfaEvidence": "totp",
  "mfaCompletedAt": "2026-11-12T17:50:01.129968Z",
  "trustedDeviceAvailable": false,
  "methods": [
    {
      "id": "4d530edd-05fd-41ef-923c-8216a16f0168",
      "type": "totp",
      "name": "Aplikacja uwierzytelniająca",
      "createdAt": "2026-11-12T17:23:11.271327Z",
      "lastUsedAt": "2026-11-12T17:50:01.129806Z",
      "emailAddress": null,
      "pending": false
    },
    {
      "id": "c0ca0bf6-f775-4071-b862-f8a441323214",
      "type": "totp",
      "name": "Aplikacja uwierzytelniająca",
      "createdAt": "2026-11-12T17:39:32.662904Z",
      "lastUsedAt": "2026-11-12T17:40:01.014034Z",
      "emailAddress": null,
      "pending": false
    }
  ],
  "remainingRecoveryCodes": 10,
  "trustedDevices": [
    {
      "id": "5de3e024-e4c2-477f-9944-6257ded35eec",
      "name": "Unknown device",
      "device": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      "createdAt": "2026-11-12T17:48:31.430624Z",
      "expiresAt": "2026-11-26T17:48:31.430624Z",
      "lastUsedAt": "2026-11-12T17:48:36.976627Z"
    }
  ],
  "recentEvents": [
    {
      "id": "b1ab2d6e-52ed-462e-bb71-8cbc16a418fe",
      "kind": "mfa-succeeded",
      "detail": "totp",
      "ipAddress": "127.0.0.1",
      "device": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      "createdAt": "2026-11-12T17:50:01.130075Z"
    },
    {
      "id": "90f19529-713e-43ec-87d9-cd4230ff743d",
      "kind": "mfa-succeeded",
      "detail": "totp",
      "ipAddress": "127.0.0.1",
      "device": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      "createdAt": "2026-11-12T17:49:31.392008Z"
    }
  ],
  "freshMfaWindowSeconds": 300,
  "trustedDeviceDays": 14,
  "emailCodeAvailable": false,
  "emailResendCooldownSeconds": 45,
  "securityRecoveryRequired": false
};

const COMPLETED = {
  "status": "ok",
  "user": {
    "id": "6c1f1523-f1c3-44cd-ad2b-633f89e1826e",
    "username": "maja",
    "displayName": "Maja",
    "avatarColor": "oklch(0.58 0.14 84)",
    "presence": "online",
    "avatarUrl": null,
    "bannerUrl": null,
    "customStatus": null,
    "bio": null,
    "pronouns": null
  },
  "recoveryCodes": [
    "MCCBK8K-4ZF6BNV-4UUFXB2-ZGE585Q",
    "6PE8E3Z-AGH3QC9-X36X8N7-V8DP5GL"
  ],
  "trustedDeviceExpiresAt": null
};

describe("parseAuthResult", () => {
  it("reads a user as a finished sign-in", () => {
    expect(parseAuthResult(SIGNED_IN, "/api/auth/login")).toEqual({
      kind: "signed-in",
      user: expect.objectContaining({ username: "maja", displayName: "Maja" }),
    });
  });

  it("still reads a user inside a { user } envelope", () => {
    expect(parseAuthResult({ user: SIGNED_IN }, "/api/auth/login").kind).toBe("signed-in");
  });

  it("reads a second-factor challenge without treating it as a user", () => {
    const result = parseAuthResult(SIGN_IN_CHALLENGE, "/api/auth/login");

    expect(result).toEqual({
      kind: "challenge",
      challenge: {
        enrollment: false,
        challengeId: SIGN_IN_CHALLENGE.challengeId,
        purpose: "mfa",
        expiresAt: SIGN_IN_CHALLENGE.expiresAt,
        methods: [
          {
            id: SIGN_IN_CHALLENGE.methods[0]?.id,
            type: "totp",
            name: "Telefon",
            createdAt: SIGN_IN_CHALLENGE.methods[0]?.createdAt,
            lastUsedAt: SIGN_IN_CHALLENGE.methods[0]?.lastUsedAt,
            pending: false,
          },
        ],
        trustedDeviceAvailable: false,
        emailCodeAvailable: false,
        trustedDeviceDays: 14,
      },
    });
  });

  it("reads a required first method as an enrollment", () => {
    const result = parseAuthResult(ENROLLMENT, "/api/me/security/mfa/enroll/start");

    expect(result.kind === "challenge" && result.challenge.enrollment).toBe(true);
  });

  it("reads an operator recovery as the only way back in", () => {
    expect(parseAuthResult({ status: "security_recovery_required" }, "/api/auth/login")).toEqual({
      kind: "recovery-required",
    });
  });

  it("refuses a status it does not know rather than guessing", () => {
    expect(() => parseAuthResult({ status: "mfa_maybe" }, "/api/auth/login")).toThrow(ApiError);
  });
});

describe("parseMfaChallenge", () => {
  it("refuses a purpose it does not know", () => {
    expect(() =>
      parseMfaChallenge({ ...SIGN_IN_CHALLENGE, purpose: "anything" }, "/api/auth/mfa/pending"),
    ).toThrow(ApiError);
  });
});

describe("parseMfaEnrollment", () => {
  it("keeps the key and the otpauth address for the screen", () => {
    expect(parseMfaEnrollment(TOTP_STARTED, "/api/auth/mfa/enroll/totp/start")).toEqual({
      methodId: TOTP_STARTED.methodId,
      type: "totp",
      secret: TOTP_STARTED.secret,
      otpAuthUri: TOTP_STARTED.otpAuthUri,
    });
  });
});

describe("parseMfaCompletion", () => {
  it("keeps recovery codes only when the server issued them", () => {
    expect(parseMfaCompletion(COMPLETED, "/api/auth/mfa/enroll/totp/confirm").recoveryCodes).toEqual(
      COMPLETED.recoveryCodes,
    );
    expect(
      parseMfaCompletion({ ...COMPLETED, recoveryCodes: null }, "/api/auth/mfa/verify"),
    ).not.toHaveProperty("recoveryCodes");
  });

  it("refuses an answer that does not say the challenge is done", () => {
    expect(() =>
      parseMfaCompletion({ ...COMPLETED, status: "pending" }, "/api/auth/mfa/verify"),
    ).toThrow(ApiError);
  });
});

describe("parseAccountSecurity", () => {
  it("reads the methods, trusted devices and history the settings show", () => {
    const security = parseAccountSecurity(SECURITY, "/api/me/security");

    expect(security.methods).toHaveLength(2);
    expect(security.trustedDevices[0]).toMatchObject({ id: SECURITY.trustedDevices[0]?.id });
    expect(security.recentEvents.map((event) => event.kind)).toEqual(
      SECURITY.recentEvents.map((event) => event.kind),
    );
    expect(security).toMatchObject({
      requirement: "optional",
      remainingRecoveryCodes: SECURITY.remainingRecoveryCodes,
      trustedDeviceDays: 14,
    });
  });
});
