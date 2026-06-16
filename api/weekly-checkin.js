// CultureFit: Weekly check-in sender
// Runs automatically every Sunday (see the cron schedule in vercel.json). It creates
// a Resend "broadcast" to the Weekly Check-In audience and sends it. Anyone Stripe
// added (Coached + Elite) gets it; anyone who cancelled was already removed.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;
const FORM_URL = process.env.TALLY_FORM_URL || 'https://tally.so/r/rjqMb2';
const FROM = process.env.EMAIL_FROM || 'CultureFit Coaching <coach@culturefittx.com>';
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'culturefittx@gmail.com';

function buildHtml() {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#F4EEE4;font-family:Helvetica,Arial,sans-serif;color:#2B2B2B;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4EEE4;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="background:#E8573F;padding:28px 32px;">
                <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#FFE7E1;font-weight:bold;">CultureFit Coaching</div>
                <div style="font-size:30px;line-height:1.1;color:#FFFFFF;font-weight:bold;margin-top:6px;text-transform:uppercase;">Your Weekly Check-In</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Hey, it's check-in time.</p>
                <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Take 5 minutes to log how your week went. This is how I keep your program dialed in and adjust what's coming next. The more honest detail you give me, the better I can coach you.</p>
                <p style="font-size:16px;line-height:1.6;margin:0 0 28px;">I read every single one and reply within 48 hours.</p>
                <table role="presentation" cellpadding="0" cellspacing="0" align="center">
                  <tr>
                    <td style="border-radius:9px;background:#E8573F;">
                      <a href="${FORM_URL}" style="display:inline-block;padding:16px 40px;font-size:17px;font-weight:bold;color:#FFFFFF;text-decoration:none;text-transform:uppercase;letter-spacing:1px;">Start My Check-In</a>
                    </td>
                  </tr>
                </table>
                <p style="font-size:14px;line-height:1.6;color:#6B6B6B;margin:28px 0 0;text-align:center;">Got a question instead of a check-in? Just reply to this email.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background:#F4EEE4;text-align:center;">
                <div style="font-size:12px;color:#9A9A9A;line-height:1.5;">CultureFit &middot; Dallas, TX<br>
                <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#9A9A9A;">Unsubscribe</a></div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export default async function handler(req, res) {
  // Only Vercel Cron (or you) should trigger this. If CRON_SECRET is set in Vercel,
  // Vercel sends it automatically and we require it here.
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dateLabel = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Chicago',
  });

  try {
    // 1. Create the broadcast.
    const createRes = await fetch('https://api.resend.com/broadcasts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audience_id: AUDIENCE_ID,
        from: FROM,
        reply_to: REPLY_TO,
        subject: `Your CultureFit check-in (week of ${dateLabel})`,
        name: `Weekly check-in - ${dateLabel}`,
        html: buildHtml(),
      }),
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      console.error('Broadcast create failed', createRes.status, text);
      return res.status(500).json({ error: 'create failed', detail: text });
    }

    const { id } = await createRes.json();

    // 2. Send it now.
    const sendRes = await fetch(`https://api.resend.com/broadcasts/${id}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    });

    if (!sendRes.ok) {
      const text = await sendRes.text();
      console.error('Broadcast send failed', sendRes.status, text);
      return res.status(500).json({ error: 'send failed', detail: text });
    }

    return res.status(200).json({ sent: true, broadcastId: id, date: dateLabel });
  } catch (err) {
    console.error('Weekly check-in error', err);
    return res.status(500).json({ error: 'Weekly check-in failed' });
  }
}
