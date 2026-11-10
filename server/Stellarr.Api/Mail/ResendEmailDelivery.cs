using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Stellarr.Api.Mail;

/// <summary>Sends mail through the Resend HTTP API.</summary>
public sealed class ResendEmailDelivery(HttpClient http, IOptions<MailOptions> options) : IEmailDelivery
{
    /// <exception cref="InvalidOperationException">No API key is configured.</exception>
    /// <exception cref="HttpRequestException">The provider refused the message or answered with no id.</exception>
    public async Task<string> SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        var apiKey = options.Value.ResendApiKey;
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException("Klucz API Resend nie jest skonfigurowany.");
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, "emails")
        {
            Content = JsonContent.Create(new
            {
                from = message.From,
                to = new[] { message.To },
                subject = message.Subject,
                html = message.Html,
                text = message.Text,
            }),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        // A retry of the same message must not be delivered twice.
        request.Headers.TryAddWithoutValidation("Idempotency-Key", message.IdempotencyKey);

        using var response = await http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var detail = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new HttpRequestException(
                $"Resend odrzucił wiadomość ({(int)response.StatusCode}): {detail}",
                null,
                response.StatusCode);
        }

        await using var body = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var payload = await JsonDocument.ParseAsync(body, cancellationToken: cancellationToken);
        if (!payload.RootElement.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String)
        {
            throw new HttpRequestException("Resend nie zwrócił identyfikatora wiadomości.");
        }

        return id.GetString()!;
    }
}
