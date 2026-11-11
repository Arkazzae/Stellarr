using Microsoft.Extensions.Options;

namespace Stellarr.Api.Localization;

/// <summary>
/// The language of the instance, set by <c>Stellarr:Language</c> (the
/// environment variable <c>Stellarr__Language</c>). Everything the server says
/// to people is in this one language; it is not chosen per user or per request.
/// </summary>
public sealed class LanguageOptions
{
    public const string SectionName = "Stellarr";
    public const string SettingName = "Stellarr:Language";
    public const string English = "en";
    public const string Polish = "pl";

    private string _language = English;

    /// <summary>
    /// <c>en</c> or <c>pl</c>. A blank value means English: that is how a
    /// variable that a deployment file passes on without setting it arrives.
    /// </summary>
    public string Language
    {
        get => _language;
        set => _language = string.IsNullOrWhiteSpace(value) ? English : value;
    }
}

/// <summary>Stops the server at start-up when the language is one it has no catalog for.</summary>
internal sealed class LanguageOptionsValidator : IValidateOptions<LanguageOptions>
{
    public ValidateOptionsResult Validate(string? name, LanguageOptions options) =>
        options.Language is LanguageOptions.English or LanguageOptions.Polish
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(
                $"{LanguageOptions.SettingName} is \"{options.Language}\" but must be \"{LanguageOptions.English}\" " +
                $"or \"{LanguageOptions.Polish}\".");
}
