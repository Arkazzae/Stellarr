namespace Stellarr.Api.Localization;

public sealed partial class Messages
{
    // An undefined enum value is a bug of its own; what the compiler must still
    // report is a key without a text.
#pragma warning disable CS8524
    private static string English(MessageKey key) => key switch
    {
        MessageKey.ClientUnsupported => "This app is no longer supported. Download the current Stellarr client.",
        MessageKey.ClientVersionMissing => "This app does not report its version and is not supported.",
        MessageKey.ClientOutdated => "This version of the app ({reported}) is too old. {minimum} or newer is required.",
        MessageKey.SignInFailed => "Invalid username or password.",
    };
#pragma warning restore CS8524
}
