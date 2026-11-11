using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Stellarr.Api.Localization;
using Stellarr.Api.Mail;

namespace Stellarr.Api.Tests;

/// <summary>What leaves the server for the mail provider, and what the server makes of its answers.</summary>
public sealed class MailDeliveryTests
{
    private static readonly EmailMessage Message = new(
        "Stellarr <noreply@chat.test>",
        "jo@example.test",
        "Temat",
        "<p>Treść</p>",
        "Treść",
        "message-1");

    [Fact]
    public async Task TheMessageGoesToResendWithTheKeyAndAnIdempotencyKey()
    {
        var provider = new StubProvider(HttpStatusCode.OK, """{"id":"email-42"}""");
        var delivery = CreateDelivery(provider);

        var id = await delivery.SendAsync(Message, "re_test", CancellationToken.None);

        Assert.Equal("email-42", id);
        var request = Assert.Single(provider.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("https://api.resend.com/emails", request.Uri);
        Assert.Equal("Bearer re_test", request.Authorization);
        Assert.Equal("message-1", request.IdempotencyKey);
        using var body = JsonDocument.Parse(request.Body);
        Assert.Equal("Stellarr <noreply@chat.test>", body.RootElement.GetProperty("from").GetString());
        Assert.Equal("jo@example.test", Assert.Single(body.RootElement.GetProperty("to").EnumerateArray()).GetString());
        Assert.Equal("Temat", body.RootElement.GetProperty("subject").GetString());
        Assert.Equal("<p>Treść</p>", body.RootElement.GetProperty("html").GetString());
        Assert.Equal("Treść", body.RootElement.GetProperty("text").GetString());
    }

    [Fact]
    public async Task ARefusedMessageIsReportedWithTheProvidersStatusAndReason()
    {
        var delivery = CreateDelivery(new StubProvider(HttpStatusCode.UnprocessableEntity, "invalid from address"));

        var failure = await Assert.ThrowsAsync<HttpRequestException>(
            () => delivery.SendAsync(Message, "re_test", CancellationToken.None));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, failure.StatusCode);
        Assert.Contains("invalid from address", failure.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AnAnswerWithoutAMessageIdIsAFailure()
    {
        var delivery = CreateDelivery(new StubProvider(HttpStatusCode.OK, "{}"));

        await Assert.ThrowsAsync<HttpRequestException>(() => delivery.SendAsync(Message, "re_test", CancellationToken.None));
    }

    [Fact]
    public async Task WithoutAnApiKeyNothingIsSent()
    {
        var provider = new StubProvider(HttpStatusCode.OK, """{"id":"email-42"}""");
        var delivery = CreateDelivery(provider);

        await Assert.ThrowsAsync<InvalidOperationException>(() => delivery.SendAsync(Message, " ", CancellationToken.None));

        Assert.Empty(provider.Requests);
    }

    [Fact]
    public void ThePasswordResetMailEscapesNamesInItsHtmlOnly()
    {
        var tokenId = Guid.NewGuid();

        var mail = AccountEmail.PasswordReset(
            "Stellarr <noreply@chat.test>",
            "jo@example.test",
            "<b>Jo</b>",
            "Orbit & Co",
            "https://chat.test/reset-hasla?token=abc&x=1",
            tokenId,
            new Messages(new LanguageOptions { Language = "pl" }));

        Assert.Contains("&lt;b&gt;Jo&lt;/b&gt;", mail.Html, StringComparison.Ordinal);
        Assert.DoesNotContain("<b>Jo</b>", mail.Html, StringComparison.Ordinal);
        Assert.Contains("Orbit &amp; Co", mail.Html, StringComparison.Ordinal);
        Assert.Contains("href=\"https://chat.test/reset-hasla?token=abc&amp;x=1\"", mail.Html, StringComparison.Ordinal);
        Assert.Contains("<b>Jo</b>", mail.Text, StringComparison.Ordinal);
        Assert.Contains("https://chat.test/reset-hasla?token=abc&x=1", mail.Text, StringComparison.Ordinal);
        Assert.Equal("Zmień hasło w Orbit & Co", mail.Subject);
        // The same message is the same delivery, whichever attempt sends it.
        Assert.Equal($"password-reset/{tokenId:N}", mail.IdempotencyKey);
    }

    private static ResendEmailDelivery CreateDelivery(StubProvider provider) =>
        new(new HttpClient(provider) { BaseAddress = new Uri("https://api.resend.com/") });

    private sealed record SentRequest(
        HttpMethod Method,
        string Uri,
        string? Authorization,
        string? IdempotencyKey,
        string Body);

    private sealed class StubProvider(HttpStatusCode status, string body) : HttpMessageHandler
    {
        private readonly List<SentRequest> _requests = [];

        internal IReadOnlyList<SentRequest> Requests => _requests;

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            _requests.Add(new SentRequest(
                request.Method,
                request.RequestUri!.ToString(),
                request.Headers.Authorization?.ToString(),
                request.Headers.TryGetValues("Idempotency-Key", out var keys) ? keys.Single() : null,
                await request.Content!.ReadAsStringAsync(cancellationToken)));
            return new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }
}
