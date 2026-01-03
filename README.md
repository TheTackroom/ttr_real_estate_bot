# TTR Real Estate Bot

Discord bot that imports real estate inquiries from forum posts into Base44.

## How It Works

1. Player posts in the Real Estate forum with their inquiry + images
2. RE Staff runs `/import-inquiry` in that thread
3. Bot extracts the post data and walks staff through a form:
   - Property Type (Native/YMap)
   - Property Size (25x25, 50x50, 100x100)
   - General Location (text input)
4. Bot sends data to Base44 and confirms

---

## Setup Instructions

### Step 1: Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → name it "TTR Real Estate"
3. Go to **Bot** tab → Click **Add Bot**
4. Click **Reset Token** → Copy and save the token
5. Enable these **Privileged Gateway Intents**:
   - ✅ Message Content Intent
   - ✅ Server Members Intent
6. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Read Messages/View Channels`, `Send Messages`, `Read Message History`, `Use Slash Commands`
7. Copy the URL and invite bot to your server

### Step 2: Get Your Client ID

1. In Discord Developer Portal, go to **OAuth2** tab
2. Copy the **Client ID** (it's right at the top)

### Step 3: Deploy to Railway

1. Go to [railway.app](https://railway.app) and sign up/login
2. Click **New Project** → **Deploy from GitHub repo**
3. Connect your GitHub and create a new repo with these files:
   - `index.js`
   - `package.json`
   - `.env.example` (rename to just reference, don't commit real `.env`)

**Or deploy directly:**

1. Click **New Project** → **Empty Project**
2. Click **Add Service** → **Empty Service**
3. Go to service **Settings** → Connect your GitHub repo

### Step 4: Set Environment Variables in Railway

In your Railway service, go to **Variables** tab and add:

| Variable | Value |
|----------|-------|
| `DISCORD_TOKEN` | Your bot token from Step 1 |
| `CLIENT_ID` | Your client ID from Step 2 |
| `BASE44_ENDPOINT` | `https://api.base44.com/v1/apps/695884507fbbb15deba6e739/functions/createInquiry` |
| `FORUM_CHANNEL_ID` | `1279666725486465064` |
| `STAFF_CHANNEL_ID` | (add later when you have it) |
| `RE_ROLE_ID` | `1280295731449692181` |

### Step 5: Deploy

1. Railway should auto-deploy when you push to GitHub
2. Check the **Deployments** tab for logs
3. You should see: `✅ Bot is online as TTR Real Estate#1234`

---

## Usage

### For RE Staff

1. Go to a player's forum post in the Real Estate channel
2. Type `/import-inquiry`
3. Follow the prompts:
   - Select Property Type
   - Select Property Size
   - Enter General Location
4. Bot imports to Base44 and confirms

### Optional: Import from Link

If you're not in the thread, you can provide a link:
```
/import-inquiry post-link:https://discord.com/channels/123/456/789
```

---

## Troubleshooting

**Bot not responding to command:**
- Make sure you have the Real Estate Agent role
- Check that the bot is online (should show green dot)
- Verify the bot has permissions in the forum channel

**"Session expired" error:**
- Start over with `/import-inquiry` - sessions timeout after a few minutes

**Base44 import failing:**
- Check Railway logs for error details
- Verify the Base44 endpoint URL is correct
- Make sure Base44 backend functions are activated

**Command not showing up:**
- It can take up to an hour for slash commands to register globally
- Try restarting the bot in Railway

---

## Files

```
ttr-re-bot/
├── index.js          # Main bot code
├── package.json      # Dependencies
├── .env.example      # Environment variable template
└── README.md         # This file
```

---

## Adding Staff Notification Channel

Once you have a staff channel ID:

1. Go to Railway → Variables
2. Add `STAFF_CHANNEL_ID` with the channel ID
3. Redeploy

The bot will then post a notification to that channel whenever an inquiry is imported.
