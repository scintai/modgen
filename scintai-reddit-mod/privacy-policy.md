# Privacy Policy

**Effective Date:** January 10, 2026  
**Last Updated:** September 8, 2026

This Privacy Policy explains how ScintAI ("the App") handles your information.

---

## 1. Information We Keep

We store no account or personal data — no usernames, no profiles, no post contents beyond the prompt you asked us to render, no analytics, no tracking. The only things kept anywhere are transient delivery artifacts:

-   **Daily usage counts**: a number per user ID per date, used only for rate limiting. This lives entirely in Reddit's own app storage (Devvit Redis) — it is never sent to our backend or anywhere else. Auto-expires.
-   **In-flight job records** on our backend: your prompt, aspect ratio, and (once finished) the generated image, keyed by a random job id. That id is not user data — it carries no identity and cannot be traced to any user; it only matches the finished image back to the post. This cache has to exist — the GPU needs minutes while the bot collects the result by polling seconds later. Auto-deleted ~24 hours after generation, wiped the moment your image is delivered, and purged if you delete your post or comment.
-   **Configuration data**: Moderator-configured settings such as API keys, rate limits, and custom messages.

**No private messages, post contents, or personal account data are collected or stored** by ScintAI beyond what is publicly available on Reddit. The App sends no private messages.

---

## 2. How We Use the Information

The stored information is used solely to:

-   Enforce daily rate limits on image generation.
-   Allow the app to reply with the generated image on your post.

---

## 3. External Services

ScintAI uses the following services to function:

**First-party backend (Modgen)** at `modgen.scintai.com`:

| Data sent                        | Purpose                                                                 |
| :------------------------------- | :---------------------------------------------------------------------- |
| **Prompt text**                  | Sent to our own GPU to generate your image.                             |
| **Random job id**                | Matches the finished image back to your post. Nothing else.             |
| **Aspect ratio**                 | Sizes the generated image.                                              |

No usernames, post history, analytics, or tracking data are sent. Finished images are cached ~24 hours for delivery, then auto-deleted; the GPU-side entry is cleared the moment your image is delivered.

**No training.** Prompts are never used to train, fine-tune, or improve any machine-learning model.

**Third-party (OpenAI Moderation API)**: your prompt text is sent to OpenAI's servers for a minor-safety check only. Please refer to the [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy) for more information.

---

## 4. Data Retention

-   **Usage counts**: Stored daily in Reddit own Devvit Redis and auto-expire.
-   **On post/comment deletion**: deleting your post or comment purges its backend job record immediately
-   **Configuration data**: Persists only while the App remains installed on the subreddit.

Uninstalling the App will delete all stored configuration and user data from Reddit's storage.

---

## 5. Security

While reasonable efforts are made to protect your data using Reddit's secure storage APIs, no system can guarantee absolute security. Use of this App is at your own risk.

---

## 6. Children's Privacy

ScintAI is not directed at children under 13. We do not knowingly collect personal information from children.

---

## 7. Changes to This Policy

This Privacy Policy may be updated from time to time. Changes will be effective immediately upon posting.

---

## 8. Contact

If you have any questions about this Privacy Policy, please contact the app developer [u/BootPsychological454](https://www.reddit.com/user/BootPsychological454/). via Modmail on the subreddit where ScintAI is installed.
