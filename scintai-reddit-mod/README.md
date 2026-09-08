# 🎨 ScintAI — AI Image and GIF Generation for Subreddits, at Scale and Dirt Cheap, So You Can Serve Your Subreddit Without Breaking the Bank

> Open source — the whole project (bot, backend, docs): https://github.com/scintai/modgen

Big corporations keep taking away our freedom to be creative, piling on restrictions, when Reddit is supposed to be the one place where artistic freedom should never get suppressed. As someone who's hardcore about what Reddit stands for, I felt it was on me to build something that lets Reddit users generate AI images and GIFs with full artistic expression, no limits attached.

Turn your text prompts into stunning AI generated art, right from a Reddit post. ScintAI is a Devvit app that brings custom GPU image (and soon GIF) generation directly into your subreddit

## Built for r/scintai — our own community, our own GPU.

## What ScintAI does

- **Generates AI images from text prompts** via the modgen queue (HonoJs deployed on Cloudflare Worker → Modal GPU).
- **Minor-safety moderation**: Prompts referencing minors are blocked; NSFW content is allowed.
- **Rate limiting** to control how many images a user can generate per day.
- **Customizable post-generation messages** with optional links.
- **Supports multiple aspect ratios**: `1:1`, `9:16`, `16:9`, `4:3`, `3:4`.

---

## Why does this app ask for `modgen.scintai.com` permission?

Short version: that domain is our own image backend — without it, the app cannot generate anything.

Big image APIs (Google, OpenAI) charge per generation. Serving a whole subreddit thousands of images (and soon GIFs) a month on per-call billing would bankrupt the project. So generations run on our own custom model on our own GPU, fronted by a tiny HonoJS deployed Cloudflare Worker queue at `modgen.scintai.com`. No per-call meter, no limits attached — the same queue will serve GIF/gif next.

**Your data stays yours.** Per generation the app sends exactly three things and nothing else:

- a **single prompt** (the text from your post),
- a **random uid** (your post id — an opaque id used only to match the finished image back to your post),
- the **aspect ratio** (`9:16` etc.).

No usernames, no post history, no analytics, no tracking — we never see or store who you are. Finished images live ~24h for delivery, then auto-delete; the GPU-side entry is wiped the moment your image is delivered.

**Training.** Your prompts are never used to train, fine-tune, or improve any model — they are rendered once and forgotten.

**Safeguards.** Minor-related prompts are blocked automatically; every published image carries an nsfw-content warning label; per-user daily rate limits apply; deleting your post or comment purges its backend record and history entries.

## Fetch Domains

The following domains are requested for this app:

- `api.openai.com` - Used only for minor-safety moderation (single `sexual/minors` check)
- `modgen.scintai.com` - First-party generation backend described above; the bot enqueues `{prompt, aspectRatio, uid}` and polls for the finished image (Devvit HTTP calls time out after 30s, so generation is async via scheduler jobs)

---

## How to use it

### Creating an AI Image

1.  **Create a new post** in the subreddit where ScintAI is installed.
2.  **Apply the flair** `scintai@generate` to your post.
3.  **Write your prompt** in the post body using the required syntax:

    ```
    prompt@start
    Your detailed image description goes here. Be creative!
    prompt@end
    ```

4.  **(Optional)** Add an aspect ratio tag anywhere in the post body:

    ```
    ar@16:9
    ```

    If no aspect ratio is specified, the default is `9:16`.

5.  **Submit your post**. ScintAI will process your request and reply with the generated image as a comment.

---

### Example Post Body

```
prompt@start
A majestic lion wearing a crown, sitting on a golden throne in a dimly lit castle, cinematic lighting, highly detailed, 8k resolution.
prompt@end

ar@16:9
```

---

## Restrictions

- **Image and GIF posts are not supported.** ScintAI only works with text posts.
- **Daily rate limits apply.** Each user has a limited number of generations per day, as configured by the moderators.

---

## App Settings (for Moderators)

Moderators can configure ScintAI through the Dev Platform settings.

| Setting                      | Description                                                                                                                            |
| :--------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenAI API Key**           | Required. Used for content moderation via `api.openai.com`.                                                                            |
| **Modgen API Key**           | Required. Must match the API key secret set on the modgen worker. The backend URL (`https://modgen.scintai.com`) is hardcoded in code. |
| **Rate Limit Per User**      | The maximum number of image generations allowed per user, per day.                                                                     |
| **After Generation Message** | A custom message displayed below the generated image.                                                                                  |
| **Link After Generation**    | A URL to link the above message to.                                                                                                    |

---

## APIs Used

ScintAI uses the following external APIs:

| API            | Domain               | Purpose                                                      |
| :------------- | :------------------- | :----------------------------------------------------------- |
| **Modgen API** | `modgen.scintai.com` | Async image generation queue (Cloudflare Worker → Modal GPU) |
| **OpenAI API** | `api.openai.com`     | Content Moderation                                           |

## How it works (Technical Overview)

1.  **Post Trigger**: When a post is created with the `scintai@generate` flair, the app triggers.
2.  **Validation**: The app checks for a valid flair, a prompt block, and that the post is a text post (not image/GIF). Failures remove the post with a reason. NSFW-tagged posts are allowed through.
3.  **Prompt Extraction**: The `prompt@start ... prompt@end` block is extracted from the post body.
4.  **Moderation**: The prompt gets a minor-safety check. Only minor-related content removes the post; adult content passes.
5.  **Rate Limiting**: The app checks the user's daily usage against the configured limit using Redis.
6.  **Image Generation**: An enqueue job sends `{prompt, aspectRatio, uid=postId}` to the modgen API and returns instantly. A poll job then checks the job status every minute until the GPU worker finishes.
7.  **Posting**: The generated image is uploaded to Reddit and posted as a distinguished, stickied comment on the original post.

---

## Support

Found a bug, abusive output, or a rule violation by the app? Report it via modmail on r/scintai. For anything else, reach out to the subreddit moderators or the app developer[u/BootPsychological454](https://www.reddit.com/user/BootPsychological454/).

---

## License

This project is developed in compliance with [Reddit's Developer Terms](https://www.redditinc.com/policies/developer-terms) and adheres to the guidelines for the Devvit platform.
