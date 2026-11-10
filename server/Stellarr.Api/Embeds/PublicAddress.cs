using System.Net;
using System.Net.Sockets;

namespace Stellarr.Api.Embeds;

/// <summary>
/// Decides whether an address is out on the internet or inside the house.
/// </summary>
/// <remarks>
/// The unfurler follows links written by whoever posted, so which addresses it
/// may connect to is a security decision. What is not on a list of reserved
/// blocks is public: the blocks IANA reserves for private, loopback,
/// link-local, shared, documentation, benchmarking, multicast and future use
/// in IPv4, and their IPv6 counterparts. An IPv4-mapped IPv6 address is judged
/// by the IPv4 address inside it.
/// </remarks>
public static class PublicAddress
{
    private static readonly IPNetwork[] ReservedV4 = Networks(
        "0.0.0.0/8",
        "10.0.0.0/8",
        "100.64.0.0/10",
        "127.0.0.0/8",
        "169.254.0.0/16",
        "172.16.0.0/12",
        "192.0.0.0/24",
        "192.0.2.0/24",
        "192.88.99.0/24",
        "192.168.0.0/16",
        "198.18.0.0/15",
        "198.51.100.0/24",
        "203.0.113.0/24",
        "224.0.0.0/3");

    /// <summary>
    /// Unspecified, loopback, unique-local, link-local, site-local and multicast
    /// addresses, the discard-only block, documentation, and 6to4, which carries
    /// an IPv4 address that is not checked here.
    /// </summary>
    private static readonly IPNetwork[] ReservedV6 = Networks(
        "::/128",
        "::1/128",
        "100::/16",
        "2001:db8::/32",
        "2002::/16",
        "fc00::/7",
        "fe80::/10",
        "fec0::/10",
        "ff00::/8");

    public static bool IsPublic(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        return address.AddressFamily switch
        {
            AddressFamily.InterNetwork => !InAny(ReservedV4, address),
            AddressFamily.InterNetworkV6 => !InAny(ReservedV6, address),
            _ => false,
        };
    }

    private static bool InAny(IPNetwork[] networks, IPAddress address)
    {
        foreach (var network in networks)
        {
            if (network.Contains(address))
            {
                return true;
            }
        }

        return false;
    }

    private static IPNetwork[] Networks(params string[] cidrs) =>
        [.. cidrs.Select(cidr => IPNetwork.Parse(cidr))];
}
