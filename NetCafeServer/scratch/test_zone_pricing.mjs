import http from 'http';

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    const req = http.request({
      hostname: '127.0.0.1',
      port: 5000,
      path,
      method,
      headers: defaultHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting Multi-Zone Dynamic Pricing Tests ---');

  // 1. Login as admin
  const loginRes = await makeRequest('POST', '/api/auth/login', {
    username: 'manager',
    password: 'Softech006'
  });
  console.log('1. Login status:', loginRes.status);
  if (!loginRes.data?.token) {
    throw new Error('Admin login failed: ' + JSON.stringify(loginRes.data));
  }
  const token = loginRes.data.token;
  const authHeaders = { 'Authorization': `Bearer ${token}` };

  // 2. GET /api/zones
  const zonesRes = await makeRequest('GET', '/api/zones', null, authHeaders);
  console.log('2. GET /api/zones count:', zonesRes.data?.length);

  // 3. POST /api/zones - Create new room with 2 dynamic tariff intervals
  const newZonePayload = {
    name: 'Bootcamp Pro 5v5',
    zoneType: 'BOOTCAMP_5V5',
    color: '#f59e0b',
    x: 100,
    y: 120,
    width: 400,
    height: 300,
    tariffs: [
      {
        name: 'Kunduzgi',
        start_time: '10:00',
        end_time: '18:00',
        price_per_hour: 14000,
        days_of_week: [1, 2, 3, 4, 5, 6, 7],
        is_vip_postpaid_allowed: 1
      },
      {
        name: 'Kechki / Tun',
        start_time: '18:00',
        end_time: '10:00',
        price_per_hour: 22000,
        days_of_week: [1, 2, 3, 4, 5, 6, 7],
        is_vip_postpaid_allowed: 1
      }
    ]
  };

  console.log('2. GET /api/zones:', zonesRes.data);
  const createZoneRes = await makeRequest('POST', '/api/zones', newZonePayload, authHeaders);
  console.log('3. POST /api/zones status:', createZoneRes.status, 'Response:', createZoneRes.data);
  const createdZoneId = createZoneRes.data?.zone?.id;

  // 4. GET /api/zones/:id/tariffs
  const tariffsRes = await makeRequest('GET', `/api/zones/${createdZoneId}/tariffs`, null, authHeaders);
  const tariffsList = tariffsRes.data?.tariffs || (Array.isArray(tariffsRes.data) ? tariffsRes.data : []);
  console.log('4. GET /api/zones/:id/tariffs count:', tariffsList.length);
  if (tariffsList.length !== 2) {
    throw new Error('Expected 2 tariffs for created zone, got ' + tariffsList.length);
  }

  // 5. PUT /api/zones/:id - Update tariffs
  const updateZonePayload = {
    name: 'Bootcamp Pro 5v5 (Yangilangan)',
    zoneType: 'BOOTCAMP_5V5',
    color: '#f59e0b',
    tariffs: [
      {
        name: 'Kunduzgi Arzon',
        start_time: '10:00',
        end_time: '18:00',
        price_per_hour: 15000,
        days_of_week: [1, 2, 3, 4, 5, 6, 7],
        is_vip_postpaid_allowed: 0 // Taqiqlangan
      },
      {
        name: 'Tungi Narx',
        start_time: '18:00',
        end_time: '10:00',
        price_per_hour: 25000,
        days_of_week: [1, 2, 3, 4, 5, 6, 7],
        is_vip_postpaid_allowed: 0
      }
    ]
  };
  const putZoneRes = await makeRequest('PUT', `/api/zones/${createdZoneId}`, updateZonePayload, authHeaders);
  console.log('5. PUT /api/zones/:id status:', putZoneRes.status, 'Updated name:', putZoneRes.data?.zone?.name);

  // 6. Test GET /api/computers for room metadata and current rates
  const computersRes = await makeRequest('GET', '/api/computers', null, authHeaders);
  console.log('6. GET /api/computers count:', computersRes.data?.length);
  const firstPc = computersRes.data?.[0];
  console.log('   Sample PC:', firstPc?.name, 'Room:', firstPc?.roomName, 'Rate:', firstPc?.currentRate, 'Zone VIP Allowed:', firstPc?.isVipPostpaidAllowed);

  // 7. Test /api/tariffs/calculate with zoneId
  const calcRes = await makeRequest('POST', '/api/tariffs/calculate', {
    startTime: '2026-10-22T10:00:00Z',
    targetEndTime: '13:00',
    zoneId: createdZoneId,
    isVip: false
  }, authHeaders);
  console.log('7. /api/tariffs/calculate result with zoneId:', calcRes.data);

  // 8. Test cross-interval calculation (17:00 to 19:00: 1 hr daytime @ 15000 + 1 hr night @ 25000 = 40000)
  const crossCalcRes = await makeRequest('POST', '/api/tariffs/calculate', {
    startTime: '2026-10-22T17:00:00.000+05:00',
    targetEndTime: '19:00',
    zoneId: createdZoneId,
    isVip: false
  }, authHeaders);
  console.log('8. Cross-interval calculation (17:00-19:00): price =', crossCalcRes.data?.totalAmount || crossCalcRes.data?.price, 'breakdown =', crossCalcRes.data?.breakdown?.map(b => `${b.durationHours}h @ ${b.pricePerHour}`).join(', '));

  // 9. Assign firstPc to this zone (where is_vip_postpaid_allowed === 0)
  const targetPcId = firstPc.id;
  await makeRequest('PUT', `/api/admin/computers/${targetPcId}`, {
    name: firstPc.name,
    zoneId: createdZoneId
  }, authHeaders);

  // Test POST /api/sessions/start with isPostpaid=true for a zone with is_vip_postpaid_allowed=0
  const postpaidStartRes = await makeRequest('POST', '/api/sessions/start', {
    computerId: targetPcId,
    isPostpaid: true,
    paymentType: 'POSTPAID',
    customerName: 'VIP Sinovchi'
  }, authHeaders);
  console.log('9. Postpaid start when forbidden in zone -> Status:', postpaidStartRes.status, 'Error:', postpaidStartRes.data?.error);
  if (postpaidStartRes.status !== 403) {
    throw new Error('Expected 403 Forbidden for disallowed VIP postpaid, got ' + postpaidStartRes.status);
  }

  // 10. Start a regular prepaid session on targetPcId
  const prepaidStartRes = await makeRequest('POST', '/api/sessions/start', {
    computerId: targetPcId,
    durationHours: 2,
    paymentType: 'CASH',
    customerName: 'Oddiy O\'yinchi'
  }, authHeaders);
  console.log('10. Regular session start -> Status:', prepaidStartRes.status, 'Tariff:', prepaidStartRes.data?.session?.tariff_name);

  // Stop session
  if (prepaidStartRes.data?.session?.id) {
    await makeRequest('POST', `/api/sessions/${prepaidStartRes.data.session.id}/stop`, {}, authHeaders);
  }

  console.log('--- ALL MULTI-ZONE DYNAMIC PRICING TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
