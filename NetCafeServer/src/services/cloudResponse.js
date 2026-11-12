// Cloud proxies can return HTML/text errors instead of the API's JSON response.
export async function readCloudResponse(response) {
  let data;
  try { data = await response.json(); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(`Bulut serveri yaroqsiz javob qaytardi (HTTP ${response.status}). Markaziy server manzili va holatini tekshiring.`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Bulut javobi yaroqsiz (HTTP ${response.status}).`);
  }
  return data;
}
