# Secret Hitler Online (ქართული)

ქართული ონლაინ ვერსია 5-10 მოთამაშისთვის. აპი მუშაობს React/Vite-ზე, ხოლო თამაშის ოთახები და realtime მოქმედებები Socket.IO სერვერზე ინახება.

## გაშვება ლოკალურად

```bash
npm install
npm run dev
```

შემდეგ გახსენით:

```text
http://localhost:3000
```

## Deploy Render-ზე

ეს აპი სრულად მუშაობს Node server-ით, რადგან Socket.IO realtime ოთახები სჭირდება. GitHub Pages მხოლოდ static frontend-ს აჩვენებს; multiplayer-ისთვის გამოიყენეთ Render web service.

Render Blueprint:

```text
render.yaml
```

Build command:

```bash
npm ci && npm run build
```

Start command:

```bash
npm start
```

## ფუნქციები

- ოთახის შექმნა და კოდით შესვლა
- როლების უსაფრთხო ჩვენება თითოეული მოთამაშისთვის
- პრეზიდენტის/კანცლერის ნომინაცია, ხმის მიცემა და legislative phase
- executive powers: loyalty investigation, policy peek, special election, execution
- veto და election tracker/chaos
- reconnect იმავე ოთახში refresh-ის შემდეგ
- responsive UI desktop და mobile ხედებისთვის
