## Описание

Мобильное веб-приложение для создания и анимации 3D-аватаров с захватом движений лица и рук через камеру смартфона.

## Архитектура

```
cyberoblik/
├── server.js              # Express-сервер: API, WebRTC Signaling, статика
├── package.json
├── .env.example           # Шаблон конфигурации
└── public/
    ├── index.html          # SPA — Mobile-first интерфейс
    ├── css/
    │   └── style.css       # Cyberpunk UI (Orbitron + Exo 2)
    └── js/
        ├── mocap.js         # MediaPipe Face Mesh + Hands → landmarks
        ├── avatar3d.js      # Three.js сцена + процедурный аватар + bone mapping
        └── app.js           # Контроллер: связка mocap ↔ 3D ↔ UI ↔ API
```

## Стек технологий

| Слой | Технология |
|------|-----------|
| Бэкенд | Node.js + Express |
| 3D рендеринг | Three.js (r128) |
| Mocap движок | MediaPipe (Face Mesh + Hands) |
| Стриминг | WebRTC (signaling через Express) |
| БД (опционально) | Supabase |
| UI | Vanilla JS, CSS3 (Mobile-first) |

## Быстрый старт

```bash
# Установка
cd cyberoblik
npm install

# Запуск
npm start
# → http://localhost:3000
```

