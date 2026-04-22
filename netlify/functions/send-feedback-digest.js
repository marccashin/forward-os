// netlify/functions/send-feedback-digest.js
// Scheduled daily at 6pm ET (22:00 UTC) — configured in netlify.toml

exports.handler = async function(event, context) {
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ewedrgopezogifzysusn.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.RESEND_FROM || 'FORWARD OS <digest@forward-os.netlify.app>';
  const DIGEST_TO = 'marc.cashin@corcoranmce.com';

  if (!SUPABASE_KEY) {
    console.error('Missing SUPABASE_SERVICE_KEY env var');
    return { statusCode: 500, body: 'Missing SUPABASE_SERVICE_KEY' };
  }
  if (!RESEND_API_KEY) {
    console.error('Missing RESEND_API_KEY env var');
    return { statusCode: 500, body: 'Missing RESEND_API_KEY' };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let feedback = [];
  try {
    const supaRes = await fetch(
      SUPABASE_URL + '/rest/v1/agent_feedback?created_at=gte.' + encodeURIComponent(since) + '&order=created_at.desc',
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    const data = await supaRes.json();
    feedback = Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Supabase query failed:', err);
    return { statusCode: 500, body: 'Supabase query failed: ' + err.message };
  }

  const count = feedback.length;
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/New_York'
  });

  let html;

  if (count === 0) {
    html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:640px;margin:0 auto;padding:32px 24px;background:#f9fafb;"><div style="background:linear-gradient(135deg,#1a2e4a,#2d4a6b);border-radius:12px;padding:24px 28px;margin-bottom:24px;"><h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">FORWARD OS</h1><p style="color:#c9a84c;margin:6px 0 0;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Daily Feedback Digest</p></div><div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #e5e7eb;"><p style="color:#374151;font-size:15px;margin:0;">No feedback was submitted in the last 24 hours.</p></div><p style="color:#9ca3af;font-size:11px;margin-top:20px;text-align:center;">' + today + ' · FORWARD OS Automated Digest</p></div>';
  } else {
    const typeStyles = { bug:{bg:'#fef2f2',color:'#dc2626'}, idea:{bg:'#eff6ff',color:'#2563eb'}, praise:{bg:'#f0fdf4',color:'#16a34a'}, general:{bg:'#f3f4f6',color:'#6b7280'} };
    const rows = feedback.map(function(f) {
      const time = new Date(f.created_at).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true, timeZone:'America/New_York' });
      const typeKey = (f.type || 'general').toLowerCase();
      const ts = typeStyles[typeKey] || typeStyles.general;
      const badge = '<span style="background:' + ts.bg + ';color:' + ts.color + ';padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;">' + (f.type || 'general') + '</span>';
      return '<tr><td style="padding:11px 14px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#1a2e4a;font-size:13px;white-space:nowrap;">' + (f.agent_name||'—') + '</td><td style="padding:11px 14px;border-bottom:1px solid #f3f4f6;">' + badge + '</td><td style="padding:11px 14px;border-bottom:1px solid #f3f4f6;color:#374151;font-size:14px;">' + (f.message||'—') + '</td><td style="padding:11px 14px;border-bottom:1px solid #f3f4f6;color:#9ca3af;font-size:12px;white-space:nowrap;">' + time + '</td></tr>';
    }).join('');
    html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:640px;margin:0 auto;padding:32px 24px;background:#f9fafb;"><div style="background:linear-gradient(135deg,#1a2e4a,#2d4a6b);border-radius:12px;padding:24px 28px;margin-bottom:24px;"><h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">FORWARD OS</h1><p style="color:#c9a84c;margin:6px 0 0;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Daily Feedback Digest · ' + today + '</p></div><p style="color:#374151;font-size:15px;margin:0 0 20px;"><strong style="color:#1a2e4a;">' + count + ' feedback item' + (count!==1?'s':'') + '</strong> submitted in the last 24 hours.</p><table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;"><thead><tr style="background:#f8f9fa;"><th style="padding:10px 14px;text-align:left;color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Agent</th><th style="padding:10px 14px;text-align:left;color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Type</th><th style="padding:10px 14px;text-align:left;color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Message</th><th style="padding:10px 14px;text-align:left;color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Time (ET)</th></tr></thead><tbody>' + rows + '</tbody></table><p style="color:#9ca3af;font-size:11px;margin-top:20px;text-align:center;">FORWARD OS Automated Digest · Sent daily at 6pm ET</p></div>';
  }

  let emailResult;
  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [DIGEST_TO],
        subject: count === 0 ? 'FORWARD OS Digest — No feedback today' : 'FORWARD OS Digest — ' + count + ' item' + (count!==1?'s':'') + ' today',
        html: html
      })
    });
    emailResult = await emailRes.json();
  } catch (err) {
    console.error('Resend API failed:', err);
    return { statusCode: 500, body: 'Email send failed: ' + err.message };
  }

  console.log('Digest complete:', { count: count, emailResult: emailResult });
  return { statusCode: 200, body: JSON.stringify({ success: true, count: count, emailResult: emailResult }) };
};