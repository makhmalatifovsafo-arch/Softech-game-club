using System.IO;
using System.Text.Json;
using System.Windows;
using NetCafeClient;
class ClientProtocolAudit
{
 [STAThread] static void Main(string[] args)
 {
  if(args.Length!=2)throw new Exception("Test websocket and update URLs required");
  File.WriteAllText(Path.Combine(AppContext.BaseDirectory,"config.json"),JsonSerializer.Serialize(new {serverUrl=args[0],pcNumber="PC-07",heartbeatIntervalSeconds=1}));
  var app=new Application {ShutdownMode=ShutdownMode.OnExplicitShutdown};
  System.Threading.SynchronizationContext.SetSynchronizationContext(new System.Windows.Threading.DispatcherSynchronizationContext(app.Dispatcher));
  // Exercise the real login form without showing a window or installing hooks.
  var loginWindow=new LockWindow();
  var loginInput=(System.Windows.Controls.TextBox)loginWindow.FindName("TxtPhone");
  var passwordInput=(System.Windows.Controls.PasswordBox)loginWindow.FindName("TxtPassword");
  string sentLogin=null,sentPassword=null;int sentMinutes=0;
  loginWindow.OnLoginRequested+=(login,password,minutes)=>{sentLogin=login;sentPassword=password;sentMinutes=minutes;};
  loginInput.Text=" gamer1 ";passwordInput.Password=" password with spaces ";
  typeof(LockWindow).GetMethod("SubmitLogin",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!.Invoke(loginWindow,null);
  if(sentLogin!="gamer1"||sentPassword!=" password with spaces "||sentMinutes<=0)throw new Exception("Kiosk username/password form failed");
  if(LockWindow.NormalizeLogin(" +998 (90) 123-45-67 ")!="+998901234567")throw new Exception("Phone login normalization failed");
  loginWindow.ResetFields();
  if(loginInput.Text!=""||passwordInput.Password!="")throw new Exception("Previous user's credentials were retained");
  var root=(FrameworkElement)loginWindow.Content;
  root.Measure(new Size(1280,800));root.Arrange(new Rect(0,0,1280,800));root.UpdateLayout();
  var image=new System.Windows.Media.Imaging.RenderTargetBitmap(1280,800,96,96,System.Windows.Media.PixelFormats.Pbgra32);image.Render(root);
  var encoder=new System.Windows.Media.Imaging.PngBitmapEncoder();encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(image));
  Directory.CreateDirectory(".test-output");using(var output=File.Create(".test-output/client-lock-login.png"))encoder.Save(output);
  Console.WriteLine("PASS native kiosk username/phone login form, unchanged password and cleared credentials");
  // Authenticate entirely offline, without executing exit or changing Windows restrictions.
  string configPath=Path.Combine(AppContext.BaseDirectory,"config.json");
  string fixtureConfig=File.ReadAllText(configPath);
  const string emergencyPassword="fixture-only emergency password";
  File.WriteAllText(configPath,Softech.Security.EmergencyPassword.Configure(fixtureConfig,"",emergencyPassword,emergencyPassword));
  var guard=new EmergencyAccessGuard();
  if(guard.Authenticate(configPath,emergencyPassword)!=null)throw new Exception("Offline owner password rejected");
  for(int i=0;i<5;i++)if(guard.Authenticate(configPath,"wrong")==null)throw new Exception("Wrong password granted access");
  if(guard.Authenticate(configPath,emergencyPassword)==null)throw new Exception("Retry lockout bypassed");
  if(new EmergencyAccessGuard().Authenticate(configPath+".missing",emergencyPassword)==null)throw new Exception("Missing configuration granted access");
  var flags=System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic;
  var submit=typeof(LockWindow).GetMethod("BtnAdminAuthSubmit_Click",flags)!;
  var busy=typeof(LockWindow).GetField("_adminAuthInProgress",flags)!;
  var granted=typeof(LockWindow).GetField("_adminAccessGranted",flags)!;
  var emergencyInput=(System.Windows.Controls.PasswordBox)loginWindow.FindName("TxtAdminPassword");
  void WaitForAuth(){
   var frame=new System.Windows.Threading.DispatcherFrame();
   var deadline=DateTime.UtcNow.AddSeconds(10);
   var timer=new System.Windows.Threading.DispatcherTimer{Interval=TimeSpan.FromMilliseconds(10)};
   timer.Tick+=(_,_)=>{if(!(bool)busy.GetValue(loginWindow)!||DateTime.UtcNow>deadline)frame.Continue=false;};
   timer.Start();System.Windows.Threading.Dispatcher.PushFrame(frame);timer.Stop();
   if((bool)busy.GetValue(loginWindow)!)throw new Exception("Emergency authentication timed out");
  }
  loginWindow.OpenAdminMaintenanceModal();emergencyInput.Password="wrong";submit.Invoke(loginWindow,new object[]{null,new RoutedEventArgs()});WaitForAuth();
  if((bool)granted.GetValue(loginWindow)!)throw new Exception("Wrong password opened maintenance UI");
  emergencyInput.Password=emergencyPassword;submit.Invoke(loginWindow,new object[]{null,new RoutedEventArgs()});WaitForAuth();
  if(!(bool)granted.GetValue(loginWindow)!||emergencyInput.Password!="")throw new Exception("Offline emergency UI did not authenticate/clear password");
  loginWindow.ResetFields();
  if((bool)granted.GetValue(loginWindow)!)throw new Exception("Reset retained owner authorization");
  loginWindow.OpenAdminMaintenanceModal();emergencyInput.Password=emergencyPassword;submit.Invoke(loginWindow,new object[]{null,new RoutedEventArgs()});
  loginWindow.ResetFields();loginWindow.OpenAdminMaintenanceModal();WaitForAuth();
  if((bool)granted.GetValue(loginWindow)!)throw new Exception("Stale authentication granted access to reopened modal");
  loginWindow.ResetFields();File.WriteAllText(configPath,fixtureConfig);
  Console.WriteLine("PASS offline emergency UI, incorrect password, retry cooldown and stale-auth rejection");
  var summary=new MemberSessionSummary("notice-test","member-test",42,30,3500,3500,46500,22000);
  loginWindow.ShowMemberSessionSummary(summary);
  var summaryText=(System.Windows.Controls.TextBlock)loginWindow.FindName("MemberSessionSummaryText");
  if(!summaryText.Text.Contains("member-test")||!summaryText.Text.Contains("42")||summaryText.Visibility!=Visibility.Visible)throw new Exception("Member receipt missing account identity");
  loginWindow.ShowSessionBarNotice("notice-test", "Siz 1 ta Cola, 2 ta Fanta olgansiz.", 22000);
  if(!summaryText.Text.Contains("member-test"))throw new Exception("Bar notice replaced account receipt");
  var noticeOverlay=(System.Windows.Controls.Grid)loginWindow.FindName("SessionBarNoticeOverlay");
  if(noticeOverlay.Visibility!=Visibility.Visible)throw new Exception("Bar notice did not appear");
  var noticeFrame=new System.Windows.Threading.DispatcherFrame();
  var noticeStart=System.Diagnostics.Stopwatch.StartNew();
  var noticeCheck=new System.Windows.Threading.DispatcherTimer{Interval=TimeSpan.FromMilliseconds(50)};
  bool checkedBefore=false;
  noticeCheck.Tick+=(_,_)=>{
   if(noticeStart.Elapsed.TotalSeconds<7){if(noticeOverlay.Visibility!=Visibility.Visible)throw new Exception("Bar notice closed early");checkedBefore=true;}
   if(noticeStart.Elapsed.TotalSeconds>=8.5)noticeFrame.Continue=false;
  };
  noticeCheck.Start();System.Windows.Threading.Dispatcher.PushFrame(noticeFrame);noticeCheck.Stop();
  if(!checkedBefore||noticeOverlay.Visibility!=Visibility.Collapsed)throw new Exception("Bar notice must close after eight seconds");
  if(summaryText.Text!=""||summaryText.Visibility!=Visibility.Collapsed)throw new Exception("Account receipt was retained after dismissal");
  loginWindow.ShowSessionBarNotice("notice-test", "Duplicate", 22000);
  if(noticeOverlay.Visibility!=Visibility.Collapsed)throw new Exception("Duplicate stop reopened bar notice");
  loginWindow.ShowMemberSessionSummary(summary with {SessionId="member-only",BarDebt=0});
  if(noticeOverlay.Visibility!=Visibility.Visible)throw new Exception("Account receipt without bar order missing");
  loginWindow.ResetFields();if(summaryText.Text!="")throw new Exception("New login retained previous account receipt");
  Console.WriteLine("PASS client bar reminder displays for eight seconds, dismisses only the reminder and ignores duplicate packets");
  var widget=new TimeWidgetWindow();int expirations=0;widget.OnSessionExpired+=()=>expirations++;
  var tick=typeof(TimeWidgetWindow).GetMethod("Timer_Tick",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!;
  widget.UpdateTime(0);tick.Invoke(widget,new object[]{null,EventArgs.Empty});tick.Invoke(widget,new object[]{null,EventArgs.Empty});
  if(expirations!=1)throw new Exception("Local prepaid expiry must fire once even without a server STOP");
  widget.UpdateTime(-1);tick.Invoke(widget,new object[]{null,EventArgs.Empty});
  if(expirations!=1)throw new Exception("Open-ended session was incorrectly expired");
  var logoutButton=(System.Windows.Controls.Button)widget.FindName("BtnLogout");
  if(logoutButton.Visibility!=Visibility.Collapsed)throw new Exception("VIP must be closed by cashier");
  widget.UpdateTime(3600);
  if(logoutButton.Visibility!=Visibility.Collapsed)throw new Exception("Time update exposed cashier logout");
  long infoNow=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
  widget.UpdateSessionInfo(new SessionInfo("member",false,true,infoNow-600000,infoNow,7000,null));
  widget.UpdateTime(1200);
  if(logoutButton.Visibility!=Visibility.Visible)throw new Exception("Authenticated member logout missing after time update");
  widget.UpdateSessionInfo(new SessionInfo("cash",false,false,infoNow-600000,infoNow,14000,null));
  if(logoutButton.Visibility!=Visibility.Collapsed)throw new Exception("Cashier prepaid exposed logout");
  var priceText=(System.Windows.Controls.TextBlock)widget.FindName("TxtTariff");
  if(!priceText.Text.Contains("Seans narxi")||!priceText.Text.Contains("14"))throw new Exception("Prepaid amount missing");
  widget.UpdateTime(-1);
  widget.UpdateSessionInfo(new SessionInfo("vip",true,false,infoNow-7200000,infoNow,14000,null));
  tick.Invoke(widget,new object[]{null,EventArgs.Empty});
  if(logoutButton.Visibility!=Visibility.Collapsed||!((System.Windows.Controls.TextBlock)widget.FindName("TxtRemainingTime")).Text.StartsWith("02:00:"))throw new Exception("Postpaid elapsed display failed");
  if(!priceText.Text.Contains("O‘yin hisobi"))throw new Exception("Postpaid bill missing");
  if(!((System.Windows.Controls.TextBlock)widget.FindName("TxtSessionInterval")).Text.Contains("—"))throw new Exception("Session interval missing");
  widget.SetServerConnected(false);
  if(!((System.Windows.Controls.TextBlock)widget.FindName("TxtBillingStatus")).Text.Contains("aloqa uzilgan"))throw new Exception("Offline bill looks current");
  var widgetRoot=(FrameworkElement)widget.Content;widgetRoot.Measure(new Size(350,150));widgetRoot.Arrange(new Rect(0,0,350,150));widgetRoot.UpdateLayout();
  var widgetImage=new System.Windows.Media.Imaging.RenderTargetBitmap(350,150,96,96,System.Windows.Media.PixelFormats.Pbgra32);widgetImage.Render(widgetRoot);
  var widgetEncoder=new System.Windows.Media.Imaging.PngBitmapEncoder();widgetEncoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(widgetImage));
  using(var output=File.Create(".test-output/client-postpaid-widget.png"))widgetEncoder.Save(output);
  widget.UpdateSessionInfo(new SessionInfo("vip",true,false,infoNow-7200000,infoNow,null,"Tarifni tekshiring"));
  if(!priceText.Text.Contains("aniqlanmadi"))throw new Exception("Missing tariff displayed invented amount");
  widget.StopSession();
  // A LAN/server outage must neither erase purchased time nor add free time.
  var expiry=typeof(TimeWidgetWindow).GetField("_expiresAtTimestamp",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!;
  widget.UpdateTime(1800);var savedDeadline=expiry.GetValue(widget);
  widget.SetServerConnected(false);tick.Invoke(widget,new object[]{null,EventArgs.Empty});
  if(!Equals(savedDeadline,expiry.GetValue(widget)))throw new Exception("Disconnect changed the prepaid deadline");
  expiry.SetValue(widget,System.Diagnostics.Stopwatch.GetTimestamp()-System.Diagnostics.Stopwatch.Frequency);
  int beforeOfflineExpiry=expirations;tick.Invoke(widget,new object[]{null,EventArgs.Empty});tick.Invoke(widget,new object[]{null,EventArgs.Empty});
  if(expirations!=beforeOfflineExpiry+1)throw new Exception("Offline prepaid expiry must fire exactly once");
  widget.UpdateTime(-1);tick.Invoke(widget,new object[]{null,EventArgs.Empty});
  if(expirations!=beforeOfflineExpiry+1)throw new Exception("Offline VIP was closed without cashier approval");
  widget.SetServerConnected(true);widget.UpdateTime(900);
  if(expiry.GetValue(widget)==null)throw new Exception("Reconnected server time did not replace the local deadline");
  widget.StopSession();
  Console.WriteLine("PASS member-only logout, paid amount, Postpaid elapsed/bill, offline status and local expiry");
  app.Dispatcher.InvokeAsync(async ()=>{
   // Exercise real update failure paths in an isolated installation.
   var updaterType=typeof(NetCafeClient.Services.AutoUpdateService);
   var updateFixture=(NetCafeClient.Services.AutoUpdateService)Activator.CreateInstance(updaterType,true)!;
   string updateRoot=Path.GetFullPath(Path.Combine(".test-output","client-failed-updates-"+Guid.NewGuid().ToString("N")));
   Directory.CreateDirectory(updateRoot);
   updaterType.GetField("root",flags)!.SetValue(updateFixture,updateRoot);
   updaterType.GetField("staging",flags)!.SetValue(updateFixture,Path.Combine(updateRoot,"updates","staging"));
   File.WriteAllText(Path.Combine(updateRoot,"updates"),"blocked storage fixture");
   updateFixture.Initialize(args[1]+"/bad-hash",()=>true,()=>false);
   if(await updateFixture.CheckForUpdatesAsync())throw new Exception("Blocked storage accepted an update");
   if(updateFixture.IsChecking||updateFixture.IsDownloading)throw new Exception("Failed update wedged client state");
   File.Delete(Path.Combine(updateRoot,"updates"));
   foreach(string route in new[]{"bad-hash","bad-zip"})for(int attempt=0;attempt<3;attempt++){
    updateFixture.ManifestUrl=args[1]+"/"+route;
    if(await updateFixture.CheckForUpdatesAsync())throw new Exception("Invalid update was accepted");
    if(Directory.EnumerateFileSystemEntries(Path.Combine(updateRoot,"updates","staging")).Any())throw new Exception("Failed download accumulated staging files");
   }
   updateFixture.Stop();
   Console.WriteLine("PASS client starts with unavailable update storage; six failed downloads/extractions leave no staging files");
   var service=new WebSocketClientService();var done=new TaskCompletionSource();int adminMessages=0;
   service.OnAdminMessage+=(title,message)=>app.Dispatcher.Invoke(()=>{
    if(title!="Admin"||message!="Hello <b>literal</b>\nSecond line")throw new Exception("Message text changed");
    var owner=new Window {Left=-10000,Top=-10000,Width=200,Height=200,ShowActivated=false,ShowInTaskbar=false,WindowStartupLocation=WindowStartupLocation.Manual};
    owner.Show();
    var notice=new NetCafeClient.Views.AdminMessageWindow(title,message) {WindowStartupLocation=WindowStartupLocation.Manual,Left=-10000,Top=-10000};
    if(adminMessages==0)notice.Owner=owner;
    notice.Show();
    if(!notice.IsVisible||!notice.Topmost||notice.ShowInTaskbar)throw new Exception("Message overlay not visible/topmost");
    var panel=(System.Windows.Controls.StackPanel)notice.Content;
    var scroll=(System.Windows.Controls.ScrollViewer)panel.Children[1];
    if(((System.Windows.Controls.TextBlock)scroll.Content).Text!=message)throw new Exception("Message rendering changed literal text");
    notice.Owner=null;owner.Hide();
    if(!notice.IsVisible)throw new Exception("Message disappeared after unlocking");
    owner.Show();notice.Owner=owner;notice.Show();
    if(!notice.IsVisible)throw new Exception("Message disappeared after locking");
    notice.Close();owner.Close();adminMessages++;
   });
   int connections=0,starts=0;bool zeroBalance=false,time=false,stopped=false,locked=false,config=false,power=false,barNotice=false,memberReceipt=false,cashBlocked=false,billReceived=false;
   Task<bool>? logoutCheck=null;
   service.OnMemberSessionEnded+=receipt=>memberReceipt=receipt.Username=="member-test"&&receipt.Balance==46500;
   service.OnSessionBarNotice+=(id,message,amount)=>barNotice=id=="paid-session"&&message.Contains("Cola")&&amount==10000;
   service.OnConnectionStatusChanged+=online=>{if(online)connections++;};
   service.OnStartSession+=(id,seconds,tariff,name,balance)=>{starts++;if(id=="cash-session"){cashBlocked=!service.CanSelfClose&&!service.SendLogoutAsync().GetAwaiter().GetResult();return;}zeroBalance|=id=="paid-session"&&seconds==1800&&balance==0;logoutCheck=service.SendLogoutAsync();};
   service.OnSessionInfo+=info=>{if(info.SessionId=="stale-session")throw new Exception("Stale billing packet accepted");billReceived|=info.SessionId=="cash-session"&&info.GameAmount==14000;};
   service.OnUpdateTime+=seconds=>{if(seconds!=600)throw new Exception("Stale session time packet accepted");time=true;};
   service.OnStopSession+=reason=>stopped=reason=="test-end";
   service.OnLockScreen+=()=>locked=true;
   service.OnPcConfigReceived+=(zone,rate,formatted,qr)=>config=zone=="VIP"&&rate==12000;
   service.OnPowerCommand+=command=>power=command=="REBOOT"; // Observe only; never execute Windows power commands.
   service.OnEmergencyLockdown+=(reason,message)=>{if(reason=="audit-ban")done.TrySetResult();};
   try{
    service.Start();await done.Task.WaitAsync(TimeSpan.FromSeconds(25));
    if(logoutCheck==null||!await logoutCheck||!memberReceipt)throw new Exception("Logout acknowledgement or member receipt failed");
    if(connections<2||starts<2||!zeroBalance||!time||!stopped||!locked||!config||!power||!barNotice||!cashBlocked||!billReceived)throw new Exception($"Protocol mismatch: connections={connections},starts={starts},zero={zeroBalance},time={time},stop={stopped},lock={locked},config={config},power={power},bar={barNotice},cashBlocked={cashBlocked},bill={billReceived}");
    if(adminMessages<2)throw new Exception("Missing admin messages");
    Console.WriteLine("PASS screen message dispatch and native owned/unowned topmost windows");
    Console.WriteLine("PASS native client WebSocket handshake, fragmented messages, zero-balance session, time/config/lock/stop/power dispatch, disconnect and reconnect");
   }catch(Exception error){Console.Error.WriteLine(error.Message);Environment.ExitCode=1;}
   finally{service.Stop();app.Shutdown();}
  });
  app.Run();
 }
}
