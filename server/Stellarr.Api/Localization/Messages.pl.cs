namespace Stellarr.Api.Localization;

public sealed partial class Messages
{
#pragma warning disable CS8524
    private static string Polish(MessageKey key) => key switch
    {
        // Client gate and sign-in
        MessageKey.ClientUnsupported => "Ta aplikacja nie jest już obsługiwana. Pobierz aktualnego klienta Stellarr.",
        MessageKey.ClientVersionMissing => "Ta aplikacja nie podaje swojej wersji i nie jest obsługiwana.",
        MessageKey.ClientOutdated => "Ta wersja aplikacji ({reported}) jest za stara. Wymagana jest co najmniej {minimum}.",
        MessageKey.SignInFailed => "Nieprawidłowy login lub hasło.",

        // Passwords and accounts
        MessageKey.PasswordTooShort => "Hasło musi mieć co najmniej {min} znaków.",
        MessageKey.PasswordTooLong => "Hasło może mieć najwyżej {max} znaków.",
        MessageKey.NewPasswordTooLong => "Nowe hasło może mieć najwyżej {max} znaków.",
        MessageKey.RecoveryEmailChangeDisabled => "Zmiana adresu odzyskiwania wymaga potwierdzenia nowego adresu i jest obecnie wyłączona.",
        MessageKey.VadSensitivityRange => "Czułość wykrywania mowy musi mieścić się w zakresie od 0 do 100.",
        MessageKey.JoinSoundNotAvailable => "Wybierz dźwięk z soundboardu serwera, na którym jesteś.",
        MessageKey.AccountDisplayNameLength => "Nazwa wyświetlana musi mieć od 1 do {max} znaków.",
        MessageKey.BioTooLong => "Opis może mieć najwyżej {max} znaków.",
        MessageKey.CustomStatusTooLong => "Status może mieć najwyżej {max} znaków.",
        MessageKey.PronounsTooLong => "Zaimki mogą mieć najwyżej {max} znaki.",
        MessageKey.PasswordResetLinkInvalid => "Link do zmiany hasła jest nieprawidłowy lub wygasł.",

        // Registration
        MessageKey.InviteUnusable => "Zaproszenie wygasło, osiągnęło limit użyć albo jest nieprawidłowe.",
        MessageKey.InviteRequired => "Do utworzenia konta na istniejącej instancji wymagane jest zaproszenie.",
        MessageKey.InviteServerGone => "Serwer wskazany przez zaproszenie już nie istnieje.",
        MessageKey.InstanceHasNoMemberRole => "Instancja nie ma roli dla nowych użytkowników.",
        MessageKey.UsernameInvalid => "Nazwa użytkownika musi mieć 3–32 znaki: litery, cyfry, kropkę, myślnik lub podkreślenie.",
        MessageKey.RegistrationDisplayNameLength => "Nazwa widoczna musi mieć od 1 do 64 znaków.",
        MessageKey.EmailInvalid => "Podaj poprawny adres e-mail.",
        MessageKey.UsernameTaken => "Ta nazwa użytkownika jest już zajęta.",
        MessageKey.EmailTaken => "Konto z tym adresem e-mail już istnieje.",

        // Channels and sections
        MessageKey.ChannelNameOrKindInvalid => "Nazwa lub typ kanału jest nieprawidłowy.",
        MessageKey.ChannelNameInvalid => "Nazwa kanału jest nieprawidłowa.",
        MessageKey.ChannelSettingInvalid => "Co najmniej jedno ustawienie kanału jest nieprawidłowe.",
        MessageKey.ChannelSettingWrongKind => "To ustawienie nie pasuje do typu kanału.",
        MessageKey.ChannelOrderIncomplete => "Lista musi zawierać każdy kanał dokładnie raz.",
        MessageKey.SectionNameInvalid => "Nazwa sekcji jest nieprawidłowa.",
        MessageKey.SectionOrderIncomplete => "Lista musi zawierać każdą sekcję dokładnie raz.",

        // Messages
        MessageKey.ReactionInvalid => "Reakcja musi mieć od 1 do {max} znaków i nie może zawierać spacji.",
        MessageKey.PinLimitReached => "Kanał może mieć najwyżej {max} przypiętych wiadomości. Odepnij coś, aby zrobić miejsce.",
        MessageKey.AttachmentLimit => "Wiadomość może zawierać najwyżej {max} załączników.",
        MessageKey.MessageIdInvalid => "Identyfikator wiadomości jest nieprawidłowy.",
        MessageKey.MessageContentInvalid => "Wiadomość musi zawierać tekst lub załącznik i mieć najwyżej {max} znaków.",
        MessageKey.ReplyTargetInvalid => "Odpowiedź musi wskazywać istniejącą wiadomość z tego samego kanału.",
        MessageKey.AttachmentsNotFound => "Co najmniej jeden załącznik nie istnieje albo należy do innego użytkownika.",
        MessageKey.SlowModeActive => "Tryb powolny jest aktywny",
        MessageKey.SlowModeWait => "Następną wiadomość możesz wysłać za {seconds} s.",
        MessageKey.VoiceMessageAlone => "Wiadomość głosowa musi być wysłana samodzielnie, bez tekstu i innych załączników.",
        MessageKey.MessageEditContentInvalid => "Wiadomość musi zawierać tekst i mieć najwyżej {max} znaków.",

        // Message history and search
        MessageKey.PageLimitRange => "Limit musi mieścić się w zakresie 1–{max}.",
        MessageKey.HistoryCursorInvalid => "Kursor historii wiadomości jest nieprawidłowy.",
        MessageKey.DirectHistoryCursorInvalid => "Kursor historii wiadomości prywatnych jest nieprawidłowy.",
        MessageKey.SyncCursorInvalid => "Kursor synchronizacji lub limit jest nieprawidłowy.",
        MessageKey.SearchQueryLength => "Wyszukiwana fraza musi mieć od {min} do {max} znaków.",
        MessageKey.IndexKindInvalid => "Rodzaj indeksu musi mieć wartość all, media albo links.",
        MessageKey.IndexCursorInvalid => "Kursor indeksu wiadomości jest nieprawidłowy.",

        // Roles and permissions
        MessageKey.PermissionUnknown => "Co najmniej jedno uprawnienie jest nieznane.",
        MessageKey.PermissionAllowedAndDenied => "To samo uprawnienie nie może być jednocześnie dozwolone i zabronione.",
        MessageKey.RoleInvalid => "Nazwa, kolor lub lista uprawnień roli jest nieprawidłowa.",

        // Operator panel
        MessageKey.OpsUserInvalid => "Sprawdź login, nazwę, e-mail i hasło (minimum 8 znaków).",
        MessageKey.OpsRoleMustNotBeOwner => "Wybierz rolę inną niż właściciel.",
        MessageKey.OpsCannotDisableSelf => "Nie możesz wyłączyć własnego konta.",
        MessageKey.OpsCannotDisableOwner => "Konta właściciela nie można wyłączyć.",
        MessageKey.OpsInstanceNameLength => "Nazwa instancji musi mieć od 1 do 80 znaków.",
        MessageKey.OpsPublicUrlInvalid => "Podaj bezwzględny adres HTTPS. HTTP jest dozwolone tylko dla localhost.",
        MessageKey.OpsTimeZoneUnavailable => "Ta strefa czasowa nie jest dostępna na serwerze.",
        MessageKey.OpsTimeZoneBroken => "Konfiguracja strefy czasowej na serwerze jest nieprawidłowa.",
        MessageKey.OpsMailFromRequired => "Włączony mailing wymaga poprawnego adresu nadawcy.",
        MessageKey.OpsBackupRetentionRange => "Retencja backupów musi wynosić od 1 do {max} dni.",
        MessageKey.OpsLogRetentionRange => "Retencja logów musi wynosić od 1 do {max} dni.",
        MessageKey.OpsOrphanRetentionRange => "Retencja osieroconych obiektów musi wynosić od 1 do {max} dni.",
        MessageKey.OpsVersionInvalid => "Podaj stabilną wersję w formacie major.minor.patch.",
        MessageKey.OpsRecommendedBelowMinimum => "Wersja zalecana nie może być niższa od minimalnej.",
        MessageKey.OpsReleaseManifestBroken => "Manifest wydania aplikacji wymaga naprawy.",
        MessageKey.OpsVersionsSavedManifestBroken => "Wersje zapisano, ale manifest wydania aplikacji wymaga naprawy.",
        MessageKey.OpsTestMailRecipientInvalid => "Podaj poprawny adres odbiorcy.",
        MessageKey.OpsMailNotReadyTitle => "Resend nie jest gotowy",
        MessageKey.OpsMailNotReadyDetail => "Włącz mailing, ustaw adres nadawcy i dodaj Mail__ResendApiKey w środowisku backendu.",
        MessageKey.OpsBackupFailedIntegrity => "Backup nie przeszedł kontroli integralności.",
        MessageKey.OpsDatabaseHealthy => "Połączenie i zapytanie kontrolne działają.",
        MessageKey.OpsDatabaseDown => "Baza nie odpowiada.",
        MessageKey.OpsRealtimeConnections => "{count} aktywnych połączeń",
        MessageKey.OpsMaintenanceRunning => "Retencja jest uruchomiona.",
        MessageKey.OpsMaintenanceOff => "Wyłączony w konfiguracji.",
        MessageKey.OpsStorageInitializationOff => "Inicjalizacja wyłączona.",
        MessageKey.OpsStorageChecked => "Bucket został sprawdzony podczas startu.",

        // Uploads and images
        MessageKey.FileEmpty => "Plik jest pusty.",
        MessageKey.ImageTypesAllowed => "Dozwolone są obrazy JPEG, PNG, GIF i WebP.",
        MessageKey.FileContentMismatch => "Zawartość pliku nie odpowiada zadeklarowanemu typowi.",
        MessageKey.UploadTypeUnsupported => "Nieobsługiwany format załącznika",
        MessageKey.UploadTypesAllowed => "Dozwolone są obsługiwane obrazy, audio i wideo oraz pliki PDF, ZIP, TXT, JSON, DOCX, XLSX i PPTX.",
        MessageKey.UploadTooLarge => "Załącznik jest za duży",
        MessageKey.UploadImageMaximum => "Maksymalny rozmiar obrazu to 10 MB.",
        MessageKey.UploadAudioMaximum => "Maksymalny rozmiar audio to 25 MB.",
        MessageKey.UploadVideoMaximum => "Maksymalny rozmiar wideo to 100 MB.",
        MessageKey.UploadFileMaximum => "Maksymalny rozmiar pliku to 25 MB.",
        MessageKey.UploadOverLimit => "Załącznik przekracza limit.",
        MessageKey.UploadTypeMismatch => "Nieprawidłowy format załącznika",
        MessageKey.UploadPosterInvalid => "Podgląd wideo jest nieprawidłowy.",
        MessageKey.VoiceMessageInvalid => "Wiadomość głosowa musi być nagraniem audio o długości do {minutes} minut.",
        MessageKey.MediaDurationInvalid => "Czas trwania pliku jest nieprawidłowy.",
        MessageKey.MediaDimensionsInvalid => "Wymiary pliku są nieprawidłowe.",
        MessageKey.StorageFull => "Brak miejsca na załącznik",
        MessageKey.StorageUserQuota => "Wykorzystano limit miejsca dla tego konta.",
        MessageKey.StorageInstanceQuota => "Instancja wykorzystała skonfigurowany limit miejsca na załączniki.",
        MessageKey.StorageLowDisk => "Serwer zachowuje rezerwę wolnego miejsca potrzebną bazie danych i logom.",
        MessageKey.StorageUnavailable => "Serwer nie może teraz przyjąć kolejnego załącznika.",
        MessageKey.ServerNameLength => "Nazwa serwera musi mieć od 1 do 80 znaków.",
        MessageKey.ServerDescriptionLength => "Opis serwera może mieć najwyżej 280 znaków.",
        MessageKey.ServerIconTooLarge => "Ikona jest za duża",
        MessageKey.ServerIconMaximum => "Ikona serwera może mieć najwyżej 4 MB.",
        MessageKey.ServerIconTypeUnsupported => "Nieobsługiwany format ikony",
        MessageKey.ServerIconTypeMismatch => "Nieprawidłowy format ikony",
        MessageKey.ProfileImageTooLarge => "Obraz jest za duży",
        MessageKey.ProfileImageTypeUnsupported => "Nieobsługiwany format obrazu",
        MessageKey.ProfileImageTypeMismatch => "Nieprawidłowy format obrazu",
        MessageKey.AvatarMaximum => "Awatar może mieć najwyżej 4 MB.",
        MessageKey.BannerMaximum => "Baner może mieć najwyżej 8 MB.",
        MessageKey.EmojiShortcodeInvalid => "Nazwa musi mieć 2–32 znaki: małe litery, cyfry lub podkreślenie.",
        MessageKey.EmojiLimitReached => "Limit emoji został osiągnięty",
        MessageKey.EmojiLimitDetail => "Serwer może mieć najwyżej {max} własnych emoji.",
        MessageKey.EmojiTooLarge => "Emoji jest za duże",
        MessageKey.EmojiMaximum => "Maksymalny rozmiar pliku emoji to 512 KB.",
        MessageKey.EmojiTypeUnsupported => "Nieobsługiwany format emoji",
        MessageKey.EmojiTypeMismatch => "Nieprawidłowy format emoji",

        // Servers
        MessageKey.ChannelUnknown => "Nieznany kanał.",
        MessageKey.TransferTargetInvalid => "Wybierz innego członka serwera.",
        MessageKey.ServerNameOrDescriptionInvalid => "Nazwa musi mieć 1–80 znaków, a opis najwyżej 280.",
        MessageKey.StarterChannelNameInvalid => "Nazwa kanału startowego jest nieprawidłowa.",
        MessageKey.StarterChannelNamesCollide => "Kanały startowe muszą mieć różne nazwy.",
        MessageKey.ServerHasNoMemberRole => "Serwer nie ma roli dla nowych członków.",

        // Soundboard
        MessageKey.SoundAttachmentInvalid => "Wybierz przesłany plik audio z rozpoznanym czasem trwania.",
        MessageKey.SoundInvalid => "Nazwa musi mieć 1–32 znaki, symbol 1–16 znaków, a wycinek {min}–{max} s.",

        // Client releases
        MessageKey.AndroidReleaseUnavailable => "Wydanie Android jest chwilowo niedostępne.",
        MessageKey.DesktopReleaseUnavailable => "Wydanie desktopowe jest chwilowo niedostępne.",
        MessageKey.ReleaseListUnavailable => "Lista wydań aplikacji jest chwilowo niedostępna.",
        MessageKey.DesktopUpdateUnavailable => "Aktualizacja desktopowa jest chwilowo niedostępna.",

        // Friends and moderation
        MessageKey.FriendUsernameRequired => "Podaj nazwę użytkownika.",
        MessageKey.BanReasonTooLong => "Powód bana może mieć najwyżej {max} znaków.",

        // Desktop browser sign-in
        MessageKey.BrowserLoginExpiredHeading => "Link wygasł",
        MessageKey.BrowserLoginExpiredBody => "Wróć do Stellarr Desktop i rozpocznij logowanie ponownie.",
        MessageKey.BrowserLoginApprovedByAnother => "To logowanie zostało już zatwierdzone przez inne konto.",
        MessageKey.BrowserLoginDoneHeading => "Zalogowano do Stellarr",
        MessageKey.BrowserLoginDoneBody => "Możesz zamknąć tę kartę i wrócić do aplikacji desktopowej.",
        MessageKey.BrowserLoginLinkInvalid => "Link logowania jest nieprawidłowy albo wygasł.",
    };
#pragma warning restore CS8524
}
