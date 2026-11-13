using SoftechService;

// Same lifecycle callbacks and real worker as SCM, with only the native
// RequestAdditionalTime call substituted. No installed services are touched.
if(Environment.GetEnvironmentVariable("NODE_ENV")!="test"||args.Length!=2||args[0]!="--console")return 2;
string root=Path.GetFullPath(args[1]);
string signal=Path.Combine(root,Environment.GetEnvironmentVariable("SOFTECH_SERVICE_TEST_STOP_FILE")??throw new Exception("Missing fixture signal"));
Environment.SetEnvironmentVariable("SOFTECH_SERVICE_TEST_STOP_FILE",null);
try {
int requestedTime=0;
using var service=new WindowsBackendService(root,ms=>requestedTime=ms);
service.StartWorker();
while(!File.Exists(signal))await Task.Delay(50);
bool shutdown=Environment.GetEnvironmentVariable("SOFTECH_SERVICE_TEST_SHUTDOWN")=="1";
service.StopWorker(!shutdown);
if(requestedTime!=(shutdown?0:240000))throw new Exception("Incorrect SCM shutdown deadline handling");
if(!File.ReadAllText(Path.Combine(root,"logs","service.log")).Contains("SCM shutdown completed."))
    throw new Exception("Stop returned without completing shutdown");
return 0;
}catch(Exception error){Console.Error.WriteLine(error);return 1;}
