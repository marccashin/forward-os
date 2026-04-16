exports.handler = async (event) => {
  try {
    const res = await fetch('https://web-production-d9b04.up.railway.app/send-feedback-digest', { method: 'POST' });
    const data = await res.json();
    console.log('Feedback digest sent:', JSON.stringify(data));
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    console.error('Digest error:', e.message);
    return { statusCode: 500, body: e.message };
  }
};
