// CultureFit: Stripe -> Resend sync
// When someone subscribes to the Coached or Elite tier, add them to the Resend
// "Weekly Check-In" audience. When they cancel or downgrade off a coaching tier,
// remove them. This is what keeps the Sunday check-in list accurate by itself.

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const COACHING_PRICE_IDS = [
  process.env.COACHED_PRICE_ID,
  process.env.ELITE_PRICE_ID,
].filter(Boolean);

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;

async function addContact(email, name) {
  const [first_name, ...rest] = (name || '').trim().split(' ');
  const res = await fetch(`https://api.resend.com/audiences/${AUDIENCE_ID}/contacts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      first_name: first_name || undefined,
      last_name: rest.join(' ') || undefined,
      unsubscribed: false,
    }),
  });
  // Resend returns 200 even if the contact already exists, so this is safe to repeat.
  if (!res.ok && res.status !== 409) {
    console.error('Resend add failed', res.status, await res.text());
  }
}

async function removeContact(email) {
  const res = await fetch(
    `https://api.resend.com/audiences/${AUDIENCE_ID}/contacts/${encodeURIComponent(email)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${RESEND_API_KEY}` } }
  );
  if (!res.ok && res.status !== 404) {
    console.error('Resend remove failed', res.status, await res.text());
  }
}

function isCoachingSubscription(subscription) {
  return subscription.items.data.some((item) =>
    COACHING_PRICE_IDS.includes(item.price && item.price.id)
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Authenticity check: re-fetch the event straight from Stripe using our secret
    // key. A forged request can't supply a real event id from this account, so if
    // this lookup succeeds we know the event is genuine. (Avoids the raw-body
    // signing headache while staying secure.)
    const event = await stripe.events.retrieve(body.id);
    const subscription = event.data.object;

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const customer = await stripe.customers.retrieve(subscription.customer);
        if (!customer || customer.deleted || !customer.email) break;
        if (isCoachingSubscription(subscription) && subscription.status !== 'canceled') {
          await addContact(customer.email, customer.name);
        } else {
          // Not (or no longer) a coaching tier, e.g. downgraded to Self-Guided.
          await removeContact(customer.email);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const customer = await stripe.customers.retrieve(subscription.customer);
        if (customer && !customer.deleted && customer.email) {
          await removeContact(customer.email);
        }
        break;
      }
      default:
        // Ignore everything else.
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook error', err);
    // 400 tells Stripe to retry later.
    return res.status(400).json({ error: 'Webhook handler failed' });
  }
}
