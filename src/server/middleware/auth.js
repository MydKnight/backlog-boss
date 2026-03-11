import { getDefaultUser, getUserByEmail, createUserByEmail } from '../db/queries.js';

/**
 * Auth middleware — resolves req.user from the Cloudflare Access email header.
 *
 * Production: reads Cf-Access-Authenticated-User-Email, looks up or creates the user.
 * Dev (NODE_ENV !== 'production'): falls back to getDefaultUser() — no CF header needed.
 */
export async function authMiddleware(req, res, next) {
  if (process.env.NODE_ENV !== 'production') {
    // Dev fallback — behaves exactly like before Phase 8
    const user = getDefaultUser();
    if (!user) return res.status(500).json({ error: 'No user configured.' });
    req.user = user;
    return next();
  }

  const email = req.headers['cf-access-authenticated-user-email'];
  if (!email) {
    return res.status(401).json({ error: 'Unauthorized — no identity header.' });
  }

  try {
    let user = getUserByEmail(email);
    if (!user) {
      user = createUserByEmail(email);
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('[auth] Failed to resolve user:', err.message);
    res.status(500).json({ error: 'Auth error.' });
  }
}
