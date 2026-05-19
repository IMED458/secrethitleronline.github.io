# Secret Hitler Online - Render Deployment Guide

## 🚀 მე-ზე დელოის დაშვება (Render)

### ნაბიჯი 1: Render Account Setup
1. გაკ რეგისტრაცია https://render.com
2. ახალი **Web Service** შექმენი
3. GitHub რეპოზიტორი დააკავშირე

### ნაბიჯი 2: Environment Variables დაყენება

**Render Dashboard → Environment → დაამატე ეს ცვლადები:**

```env
PORT=10000
NODE_ENV=production
VITE_SERVER_URL=https://your-render-url.onrender.com
SESSION_SECRET=your-secure-token-here
```

#### `SESSION_SECRET` გენერირება:
```bash
# Linux/Mac:
openssl rand -hex 32

# Windows (PowerShell):
[System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((New-Guid).ToString())) | ForEach-Object {$_ -replace '[/+=]', 'X'}
```

### ნაბიჯი 3: Build & Start Commands

**Render Dashboard → Build Command:**
```bash
npm install && npm run build
```

**Render Dashboard → Start Command:**
```bash
npm start
```

### ნაბიჯი 4: დელოის დიაგნოსტიკა

**Logs Check:**
- Render Dashboard → Logs tab-ში
- ეძებე `Server running on` შეტყობინება
- თუ CORS ხარვეზი: გადახედე `VITE_SERVER_URL`

**რთული case-ები:**

1. **"Cannot find module 'dotenv'"**
   - გაშვება: `npm install`
   - დელო ხელახლა დაიწყე

2. **Socket.io connection fail**
   - `VITE_SERVER_URL` უნდა იყოს თქვენი Render URL
   - CORS უნდა იყოს გააქტიურებული

3. **"Address already in use"**
   - Render სახელმწიფოდ ენიჭებს PORT
   - გამოიყენე `process.env.PORT`

### ნაბიჯი 5: Free Tier Optimization

**Socket.io რესურსის შემცირება:**
- Maximum rooms: 100
- Session TTL: 24 საათი
- Memory limit: 512MB

**რეკომენდაცია:** Free tier-ი კარგია testing-ისთვის. Production-ისთვის განიხილე Paid Plan ($7+/თვე).

---

## 🔒 უსაფრთხოება

✅ `.env` ფაილი `.gitignore`-ში
✅ TOKEN-ები არ არის GitHub-ში
✅ CORS დაცული production-ში
✅ Socket.io დაშიფრული კავშირით

---

## 📝 საჭირო ფაილები

- ✅ `.env.example` - მაგალითი
- ✅ `.env` - ლოკალური (`.gitignore`-ში)
- ✅ `server.ts` - dotenv დაკავშირებული
- ✅ `package.json` - dotenv დამატებული

---

## ✅ Render Deployment Checklist

- [ ] `.env` ფაილი შექმნილი (ლოკალურად)
- [ ] `SESSION_SECRET` წამოღებული
- [ ] Render Environment variables დაყენებული
- [ ] GitHub დააკავშირე
- [ ] Build & Start commands შეყვანილი
- [ ] დელო დაწყებული
- [ ] Logs-ში "Server running" ჩანს
- [ ] Socket.io კავშირი სამუშაოა

---

**დილემა რომელი იყო? გთხოვ დააკომენტარო ქვემოთ!** 🚀
