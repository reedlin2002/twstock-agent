# LINE OA Setup

This project exposes a LINE Official Account webhook plus a LIFF mini app.

## What was added

- `POST /api/line/webhook`: receives LINE messages and replies with stock summaries.
- `GET /api/stock/summary?query=2330`: returns a stock summary for LIFF.
- `POST /api/stock/analyze`: runs AI analysis for the selected stock.
- `/line`: LIFF-friendly mini page for stock lookup and AI analysis.

## Vercel environment variables

Required:

- `LINE_CHANNEL_SECRET`: LINE Messaging API channel secret.
- `LINE_CHANNEL_ACCESS_TOKEN`: LINE Messaging API channel access token.
- `LINE_ALLOWED_USER_ID`: your own LINE user ID. You can reuse the same value as `LINE_TARGET_ID`.

Required for AI:

- `OPENROUTER_API_KEY`: OpenRouter API key.

Recommended:

- `APP_PUBLIC_URL`: your Vercel production URL, for example `https://twstock-agent.vercel.app`.
- `VITE_LIFF_ID`: LIFF ID after you create the LIFF app.
- `FINMIND_TOKEN`: FinMind token for institutional and margin data.

Optional:

- `AI_MODEL`: OpenRouter model name. If omitted, the app uses `openrouter/free`.
- `AI_ENDPOINT`: custom AI endpoint. If omitted, the app uses OpenRouter chat completions.
- `OPENROUTER_APP_TITLE`: title sent to OpenRouter.
- `OPENROUTER_HTTP_REFERER`: referer sent to OpenRouter.
- `GITHUB_RELEASES_URL`: custom APK release page URL.
- `LINE_REQUIRE_LIFF_AUTH`: set to `true` if API calls from `/line` must require LIFF login.

After changing Vercel environment variables, redeploy the project.

## LINE Developers setup

1. Open LINE Developers.
2. Go to your Messaging API channel.
3. Set Webhook URL:

   ```text
   https://YOUR_VERCEL_DOMAIN/api/line/webhook
   ```

4. Enable `Use webhook`.
5. Disable auto-reply messages if they interfere with webhook replies.
6. Use the LINE console webhook `Verify` button.
7. Send `2330` to your LINE OA. It should reply with a Flex stock summary.

## LIFF setup

1. In the same provider, create a LIFF app.
2. Set Endpoint URL:

   ```text
   https://YOUR_VERCEL_DOMAIN/line
   ```

3. Copy the LIFF ID.
4. Add it to Vercel as `VITE_LIFF_ID`.
5. Redeploy.
6. Open:

   ```text
   https://YOUR_VERCEL_DOMAIN/line?code=2330
   ```

## Rich menu idea

Create three rich menu buttons:

- Stock lookup: send message `2330` or `查股票`.
- AI analysis: open URL `https://YOUR_VERCEL_DOMAIN/line`.
- Latest APK: send message `最新APK` or open your GitHub Releases URL.

## Test checklist

- GitHub Actions still creates APK releases after push.
- LINE OA replies to `2330`.
- `/line?code=2330` loads stock data.
- AI analysis works after `OPENROUTER_API_KEY` is set.
- If `LINE_REQUIRE_LIFF_AUTH=true`, `/line` must be opened through LIFF login.
