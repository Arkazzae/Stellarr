using Fido2NetLib;
using Fido2NetLib.Objects;

namespace Stellarr.Api.Tests;

/// <summary>The test authenticator against the library itself, before any endpoint uses it.</summary>
public sealed class TestAuthenticatorTests
{
    private const string RpId = "chat.test";
    private const string Origin = "https://chat.test";

    [Fact]
    public async Task SignedRegistrationAndAssertionPassTheLibrarysChecks()
    {
        var fido = new Fido2(new Fido2Configuration
        {
            RPID = RpId,
            RPName = "Stellarr",
            Origins = new HashSet<string> { Origin },
        });
        var userHandle = Guid.NewGuid().ToByteArray();
        using var authenticator = new TestAuthenticator();

        var creation = fido.RequestNewCredential(new RequestNewCredentialParams
        {
            User = new Fido2User { Id = userHandle, Name = "maja", DisplayName = "Maja" },
            AuthenticatorSelection = new AuthenticatorSelection
            {
                ResidentKey = ResidentKeyRequirement.Preferred,
                UserVerification = UserVerificationRequirement.Required,
            },
            AttestationPreference = AttestationConveyancePreference.None,
        });
        var stored = CredentialCreateOptions.FromJson(creation.ToJson());
        var registered = await fido.MakeNewCredentialAsync(new MakeNewCredentialParams
        {
            AttestationResponse = authenticator.Register(RpId, stored.Challenge, Origin),
            OriginalOptions = stored,
            IsCredentialIdUniqueToUserCallback = (_, _) => Task.FromResult(true),
        });

        var assertion = AssertionOptions.FromJson(fido.GetAssertionOptions(new GetAssertionOptionsParams
        {
            AllowedCredentials = [new PublicKeyCredentialDescriptor(registered.Id)],
            UserVerification = UserVerificationRequirement.Required,
        }).ToJson());
        var verified = await fido.MakeAssertionAsync(new MakeAssertionParams
        {
            AssertionResponse = authenticator.Assert(RpId, assertion.Challenge, Origin, userHandle),
            OriginalOptions = assertion,
            StoredPublicKey = registered.PublicKey,
            StoredSignatureCounter = registered.SignCount,
            IsUserHandleOwnerOfCredentialIdCallback = (_, _) => Task.FromResult(true),
        });

        Assert.Equal(authenticator.CredentialId, registered.Id);
        Assert.Equal(authenticator.CredentialId, verified.CredentialId);

        // A signature from another key over the same data is refused.
        using var stranger = new TestAuthenticator();
        var forged = stranger.Assert(RpId, assertion.Challenge, Origin, userHandle);
        await Assert.ThrowsAsync<Fido2VerificationException>(() => fido.MakeAssertionAsync(new MakeAssertionParams
        {
            AssertionResponse = new AuthenticatorAssertionRawResponse
            {
                Id = TestAuthenticator.Base64Url(registered.Id),
                RawId = registered.Id,
                Type = PublicKeyCredentialType.PublicKey,
                ClientExtensionResults = new AuthenticationExtensionsClientOutputs(),
                Response = forged.Response,
            },
            OriginalOptions = assertion,
            StoredPublicKey = registered.PublicKey,
            StoredSignatureCounter = registered.SignCount,
            IsUserHandleOwnerOfCredentialIdCallback = (_, _) => Task.FromResult(true),
        }));
    }
}
