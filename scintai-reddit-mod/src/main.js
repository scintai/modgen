import { Devvit, RichTextBuilder } from "@devvit/public-api";
import { checkModeration, extractAspectRatio, extractPrompt, generateImage, removePostWithReason, sendMessage } from "./utils.js";
import { TRIGGER_WORD_FOR_GENERATION } from "./contants.js";
Devvit.configure({
    redditAPI: true,
    http: {
        enabled: true,
        domains: ['api.openai.com', 'generativelanguage.googleapis.com'],
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
        name: 'GEMINI_API_KEY',
        label: 'Gemini API Key',
        type: 'string',
        scope: 'installation',
        helpText: "Your Gemini API key will be used for image generation."
    },
    {
        name: "SELECT_MODEL",
        label: "Image Model",
        type: "select",
        options: [
            {
                label: "Nano Banana Pro",
                value: "gemini-3-pro-image-preview"
            },
            {
                label: "Imagen 4",
                value: "imagen-4.0-generate-001"
            },
            {
                label: "Imagen 4 Ultra",
                value: "imagen-4.0-ultra-generate-001"
            },
            {
                label: "Imagen 4 Fast",
                value: "imagen-4.0-fast-generate-001"
            },
        ],
        helpText: "The selected AI model is used for image generation.",
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
// Define the background worker
Devvit.addSchedulerJob({
    name: 'GENERATE_IMAGE_JOB',
    onRun: async (event, context) => {
        const postId = event.data.postId;
        const prompt = event.data.prompt;
        const userId = event.data.userId;
        const username = event.data.username;
        const aspectRatio = event.data.aspectRatio;
        const GEMINI_API_KEY = await context.settings.get('GEMINI_API_KEY');
        const SELECT_MODEL = await context.settings.get('SELECT_MODEL');
        const MODEL_ID = SELECT_MODEL?.[0] || "imagen-4.0-fast-generate-001";
        const AFTER_GENERATION_MESSAGE = await context.settings.get("AFTER_GENERATION_MESSAGE") || "View More AI Arts";
        const LINK_AFTER_GENERATION_MESSAGE = await context.settings.get("LINK_AFTER_GENERATION_MESSAGE") || "https://www.reddit.com/r/scintai/";
        const date = new Date().toISOString().split('T')[0];
        const redisKey = `daily_credits:${userId}:${date}`;
        if (!GEMINI_API_KEY) {
            return;
        }
        try {
            // 1. Call Image Generation API with selected model and aspect ratio
            const imageResult = await generateImage(prompt, GEMINI_API_KEY, MODEL_ID, aspectRatio);
            if (imageResult) {
                const imageUrl = `data:${imageResult.mimeType};base64,${imageResult.data}`;
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
                    const messageContent = `https://www.reddit.com${comment.permalink}`;
                    const messageContentSubject = 'ScintAI - Image Generated Successfully';
                    await sendMessage(username, messageContentSubject, messageContent, context);
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
            else {
                throw new Error("Generation failed - server error");
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
        if (isNSFW) {
            const removalNSFWMessage = "NSFW image generation is not allowed but If you are trying to generate SFW image with an NSFW tag on, please remove the tag and try again";
            await removePostWithReason(postId, removalNSFWMessage, context);
            return;
        }
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
            // notify the user about image generation is beign started.
            await sendMessage(authorUserInfo.username, "ScintAI - Generating Image", "Your image is being processed. Please be patient, it may take some time. Thank you.", context);
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
            const moderation = await checkModeration(promptForImage, OPENAI_API_KEY);
            if (moderation.flagged) {
                // No mercy; del the post
                await removePostWithReason(postId, "NSFW content is not allowed", context);
                return;
            }
            await context.scheduler.runJob({
                name: "GENERATE_IMAGE_JOB",
                data: {
                    postId: postId,
                    userId: author?.id,
                    username: authorUserInfo.username,
                    prompt: promptForImage,
                    aspectRatio: aspectRatio
                },
                runAt: new Date()
            });
        }
    },
});
export default Devvit;
