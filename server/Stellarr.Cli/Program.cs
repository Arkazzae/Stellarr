namespace Stellarr.Cli;

/// <summary>
/// The console app is deliberately a plain program: it never builds a web host,
/// starts a worker or opens Kestrel. Commands use the API's models and services
/// directly against the existing data volume.
/// </summary>
public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        using var cancellation = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            cancellation.Cancel();
        };

        return await CliApplication.RunAsync(
            args,
            Console.In,
            Console.Out,
            Console.Error,
            interactive: !Console.IsInputRedirected,
            secretPrompt: ReadSecret,
            cancellation.Token);
    }

    private static string? ReadSecret()
    {
        if (Console.IsInputRedirected)
        {
            return null;
        }

        Console.Error.Write("Secret value (input is hidden): ");
        var value = new System.Text.StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter)
            {
                Console.Error.WriteLine();
                return value.ToString();
            }

            if (key.Key == ConsoleKey.Backspace)
            {
                if (value.Length > 0)
                {
                    value.Length--;
                }
                continue;
            }

            if (!char.IsControl(key.KeyChar))
            {
                value.Append(key.KeyChar);
            }
        }
    }
}
