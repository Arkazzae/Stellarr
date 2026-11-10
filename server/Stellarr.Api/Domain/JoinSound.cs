namespace Stellarr.Api.Domain;

/// <summary>
/// The personal clip that announces one person's arrival in a voice room.
///
/// It is picked from the soundboards of the servers that person belongs to and
/// never uploaded separately: a clip that a server's staff already accepted is
/// the only sound somebody can make a room play by walking in.
/// </summary>
public static class JoinSound
{
    /// <summary>
    /// The most of a clip that a room ever hears. A greeting may be
    /// recognisable but must not hold the floor, so the audible window starts
    /// where the soundboard clip starts and stops here whatever the clip does.
    /// </summary>
    public const double MaxSeconds = 5;

    /// <summary>
    /// How soon after an announcement the same person's next one is silent. It
    /// stops a rejoin loop from turning into a soundboard nobody can mute; the
    /// join itself is never delayed or refused.
    /// </summary>
    public static readonly TimeSpan Cooldown = TimeSpan.FromSeconds(30);

    /// <summary>Where the audible window of one soundboard clip ends, in seconds.</summary>
    public static double WindowEnd(double trimStartSeconds, double trimEndSeconds) =>
        Math.Min(trimEndSeconds, trimStartSeconds + MaxSeconds);
}
