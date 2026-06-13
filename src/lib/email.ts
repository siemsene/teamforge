// Best-effort admin notification when a new instructor registers.
//
// TeamForge runs on Firebase's free Spark plan, which has no Cloud Functions /
// server. Rather than ship a real email-API key in the client bundle, we POST
// to Web3Forms (https://web3forms.com), which emails the address registered
// with the access key.
//
// The access key is a *write-only* token: it can only deliver a message to the
// key owner's email — it can't read data or send mail to arbitrary recipients.
// Shipping it client-side is safe; if it's ever abused (spam to your inbox),
// rotate the key in the Web3Forms dashboard. So no `to`/sender is configured
// here — the recipient is fixed to whoever owns the key.

const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";

const accessKey = import.meta.env.VITE_WEB3FORMS_ACCESS_KEY as string | undefined;

export function adminNotificationsConfigured(): boolean {
  return Boolean(accessKey);
}

/**
 * Notifies the admin that an instructor is awaiting approval. Resolves quietly
 * (never throws) so it can be fired without blocking registration; callers
 * should not await it on the critical path.
 */
export async function notifyAdminOfRegistration(name: string, email: string, university: string): Promise<void> {
  if (!adminNotificationsConfigured()) return;

  try {
    const res = await fetch(WEB3FORMS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        access_key: accessKey,
        subject: "TeamForge: new instructor awaiting approval",
        from_name: "TeamForge",
        // Web3Forms treats `email` as the submitter address (sets reply-to),
        // so replying to the notification reaches the instructor directly.
        email,
        name,
        message:
          "A new instructor has registered on TeamForge and is awaiting approval:\n\n" +
          `Name:       ${name}\n` +
          `University: ${university}\n` +
          `Email:      ${email}\n\n` +
          "Approve or revoke them in the admin panel.",
      }),
    });
    if (!res.ok) {
      console.warn("Admin notification failed:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    // Network/CORS failures must not break registration.
    console.warn("Admin notification error:", err);
  }
}
