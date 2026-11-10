using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;

namespace Stellarr.Api.Tests;

public sealed partial class ChannelMessageFlowTests
{
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(10);

    /// <summary>A started hub connection of <paramref name="username"/> that records the named events.</summary>
    private async Task<EventLog> ListenAsync(string username, params string[] methods)
    {
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        using var login = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username, password = Accounts[username].Password });
        login.EnsureSuccessStatusCode();
        var cookie = string.Join("; ", login.Headers.GetValues("Set-Cookie").Select(x => x.Split(';', 2)[0]));

        var connection = new HubConnectionBuilder()
            .WithUrl("https://localhost/hubs/app", options =>
            {
                options.Headers["Cookie"] = cookie;
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
            })
            .Build();
        var log = new EventLog(connection, methods);
        // The hub's first word to a connection comes after it has joined its groups.
        var joined = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var subscription = connection.On<JsonElement>("PresenceChanged", payload =>
        {
            if (payload.GetProperty("userId").GetString() == Accounts[username].Id.ToString())
            {
                joined.TrySetResult();
            }
        });
        await connection.StartAsync();
        await joined.Task.WaitAsync(Patience);
        return log;
    }

    /// <summary>The events a connection received, per method, in the order they arrived.</summary>
    private sealed class EventLog : IAsyncDisposable
    {
        private readonly HubConnection _connection;
        private readonly Dictionary<string, System.Threading.Channels.Channel<JsonElement>> _events = [];

        public EventLog(HubConnection connection, IEnumerable<string> methods)
        {
            _connection = connection;
            foreach (var method in methods)
            {
                var inbox = System.Threading.Channels.Channel.CreateUnbounded<JsonElement>();
                _events[method] = inbox;
                connection.On<JsonElement>(method, payload => inbox.Writer.TryWrite(payload));
            }
        }

        public async Task<JsonElement> Next(string method) =>
            await _events[method].Reader.ReadAsync().AsTask().WaitAsync(Patience);

        /// <summary>Events that arrived and that the test has not asked for yet.</summary>
        public int Pending(string method) => _events[method].Reader.Count;

        public ValueTask DisposeAsync() => _connection.DisposeAsync();
    }
}
