export function announcementPayload(input={}) {
  const title=String(input.title||'').trim(),message=String(input.message||'').trim();
  if(!message||message.length>4000||title.length>160)throw Object.assign(Error('Xabar matni 1–4000, sarlavha esa 160 tagacha belgidan iborat bo‘lsin.'),{statusCode:400});
  return {title,message,priority:['INFO','WARNING','CRITICAL','HIGH'].includes(input.priority)?input.priority:'HIGH',requireDismiss:true};
}
