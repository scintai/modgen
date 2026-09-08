# 🎨 ScintAI - AI Image Generation for Reddit

Turn your text prompts in post into stunning AI generated Art, right from a Reddit post. **ScintAI** is a Devvit app that brings the power of Google's Gemini and Imagen models directly to your subreddit.

---

## What ScintAI does

- **Generates AI images from text prompts** using Google's cutting-edge models (Gemini, Imagen 4, Imagen 4 Ultra, Imagen 4 Fast).
- **Content moderation** with OpenAI's moderation API to ensure NSFW and harmful prompts are blocked.
- **Rate limiting** to control how many images a user can generate per day.
- **Customizable post-generation messages** with optional links.
- **Supports multiple aspect ratios**: `1:1`, `9:16`, `16:9`, `4:3`, `3:4`.

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

- **NSFW content is not allowed.** Posts marked as NSFW or containing NSFW prompts will be automatically removed.
- **Image and Video posts are not supported.** ScintAI only works with text posts.
- **Daily rate limits apply.** Each user has a limited number of generations per day, as configured by the moderators.

---

## App Settings (for Moderators)

Moderators can configure ScintAI through the Dev Platform settings.

| Setting                      | Description                                                                          |
| :--------------------------- | :----------------------------------------------------------------------------------- |
| **OpenAI API Key**           | Required. Used for content moderation via `api.openai.com`.                          |
| **Gemini API Key**           | Required. Used for image generation via `generativelanguage.googleapis.com`.         |
| **Image Model**              | Select the AI model: `Nano Banana Pro`, `Imagen 4`, `Imagen 4 Ultra`, `Imagen 4 Fast`. |
| **Rate Limit Per User**      | The maximum number of image generations allowed per user, per day.                   |
| **After Generation Message** | A custom message displayed below the generated image.                                |
| **Link After Generation**    | A URL to link the above message to.                                                  |

---

## APIs Used

ScintAI uses the following external APIs:

| API                               | Domain                                 | Purpose                           |
| :-------------------------------- | :------------------------------------- | :-------------------------------- |
| **Google Generative Language API**| `generativelanguage.googleapis.com`    | AI Image Generation (Gemini/Imagen) |
| **OpenAI API**                    | `api.openai.com`                       | Content Moderation                |

---

## How it works (Technical Overview)

1.  **Post Trigger**: When a post is created with the `scintai@generate` flair, the app triggers.
2.  **Validation**: The app checks if the post is NSFW, an image, or a video. If so, it removes the post with a reason.
3.  **Prompt Extraction**: The `prompt@start ... prompt@end` block is extracted from the post body.
4.  **Moderation**: The prompt is sent to OpenAI's moderation API. If flagged, the post is removed.
5.  **Rate Limiting**: The app checks the user's daily usage against the configured limit using Redis.
6.  **Image Generation**: A background job is scheduled. It calls the selected Google model (Gemini or Imagen) to generate the image.
7.  **Posting**: The generated image is uploaded to Reddit and posted as a distinguished comment on the original post. The user is notified via private message.

---

## Support

If you encounter any issues, please reach out to the subreddit moderators or the app developer[u/BootPsychological454](https://www.reddit.com/user/BootPsychological454/).

---

## License

This project is developed in compliance with [Reddit's Developer Terms](https://www.redditinc.com/policies/developer-terms) and adheres to the guidelines for the Devvit platform.
