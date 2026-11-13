using System.Net;

internal static class StoppedBackendProbe
{
    internal static async Task Verify(bool processExited,Func<Task> probe)
    {
        // A network timeout alone cannot prove shutdown: a live, hung Node
        // must fail even when its HTTP endpoint is unresponsive.
        if(!processExited)throw new IOException("Owned backend process survived SCM stop");
        try { await probe(); }
        catch(HttpRequestException error) when(error.StatusCode==null) { return; }
        catch(TaskCanceledException error) when(error.InnerException is TimeoutException) { return; }
        throw new IOException("Backend HTTP endpoint responded after SCM stop");
    }

    internal static async Task SelfTest()
    {
        await Verify(true,()=>Task.FromException(new HttpRequestException("Connection refused")));
        await Verify(true,()=>Task.FromException(new TaskCanceledException("HTTP timeout",new TimeoutException())));
        async Task Reject(bool exited,Func<Task> probe)
        {
            try { await Verify(exited,probe); }
            catch(Exception error) when(error is IOException or HttpRequestException or TaskCanceledException) { return; }
            throw new Exception("Shutdown probe accepted a live server or unexpected error");
        }
        await Reject(false,()=>Task.FromException(new TaskCanceledException("HTTP timeout",new TimeoutException())));
        await Reject(true,()=>Task.CompletedTask);
        await Reject(true,()=>Task.FromException(new HttpRequestException("HTTP 503",null,HttpStatusCode.ServiceUnavailable)));
        await Reject(true,()=>Task.FromException(new TaskCanceledException("Unexpected cancellation")));
        using var client=new HttpClient(new StalledHandler()){Timeout=TimeSpan.FromMilliseconds(50)};
        await Verify(true,async()=>{using var response=await client.GetAsync("http://127.0.0.1/fixture");});
        Console.WriteLine("PASS stopped-process probe: refusal and HTTP timeout accepted only after exit; live process, HTTP response and unrelated cancellation rejected");
    }

    private sealed class StalledHandler : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token)
        {
            await Task.Delay(Timeout.Infinite,token);
            throw new InvalidOperationException("Unreachable");
        }
    }
}
