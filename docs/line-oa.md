# LINE OA Setup

This project exposes a LINE Official Account webhook, a normal web analysis page, watchlist commands, and daily push summaries.

## Endpoints

- `POST /api/line/webhook`: receives LINE messages and replies with stock summaries.
- `GET /api/line/daily`: pushes the daily watchlist digest to LINE. Vercel Cron calls this on weekdays.
- `GET /api/stock/summary?query=2330`: returns a stock summary for the web page.
- `POST /api/stock/analyze`: runs AI analysis for the selected stock.
- `/line`: normal web page for stock lookup and AI analysis. LIFF is optional.

## Vercel environment variables

Required:

- `LINE_CHANNEL_SECRET`: LINE Messaging API channel secret.
- `LINE_CHANNEL_ACCESS_TOKEN`: LINE Messaging API channel access token.
- `LINE_ALLOWED_USER_ID`: your own LINE user ID. You can reuse the same value as `LINE_TARGET_ID`.
- `LINE_TARGET_ID`: push target user ID. For private use, set the same value as `LINE_ALLOWED_USER_ID`.
- `APP_PUBLIC_URL`: your Vercel production URL, for example `https://twstock-agent.vercel.app`.

Required for AI analysis:

- `OPENROUTER_API_KEY`: OpenRouter API key.

Recommended for watchlist persistence:

- `KV_REST_API_URL` and `KV_REST_API_TOKEN`, or
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

The code also supports common Vercel-generated names such as:

- `UPSTASH_REDIS_REST_KV_REST_API_URL`
- `UPSTASH_REDIS_REST_KV_REST_API_TOKEN`
- `STORAGE_KV_REST_API_URL`
- `STORAGE_KV_REST_API_TOKEN`

Do not use a variable that ends with `READ_ONLY_TOKEN`, because the watchlist needs write access.

If Redis is not configured, the bot can still read a fixed watchlist from:

- `WATCHLIST_CODES`: comma-separated stock codes, for example `2330,2317,2454`

Optional:

- `FINMIND_TOKEN`: FinMind token for institutional and margin data.
- `CRON_SECRET`: optional secret for `/api/line/daily`. If set, requests must send `Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>`.
- `GITHUB_RELEASES_URL`: custom APK release page URL.
- `AI_MODEL`: OpenRouter model name. If omitted, the app uses `openrouter/free`.
- `AI_ENDPOINT`: custom AI endpoint. If omitted, the app uses OpenRouter chat completions.
- `OPENROUTER_APP_TITLE`: title sent to OpenRouter.
- `OPENROUTER_HTTP_REFERER`: referer sent to OpenRouter.
- `VITE_LIFF_ID`: optional LIFF ID. Do not set this unless you decide to use LIFF.
- `LINE_REQUIRE_LIFF_AUTH`: optional. Leave unset unless `/line` must require LIFF login.

After changing Vercel environment variables, redeploy the project.

## LINE Developers setup

1. Open LINE Developers.
2. Go to your Messaging API channel.
3. Set Webhook URL:

   ```text
   https://YOUR_VERCEL_DOMAIN/api/line/webhook
   ```

4. Enable `Use webhook`.
5. Disable auto-reply messages.
6. Use the LINE console webhook `Verify` button.
7. Send `2330` to your LINE OA. It should reply with a Flex stock summary.

## LINE commands

Send these messages to your LINE OA:

- `2330`: lookup one stock.
- `加入 2330`: add to watchlist.
- `移除 2330`: remove from watchlist.
- `清單`: show watchlist.
- `今日重點`: generate a digest from the watchlist immediately.
- `最新APK`: show GitHub Releases URL.
- `說明`: show command help.

`加入` and `移除` require Redis env vars. Without Redis, use `WATCHLIST_CODES`.

## Daily push

`vercel.json` configures Vercel Cron:

```text
30 0 * * 1-5
```

This is 08:30 Asia/Taipei, Monday to Friday.

Manual test:

```text
https://YOUR_VERCEL_DOMAIN/api/line/daily
```

If `CRON_SECRET` is set:

```text
https://YOUR_VERCEL_DOMAIN/api/line/daily?secret=YOUR_SECRET
```

## Rich menu

Create the rich menu in LINE Official Account Manager. Use a 2 x 3 layout:

| Button | Action |
| --- | --- |
| 查股票 | Message: `查股票` |
| 觀察清單 | Message: `清單` |
| 今日重點 | Message: `今日重點` |
| 加入台積電 | Message: `加入 2330` |
| 最新 APK | Message: `最新APK` |
| 打開網頁 | URL: `https://YOUR_VERCEL_DOMAIN/line` |

Recommended LINE OA settings:

- Webhook: ON
- Auto-response messages: OFF
- Greeting message: optional
- AI chatbot beta: OFF, unless you intentionally want LINE's generic auto-reply system

## LIFF setup, optional

You do not need LIFF for the current private bot flow. `/line` works as a normal web page.

Only create LIFF if you want LINE login identity inside the web page.

1. Create a LIFF app in a LINE Login channel.
2. Set Endpoint URL:

   ```text
   https://YOUR_VERCEL_DOMAIN/line
   ```

3. Copy the LIFF ID.
4. Add it to Vercel as `VITE_LIFF_ID`.
5. Redeploy.

## Test checklist

- LINE OA replies to `2330`.
- LINE OA replies to `清單`.
- `加入 2330` persists after Redis is configured.
- `今日重點` returns a watchlist digest.
- `/api/line/daily` pushes a message to your LINE.
- `/line?code=2330` loads stock data.
- AI analysis works after `OPENROUTER_API_KEY` is set.
- GitHub Actions still creates APK releases after push.
