namespace Stellarr.Api.Localization;

public sealed partial class Messages
{
#pragma warning disable CS8524
    private static string Polish(MessageKey key) => key switch
    {
        MessageKey.ClientUnsupported => "Ta aplikacja nie jest już obsługiwana. Pobierz aktualnego klienta Stellarr.",
        MessageKey.ClientVersionMissing => "Ta aplikacja nie podaje swojej wersji i nie jest obsługiwana.",
        MessageKey.ClientOutdated => "Ta wersja aplikacji ({reported}) jest za stara. Wymagana jest co najmniej {minimum}.",
        MessageKey.SignInFailed => "Nieprawidłowy login lub hasło.",
    };
#pragma warning restore CS8524
}
