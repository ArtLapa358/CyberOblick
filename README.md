# 🎮 КиберОблик — 3D Avatar Creator with Motion Capture

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

## Функциональные модули

### 1. Mocap Engine (`mocap.js`)
- Захват фронтальной камеры через `getUserMedia`
- MediaPipe Face Mesh: 468 точек лица → yaw/pitch/roll, мимика (рот, глаза, брови, улыбка)
- MediaPipe Hands: 21 точка на руку × 2 руки → углы рук, сжатие кулака
- Сглаживание на 3 кадра для устранения дрожания
- Целевые 30 FPS с адаптивным пропуском кадров

### 2. 3D Конструктор (`avatar3d.js`)
- Процедурная модель аватара (голова, тело, руки, ноги)
- Система костей (`updateBones`): координаты MediaPipe → ротация/позиция мешей
- 6 предметов снаряжения: кибер-шлем, голо-визор, неон-маска, кибер-уши, тех-куртка, голо-крылья
- Система командных цветов с пресетами (Navi, Spirit, VP, G2, Fnatic)
- 4 фона сцены: кибер-сетка, тёмный, градиент, прозрачный
- Idle-анимация (дыхание, покачивание) когда mocap неактивен

### 3. WebRTC Signaling (`server.js`)
- Создание комнат для стриминга
- Обмен SDP Offer/Answer
- ICE Candidate relay
- Автоочистка комнат через 30 минут

### 4. Бизнес-логика
- **Free**: водяной знак, 720p экспорт
- **Pro**: без водяного знака, 720p/1080p, экспорт файлов

## API Endpoints

| Method | URL | Описание |
|--------|-----|----------|
| `POST` | `/api/avatar/save` | Сохранить конфигурацию |
| `GET` | `/api/avatar/:id` | Загрузить конфигурацию |
| `GET` | `/api/teams` | Список командных пресетов |
| `POST` | `/api/rtc/room` | Создать WebRTC комнату |
| `POST` | `/api/rtc/room/:id/offer` | SDP Offer |
| `POST` | `/api/rtc/room/:id/answer` | SDP Answer |
| `POST` | `/api/export` | Проверка доступа к экспорту |

## Оптимизация под мобильные

- `devicePixelRatio` ограничен до 2x
- Three.js PCFSoftShadowMap с 1024px shadow map
- MediaPipe `modelComplexity: 1` (баланс точности/скорости)
- Адаптивный UI для landscape-ориентации
- `touch-action: manipulation` для предотвращения задержки тапов
- Safe area поддержка (iPhone notch)
