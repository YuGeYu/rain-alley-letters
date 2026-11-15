using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace BiliDesk.Services;

// Rain Alley integration, 2026-11-05: optional isolated QA profile.
// Normal launches retain upstream's data directory and single-instance identity.
internal static class RainAlleyProfile
{
    private static readonly string? Override = ReadOverride();
    private static string? ReadOverride()
    {
        var value = Environment.GetEnvironmentVariable("RAIN_ALLEY_BILIDESK_PROFILE");
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (!Path.IsPathFullyQualified(value)) throw new ArgumentException("BiliDesk profile must use an absolute path.");
        return Path.GetFullPath(value);
    }

    internal static string DataDir => Override ?? Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BiliDesk");
    internal static string InstanceSuffix => Override == null ? "" : "." +
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Override.ToUpperInvariant())))[..20];
}
