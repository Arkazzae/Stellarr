namespace Stellarr.Api.Contracts;

/// <summary>A package of a native client that this server offers for download.</summary>
/// <param name="Platform">The platform the package is built for, such as <c>arch</c> or <c>android</c>.</param>
/// <param name="Sha256">Lower-case hex digest of the package.</param>
/// <param name="DownloadUrl">Where this server serves the package.</param>
public sealed record ClientReleaseDto(
    string Version,
    DateTime PublishedAt,
    string Notes,
    string Platform,
    string Architecture,
    string FileName,
    long SizeBytes,
    string Sha256,
    string DownloadUrl);
