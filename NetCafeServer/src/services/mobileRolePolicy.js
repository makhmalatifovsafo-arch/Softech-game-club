// Managers handle reports and configuration; only cashiers operate the club.
// Desktop routes keep their existing role/permission checks.
export function mobileManagerSetting(path, method) {
  const pathname = new URL(path, 'http://localhost').pathname;
  if (method === 'GET') return ['/api/tariffs','/api/tariff-schedules','/api/admin/users','/api/settings'].includes(pathname);
  if (method === 'PUT') return ['/api/admin/tariffs','/api/admin/settings'].includes(pathname) || /^\/api\/admin\/users\/\d+\/permissions$/.test(pathname);
  if (method === 'POST') return ['/api/admin/users','/api/admin/tariff-schedules'].includes(pathname);
  return method === 'DELETE' && /^\/api\/admin\/(users|tariff-schedules)\/\d+$/.test(pathname);
}
export function mobileRoleAllows(role, path, method) {
  const pathname = new URL(path, 'http://localhost').pathname;
  if (pathname === '/api/auth/logout') return true;
  if (['club_owner', 'manager'].includes(role)) {
    return mobileManagerSetting(path, method) || method === 'GET' && ['/api/auth/me','/api/computers','/api/shifts/current','/api/reports/financial'].includes(pathname);
  }
  if (method !== 'GET' && mobileManagerSetting(path, method)) return false;
  return role === 'administrator' && !pathname.startsWith('/api/reports');
}
export function mobileStaffView(role, path, body) {
  if (role !== 'administrator') return body;
  const pathname = new URL(path, 'http://localhost').pathname;
  if (pathname === '/api/shifts/current') return { success: true, ...(body.syncPending?{syncPending:true}:{}), hasOpenShift: !!body.shift,
    shift: body.shift ? { id: body.shift.id, openedAt: body.shift.openedAt } : null };
  if (pathname === '/api/admin/users' && Array.isArray(body)) return body.filter(user => user.role === 'client');
  return body;
}
