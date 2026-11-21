export async function testRequest(url, method = 'GET', body) {
  const options = { method }
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' }
    options.body = JSON.stringify(body)
  }
  const response = await fetch(url, options)
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error(data?.error || 'Test işlemi tamamlanamadı.')
  return data
}

export function testFileUrl(action, file) {
  const query = file.archiveYear ? `?year=${file.archiveYear}` : ''
  return `/api/test/${action}/${encodeURIComponent(file.fileName ?? file.testName)}${query}`
}

export function formatTestDuration(ms, withMilliseconds = false) {
  const parts = [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60]
  const time = parts.map(part => String(part).padStart(2, '0')).join(':')
  return withMilliseconds ? `${time}.${String(ms % 1000).padStart(3, '0')}` : time
}
