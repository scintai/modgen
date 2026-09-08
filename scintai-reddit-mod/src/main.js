import { Devvit, RichTextBuilder } from "@devvit/public-api";
import { checkModeration, extractAspectRatio, extractPrompt, enqueueOffload, getOffloadStatus, removePostWithReason } from "./utils.js";
import { TRIGGER_WORD_FOR_GENERATION } from "./contants.js";
Devvit.configure({
    redditAPI: true,
    http: {
        enabled: true,
        domains: ['api.openai.com', 'modgen.scintai.com'],
    },
    media: true,
    redis: true
});
Devvit.addSettings([
    {
        name: 'OPENAI_API_KEY',
        label: 'OpenAI API Key',
        type: 'string',
        scope: 'installation',
        helpText: 'Your OpenAI API key will be used for content moderation.'
    },
    {
        name: 'MIDDLEMAN_URL',
        label: 'Middleman API URL',
        type: 'string',
        scope: 'installation',
        helpText: 'Base URL of the middleman worker, e.g. https://modgen.scintai.com'
    },
    {
        name: 'MIDDLEMAN_KEY',
        label: 'Middleman API Key',
        type: 'string',
        scope: 'installation',
        helpText: 'Must match the MIDDLEMAN_KEY secret on the middleman worker.'
    },
    {
        name: "RATE_LIMIT",
        label: "Rate Limite Per User",
        type: 'number',
        scope: 'installation',
        helpText: "A rate limit applies to the total number of generations per user per day."
    },
    {
        name: "AFTER_GENERATION_MESSAGE",
        label: "After generation completed in comments, add message",
        helpText: "After the image generation is completed you can show some message below the generated AI art.",
        type: "string",
        scope: "installation"
    },
    {
        name: "LINK_AFTER_GENERATION_MESSAGE",
        label: "You can also add link to the above message",
        helpText: "So after the generation is completed you can show some message and link that message.",
        type: "string",
        scope: "installation"
    }
]);
// Poll every minute; GPU generation takes minutes and Devvit HTTP calls
// time out after 30s, so no single job ever waits for the image.
const POLL_DELAY_MS = 60 * 1000;
const POLL_MAX_ATTEMPTS = 20;
const ENQUEUE_RETRY_DELAY_MS = 30 * 1000;
const ENQUEUE_MAX_ATTEMPTS = 3;
// Job 1: fire-and-forget enqueue, then hand off to the poll loop.
// uid = postId, so retries are idempotent (middleman dedupes by uid).
Devvit.addSchedulerJob({
    name: 'ENQUEUE_IMAGE_JOB',
    onRun: async (event, context) => {
        const postId = event.data.postId;
        const prompt = event.data.prompt;
        const userId = event.data.userId;
        const username = event.data.username;
        const aspectRatio = event.data.aspectRatio;
        const attempt = event.data.attempt ?? 0;
        const MIDDLEMAN_URL = await context.settings.get('MIDDLEMAN_URL');
        const MIDDLEMAN_KEY = await context.settings.get('MIDDLEMAN_KEY');
        if (!MIDDLEMAN_URL || !MIDDLEMAN_KEY) {
            await removePostWithReason(postId, "Image generation is not configured.", context);
            return;
        }
        try {
            await enqueueOffload(MIDDLEMAN_URL, MIDDLEMAN_KEY, prompt, aspectRatio, postId);
            await context.scheduler.runJob({
                name: "POLL_IMAGE_JOB",
                data: {
                    postId: postId,
                    userId: userId,
                    username: username,
                    attempt: 0,
                },
                runAt: new Date(Date.now() + POLL_DELAY_MS)
            });
        }
        catch (error) {
            console.error("Enqueue failed -", error);
            if (attempt + 1 < ENQUEUE_MAX_ATTEMPTS) {
                await context.scheduler.runJob({
                    name: "ENQUEUE_IMAGE_JOB",
                    data: {
                        postId: postId,
                        userId: userId,
                        username: username,
                        prompt: prompt,
                        aspectRatio: aspectRatio,
                        attempt: attempt + 1,
                    },
                    runAt: new Date(Date.now() + ENQUEUE_RETRY_DELAY_MS)
                });
                return;
            }
            const removalText = `\n\n*(Image Generation Failed - could not reach the image service)*`;
            await removePostWithReason(postId, removalText, context);
        }
    },
});
// Job 2: poll middleman until terminal, then publish. Reschedules itself
// while the job is queued/started/pending on the GPU worker.
Devvit.addSchedulerJob({
    name: 'POLL_IMAGE_JOB',
    onRun: async (event, context) => {
        const postId = event.data.postId;
        const userId = event.data.userId;
        const username = event.data.username;
        const attempt = event.data.attempt ?? 0;
        const MIDDLEMAN_URL = await context.settings.get('MIDDLEMAN_URL');
        const MIDDLEMAN_KEY = await context.settings.get('MIDDLEMAN_KEY');
        const AFTER_GENERATION_MESSAGE = await context.settings.get("AFTER_GENERATION_MESSAGE") || "View More AI Arts";
        const LINK_AFTER_GENERATION_MESSAGE = await context.settings.get("LINK_AFTER_GENERATION_MESSAGE") || "https://www.reddit.com/r/scintai/";
        const date = new Date().toISOString().split('T')[0];
        const redisKey = `daily_credits:${userId}:${date}`;
        if (!MIDDLEMAN_URL || !MIDDLEMAN_KEY) {
            await removePostWithReason(postId, "Image generation is not configured.", context);
            return;
        }
        const scheduleNextPoll = async () => {
            await context.scheduler.runJob({
                name: "POLL_IMAGE_JOB",
                data: {
                    postId: postId,
                    userId: userId,
                    username: username,
                    attempt: attempt + 1,
                },
                runAt: new Date(Date.now() + POLL_DELAY_MS)
            });
        };
        let result;
        try {
            result = await getOffloadStatus(MIDDLEMAN_URL, MIDDLEMAN_KEY, postId);
        }
        catch (error) {
            console.error("Poll failed -", error);
            if (attempt + 1 < POLL_MAX_ATTEMPTS) {
                await scheduleNextPoll();
                return;
            }
            const removalText = `\n\n*(Image Generation Failed - timed out waiting for the image)*`;
            await removePostWithReason(postId, removalText, context);
            return;
        }
        if (result.status === "error") {
            const removalText = `\n\n*(Image Generation Failed - please try again)*`;
            await removePostWithReason(postId, removalText, context);
            return;
        }
        if (result.status !== "success" || !result.image_b64) {
            // queued / started / pending — GPU still working.
            if (attempt + 1 < POLL_MAX_ATTEMPTS) {
                await scheduleNextPoll();
                return;
            }
            const removalText = `\n\n*(Image Generation Failed - timed out waiting for the image)*`;
            await removePostWithReason(postId, removalText, context);
            return;
        }
        try {
            // Publish: same path as before, base64 now comes from middleman.
            const mimeType = result.image_format === "png" ? "image/png" : "image/webp";
            const imageUrl = `data:${mimeType};base64,${result.image_b64}`;
            try {
                const mediaUpload = await context.media.upload({
                    url: imageUrl,
                    type: 'image',
                });
                const rich = new RichTextBuilder()
                    .image({ mediaId: mediaUpload.mediaId })
                    .paragraph((p) => {
                    p.link({
                        text: AFTER_GENERATION_MESSAGE,
                        url: LINK_AFTER_GENERATION_MESSAGE
                    });
                });
                const comment = await context.reddit.submitComment({
                    id: postId,
                    richtext: rich
                });
                await comment.distinguish(true);
                const userHistoryKey = `user_history:${userId}`;
                await context.redis.zAdd(userHistoryKey, { member: mediaUpload.mediaUrl, score: Date.now() });
                await context.redis.incrBy(redisKey, 1);
                return;
            }
            catch (uploadError) {
                console.error("Media upload failed -", uploadError);
                throw new Error("Generation failed - Image generated but uploading failed.");
            }
        }
        catch (error) {
            const removalText = `\n\n*(Image Generation Failed - Server Error)*`;
            await removePostWithReason(postId, removalText, context);
        }
    },
});
Devvit.addTrigger({
    event: 'PostCreate',
    onEvent: async (event, context) => {
        const post = event.post;
        const author = event.author;
        const postId = post?.id;
        const postFlairUsed = post?.linkFlair?.text;
        const postBody = post?.selftext;
        const isImage = post?.isImage; //
        const isVideo = post?.isVideo;
        const isNSFW = post?.nsfw; // in both the cases delte the post with coment: "not supported"
        const postdetail = await context.reddit.getPostById(postId);
        const authorId = author?.id;
        const authorUserInfo = await postdetail.getAuthor();
        const OPENAI_API_KEY = await context.settings.get('OPENAI_API_KEY');
        const GENERATION_PER_DAY = await context.settings.get('RATE_LIMIT');
        if (!OPENAI_API_KEY || !GENERATION_PER_DAY) {
            return;
        }
        // NSFW-tagged posts are allowed through — only minor-related
        // prompts are blocked (see moderation below).
        if (!postFlairUsed) {
            const noFlairRejectionMessage = "Post flair is required for all the post.";
            await removePostWithReason(postId, noFlairRejectionMessage, context);
            return;
        }
        if (!postBody) {
            const noBodyTextRejectionMessage = "Prompt is required for all the post.";
            await removePostWithReason(postId, noBodyTextRejectionMessage, context);
            return;
        }
        if (postFlairUsed === TRIGGER_WORD_FOR_GENERATION && postId && postBody) {
            const extractPromptFromPostBody = extractPrompt(postBody);
            const aspectRatio = extractAspectRatio(postBody) ?? "9:16";
            if (isImage || isVideo) {
                const removalMessage = "Image generation with reference Image or Video are not supported.";
                await removePostWithReason(postId, removalMessage, context);
                return;
            }
            if (!extractPromptFromPostBody || extractPromptFromPostBody.trim().length === 0) {
                const invalidFormatMessage = "Invalid Format - ScintAI couldn’t process your prompt. Please resubmit it using the correct format.";
                await removePostWithReason(postId, invalidFormatMessage, context);
                return;
            }
            // Processing notice goes on the post itself, not via DM: bot DMs
            // are blocked for users who never interacted with the app. Best
            // effort — a failed notice must never block the generation.
            try {
                await context.reddit.submitComment({
                    id: postId,
                    text: "⏳ ScintAI is generating your image. Please be patient, it may take a few minutes. Thank you.",
                });
            }
            catch (commentError) {
                console.warn("Processing comment skipped -", commentError);
            }
            // Rate Limiting Logic
            if (authorId) {
                const date = new Date().toISOString().split('T')[0];
                const redisKey = `daily_credits:${authorId}:${date}`;
                let currentUsage = await context.redis.get(redisKey);
                if (!currentUsage) {
                    await context.redis.set(redisKey, '0');
                    currentUsage = '0';
                }
                // Check usage against the constant limit
                if (parseInt(currentUsage) >= GENERATION_PER_DAY) {
                    await removePostWithReason(postId, `Daily limit of image generations reached. Please try again tomorrow.`, context);
                    return;
                }
            }
            const promptForImage = extractPromptFromPostBody;
            let moderation;
            try {
                moderation = await checkModeration(promptForImage, OPENAI_API_KEY);
            }
            catch (modError) {
                console.error("Moderation threw -", modError);
                await removePostWithReason(postId, "Content moderation is temporarily unavailable - please try again.", context);
                return;
            }
            if (moderation.flagged) {
                if (moderation.categories.includes("Moderation Check Failed")) {
                    // Fail-closed: OpenAI API itself errored (see utils.ts), the
                    // prompt was NOT judged — log it as an outage, not a violation.
                    console.error("Moderation service unavailable, fail-closed removal -", postId);
                    await removePostWithReason(postId, "Content moderation is temporarily unavailable - please try again.", context);
                }
                else {
                    // No mercy; del the post
                    console.log("Moderation blocked -", postId, moderation.categories);
                    await removePostWithReason(postId, "Content referencing minors is not allowed", context);
                }
                return;
            }
            console.log("Moderation passed -", postId);
            await context.scheduler.runJob({
                name: "ENQUEUE_IMAGE_JOB",
                data: {
                    postId: postId,
                    userId: author?.id,
                    username: authorUserInfo.username,
                    prompt: promptForImage,
                    aspectRatio: aspectRatio,
                    attempt: 0,
                },
                runAt: new Date()
            });
        }
    },
});
export default Devvit;
