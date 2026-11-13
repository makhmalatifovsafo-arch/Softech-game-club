import {verifyTelemetryLicense} from './telemetryAuth.js';

const fail=(message,statusCode=400)=>Object.assign(Error(message),{statusCode});
const states=['STARTING','RUNNING','EMERGENCY','UNREACHABLE','FAILED'];
const codes=['NONE','CONFIG_INVALID','DATABASE_INVALID','DATABASE_MISSING','PORT_BUSY','DISK_FULL','ACCESS_DENIED','RUNTIME_MISSING','SCRIPT_MISSING','START_TIMEOUT','PROCESS_EXIT','UNKNOWN','SERVER_ALREADY_RUNNING','SERVER_INSTANCE_LOCK_FAILED','UPDATE_RECOVERY_REQUIRED'];
const configs=['OK','MISSING','INVALID','UNREADABLE'];
const backupCodes=['NONE','DISK_FULL','ACCESS_DENIED','DATABASE_INVALID','BACKUP_FAILED','UNKNOWN'];
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;

// Construct a new object, never store/return raw logs or caller-supplied keys.
export function sanitizeDiagnostic(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Diagnostika formati noto‘g‘ri.');
  const observedAt=timestamp(input.observedAt);
  if(!observedAt||Date.now()-Date.parse(observedAt)>86400000||Date.parse(observedAt)-Date.now()>120000)throw fail('Diagnostika vaqti eskirgan yoki noto‘g‘ri.');
  if(!states.includes(input.backendState)||!codes.includes(input.errorCode)||!configs.includes(input.configState))throw fail('Diagnostika holati noto‘g‘ri.');
  const version=value=>typeof value==='string'&&/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value)?value:null;
  const free=input.freeDiskBytes;
  return {schemaVersion:1,observedAt,backendState:input.backendState,errorCode:input.errorCode,
    configState:input.configState,serverVersion:version(input.serverVersion),launcherVersion:version(input.launcherVersion),
    lastBackupAt:timestamp(input.lastBackupAt),backupError:backupCodes.includes(input.backupError)?input.backupError:'UNKNOWN',
    freeDiskBytes:Number.isSafeInteger(free)&&free>=0?free:null,databasePresent:typeof input.databasePresent==='boolean'?input.databasePresent:null};
}

export class ServerDiagnostics {
  constructor(storage){Object.assign(this,storage);}
  init(){this.db?.exec(`CREATE TABLE IF NOT EXISTS club_server_diagnostics(club_id INTEGER PRIMARY KEY REFERENCES clubs(id) ON DELETE CASCADE,payload TEXT NOT NULL,observed_at TEXT NOT NULL,received_at TEXT NOT NULL)`);}
  async query(result){const {data,error}=await result;if(error)throw fail('Diagnostika bazasi tayyor emas. 20261113_server_diagnostics.sql migratsiyasini tekshiring.',503);return data;}
  async ingest(body){
    const proof=verifyTelemetryLicense(body?.signedLicense);
    if(!proof||Number(body.clubId)!==Number(proof.clubId))throw fail('Klub tasdig‘i yaroqsiz.',401);
    const id=Number(proof.clubId);
    const club=this.db?this.db.prepare('SELECT id FROM clubs WHERE id=? AND hardware_fingerprint=?').get(id,proof.hardwareFingerprint)
      :await this.query(this.client.from('clubs').select('id').eq('id',id).eq('hardware_fingerprint',proof.hardwareFingerprint).maybeSingle());
    if(!club)throw fail('Klub tasdig‘i mos emas.',401);
    const report=sanitizeDiagnostic(body.report),now=new Date().toISOString();
    // Diagnostics must never renew a license or make the backend appear online.
    this.init();
    if(this.db)this.db.prepare(`INSERT INTO club_server_diagnostics VALUES(?,?,?,?) ON CONFLICT(club_id) DO UPDATE SET payload=excluded.payload,observed_at=excluded.observed_at,received_at=excluded.received_at WHERE excluded.observed_at>club_server_diagnostics.observed_at`).run(id,JSON.stringify(report),report.observedAt,now);
    else await this.query(this.client.rpc('softech_server_diagnostic_upsert',{p_club_id:id,p_payload:report,p_observed_at:report.observedAt}));
    return {success:true};
  }
  async get(id){
    this.init();
    const row=this.db?this.db.prepare('SELECT * FROM club_server_diagnostics WHERE club_id=?').get(id)
      :await this.query(this.client.from('club_server_diagnostics').select('payload,received_at').eq('club_id',id).maybeSingle());
    if(!row)return null;
    return {report:typeof row.payload==='string'?JSON.parse(row.payload):row.payload,receivedAt:row.received_at};
  }
}

export async function handleServerDiagnostics(req,res,storage,authorizeAdmin){
  const pathname=new URL(req.url,'http://localhost').pathname;
  const match=pathname.match(/^\/api\/clubs\/(\d+)\/diagnostics$/);
  const ingest=pathname==='/api/telemetry/diagnostics'&&req.method==='POST';
  if(!ingest&&!(match&&req.method==='GET'))return false;
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  try{
    if(match&&!await authorizeAdmin(req,res))return true;
    if(!storage.db&&!storage.client)throw fail('Bulut bazasi sozlanmagan.',503);
    const service=new ServerDiagnostics(storage);
    let result;
    if(ingest){
      let raw=req.body;
      if(raw===undefined){raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)throw fail('So‘rov juda katta.',413);}}
      if(Buffer.byteLength(typeof raw==='string'?raw:JSON.stringify(raw))>16384)throw fail('So‘rov juda katta.',413);
      let body;try{body=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw fail('JSON noto‘g‘ri.');}
      result=await service.ingest(body);
    }else result={success:true,diagnostic:await service.get(Number(match[1]))};
    res.statusCode=200;res.end(JSON.stringify(result));
  }catch(error){res.statusCode=error.statusCode||503;res.end(JSON.stringify({success:false,error:error.statusCode?error.message:'Diagnostikani saqlash yoki o‘qishda xatolik.'}));}
  return true;
}
