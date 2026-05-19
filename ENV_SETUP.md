# Secret Hitler Online - Environment Configuration

This file contains the environment variables needed to run the application.

## Setup Instructions

1. **Copy this file to `.env`:**
   ```bash
   cp .env.example .env
   ```

2. **Configure variables for your environment:**

### Production Deployment (Render)

Add these variables to Render Dashboard → Environment:

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Client URL - Use your Render deployment URL
VITE_SERVER_URL=https://your-app-name.onrender.com

# Optional: Session/Security
SESSION_SECRET=generate-a-random-secret-here
```

### Development (Local)

```env
PORT=3000
NODE_ENV=development
VITE_SERVER_URL=http://localhost:3000
SESSION_SECRET=dev-secret
```

## Render Deployment

1. Go to your **Render Dashboard** → Select your Service
2. Click **Environment** tab
3. Add each variable as shown above
4. Click **Save** and trigger a new deployment

## Tokens & Security

⚠️ **IMPORTANT**: 
- Never commit `.env` files to Git
- Use `.env.example` as a template only
- Generate strong `SESSION_SECRET` values
- For production, use strong random strings (32+ characters)

## Troubleshooting

If deployment fails:
1. Check all required variables are set in Render
2. Ensure `PORT` is set to `3000`
3. Verify `NODE_ENV=production`
4. Check Render logs for specific errors
