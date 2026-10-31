// Generate private setup SQL locally; never print passwords or write to the live cloud.
import fs from 'node:fs';import crypto from 'node:crypto';
const password=process.env.SUPERADMIN_INITIAL_PASSWORD,pin=process.env.SUPERADMIN_INITIAL_PIN;
if(!password||password.length<12||!/^\d{4}$/.test(pin??''))throw Error('Set SUPERADMIN_INITIAL_PASSWORD (12+ characters) and SUPERADMIN_INITIAL_PIN (4 digits).');
const quote=s=>"'"+String(s).replaceAll("'","''")+"'",salt=crypto.randomBytes(16).toString('hex');
const hash=salt+':'+crypto.pbkdf2Sync(password,salt,100000,64,'sha512').toString('hex');
fs.mkdirSync('.test-output',{recursive:true});
fs.writeFileSync('.test-output/private-cloud-admin.sql',`INSERT INTO public.super_admins(username,password_hash,pin_code) VALUES ('admin',${quote(hash)},${quote(pin)}) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash,pin_code=excluded.pin_code,updated_at=now();\n`,{mode:0o600});
console.log('Private SQL ready: .test-output/private-cloud-admin.sql. Run only in your Softech Supabase SQL editor. Do not commit/share it.');
