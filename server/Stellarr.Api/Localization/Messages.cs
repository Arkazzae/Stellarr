using System.Globalization;
using System.Text.RegularExpressions;

namespace Stellarr.Api.Localization;

/// <summary>
/// The catalog of what the server says to people, in the language of the
/// instance. Texts are plain strings with named placeholders such as
/// <c>{limit}</c>; the English texts are in <c>Messages.en.cs</c> and the
/// Polish ones in <c>Messages.pl.cs</c>. Each is a switch over
/// <see cref="MessageKey"/>, so the compiler reports a key that lacks a text.
/// </summary>
public sealed partial class Messages
{
    private readonly Func<MessageKey, string> _templates;

    public Messages(LanguageOptions options)
    {
        _templates = options.Language switch
        {
            LanguageOptions.English => English,
            LanguageOptions.Polish => Polish,
            _ => throw new ArgumentException($"Unsupported language \"{options.Language}\".", nameof(options)),
        };
        Language = options.Language;
    }

    /// <summary>The language code, <c>en</c> or <c>pl</c>.</summary>
    public string Language { get; }

    /// <summary>The text of <paramref name="key"/> with each placeholder replaced by the value of that name.</summary>
    /// <exception cref="ArgumentException">A placeholder of the text has no value.</exception>
    public string Get(MessageKey key, params (string Name, object Value)[] values) =>
        Placeholder().Replace(Template(key), match =>
        {
            foreach (var (name, value) in values)
            {
                if (name == match.Groups[1].Value)
                {
                    return Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
                }
            }

            throw new ArgumentException($"{key} needs a value for {match.Value}.", nameof(values));
        });

    /// <summary>The catalog for <c>Stellarr__Language</c>, for code that runs outside a host.</summary>
    internal static Messages FromEnvironment() =>
        new(new LanguageOptions
        {
            Language = Environment.GetEnvironmentVariable("Stellarr__Language") ?? LanguageOptions.English,
        });

    internal string Template(MessageKey key) => _templates(key);

    [GeneratedRegex(@"\{(\w+)\}", RegexOptions.CultureInvariant)]
    internal static partial Regex Placeholder();
}
