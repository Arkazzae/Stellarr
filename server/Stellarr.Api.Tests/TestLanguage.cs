using System.Runtime.CompilerServices;

namespace Stellarr.Api.Tests;

/// <summary>
/// The suite asserts the Polish texts the server spoke before English became
/// its default, so every host it builds is told to speak Polish. The setting
/// comes in through the environment because the web application factory is
/// fixed: its own in-memory settings are layered over the environment, which
/// lets a test that wants another language override this one.
/// </summary>
internal static class TestLanguage
{
    [ModuleInitializer]
    internal static void SelectPolish() => Environment.SetEnvironmentVariable("Stellarr__Language", "pl");
}
