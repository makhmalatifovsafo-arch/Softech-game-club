using System.IO;
using System.Text.Json;
using System.Windows;
using NetCafeClient;
class ClientProtocolAudit
{
 [STAThread] static void Main(string[] args)
 {
  if(args.Length!=1)throw new Exception("Test websocket URL required");
  File.WriteAllText(Path.Combine(AppContext.BaseDirectory,"config.json"),JsonSerializer.Serialize(new {serverUrl=args[0],pcNumber="PC-07",heartbeatIntervalSeconds=1}));
  var app=new Application {ShutdownMode=ShutdownMode.OnExplicitShutdown};
  app.Startup+=async (_,_)=>{
   var service=new WebSocketClientService();var done=new TaskCompletionSource();
   int connections=0,starts=0;bool zeroBalance=false,time=false,stopped=false,locked=false,config=false,power=false;
   service.OnConnectionStatusChanged+=online=>{if(online)connections++;};
   service.OnStartSession+=(id,seconds,tariff,name,balance)=>{starts++;zeroBalance|=id=="paid-session"&&seconds==1800&&balance==0;};
   service.OnUpdateTime+=seconds=>time=seconds==600;
   service.OnStopSession+=reason=>stopped=reason=="test-end";
   service.OnLockScreen+=()=>locked=true;
   service.OnPcConfigReceived+=(zone,rate,formatted,qr)=>config=zone=="VIP"&&rate==12000;
   service.OnPowerCommand+=command=>power=command=="REBOOT"; // Observe only; never execute Windows power commands.
   service.OnEmergencyLockdown+=(reason,message)=>{if(reason=="audit-ban")done.TrySetResult();};
   try{
    service.Start();await done.Task.WaitAsync(TimeSpan.FromSeconds(25));
    if(connections<2||starts<2||!zeroBalance||!time||!stopped||!locked||!config||!power)throw new Exception($"Protocol mismatch: connections={connections},starts={starts},zero={zeroBalance},time={time},stop={stopped},lock={locked},config={config},power={power}");
    Console.WriteLine("PASS native client WebSocket handshake, fragmented messages, zero-balance session, time/config/lock/stop/power dispatch, disconnect and reconnect");
   }catch(Exception error){Console.Error.WriteLine(error.Message);Environment.ExitCode=1;}
   finally{service.Stop();app.Shutdown();}
  };
  app.Run();
 }
}
