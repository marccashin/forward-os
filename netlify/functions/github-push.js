exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { statusCode: 500, body: 'GITHUB_TOKEN not set' };
  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Bad JSON' }; }
  const { content, message, filename = 'index.html' } = body;
  if (!content || !message) return { statusCode: 400, body: 'Missing fields' };
  const repo = 'marccashin/forward-os';
  const headers = { 'Authorization': 'token ' + token, 'Content-Type': 'application/json' };
  const meta = await fetch('https://api.github.com/repos/' + repo + '/contents/' + filename, { headers }).then(r => r.json());
  if (!meta.sha) return { statusCode: 500, body: JSON.stringify(meta) };
  const result = await fetch('https://api.github.com/repos/' + repo + '/contents/' + filename, {
    method: 'PUT', headers,
    body: JSON.stringify({ message, content, sha: meta.sha })
  }).then(r => r.json());
  return { statusCode: 200, body: JSON.stringify({ sha: result.commit ? result.commit.sha : null, error: result.message || null }) };
};